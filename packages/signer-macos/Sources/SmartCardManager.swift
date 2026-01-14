import Foundation
import CryptoTokenKit

protocol SmartCardInterface {
    func transmit(apdu: Data) async throws -> Data
}

class SmartCardManager: SmartCardInterface, @unchecked Sendable {
    static let shared = SmartCardManager()
    private static let apduDebugEnabled = ProcessInfo.processInfo.environment["TOBARI_APDU_DEBUG"] == "1"
    private static let apduLogPath: String? = {
        if let path = ProcessInfo.processInfo.environment["TOBARI_APDU_LOG"], !path.isEmpty {
            return path
        }
        return apduDebugEnabled ? "/tmp/tobari-apdu.log" : nil
    }()

    private static func appendApduLog(_ line: String) {
        guard let path = apduLogPath else { return }
        let fm = FileManager.default
        if !fm.fileExists(atPath: path) {
            fm.createFile(atPath: path, contents: nil)
        }
        guard let handle = FileHandle(forWritingAtPath: path) else { return }
        defer { try? handle.close() }
        if let data = (line + "\n").data(using: .utf8) {
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        }
    }
    
    // Observer for card state
    var onCardStateChanged: ((Bool) -> Void)?
    var onCardTypeDetected: ((CardType) -> Void)?

    // Semaphore to serialize all card operations
    private let transmitSemaphore = DispatchSemaphore(value: 1)

    // Flag to prevent card detection during operations
    private var isOperationInProgress = false
    private var operationCount = 0
    private let operationLock = NSLock()
    private var activeSessionCard: TKSmartCard? = nil

    func beginOperation() {
        operationLock.lock()
        operationCount += 1
        if operationCount == 1 {
            isOperationInProgress = true
            pollingTimer?.invalidate()
            pollingTimer = nil
        }
        operationLock.unlock()
    }

    func endOperation() {
        operationLock.lock()
        operationCount -= 1
        if operationCount <= 0 {
            operationCount = 0
            isOperationInProgress = false
            activeSessionCard?.endSession()
            activeSessionCard = nil
        }
        let shouldRestart = (operationCount == 0)
        operationLock.unlock()

        if shouldRestart {
            // Restart polling timer
            DispatchQueue.main.async { [weak self] in
                self?.operationLock.lock()
                guard self?.operationCount == 0 else {
                    self?.operationLock.unlock()
                    return
                }
                self?.pollingTimer?.invalidate()
                self?.pollingTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
                    guard self?.isOperationActive() != true else { return }
                    self?.checkCurrentState()
                }
                self?.operationLock.unlock()
            }
        }
    }
    
    /// Pre-establish a session for faster consecutive operations
    func establishSession() async throws {
        operationLock.lock()
        if activeSessionCard != nil {
            operationLock.unlock()
            return
        }
        operationLock.unlock()
        
        guard let manager = TKSmartCardSlotManager.default else {
            throw NSError(domain: "SmartCardManager", code: 1, userInfo: [NSLocalizedDescriptionKey: "SmartCardSlotManager not available"])
        }

        let slotNames = manager.slotNames
        for slotName in slotNames {
            let slot = await withCheckedContinuation { continuation in
                manager.getSlot(withName: slotName) { slot in
                    continuation.resume(returning: slot)
                }
            }

            if let slot = slot, slot.state == .validCard, let card = slot.makeSmartCard() {
                let success = await withCheckedContinuation { continuation in
                    card.beginSession { success, _ in continuation.resume(returning: success) }
                }
                if success {
                    operationLock.lock()
                    activeSessionCard = card
                    operationLock.unlock()
                    return
                }
            }
        }
        throw NSError(domain: "SmartCardManager", code: 4, userInfo: [NSLocalizedDescriptionKey: "No card found to establish session"])
    }

    private func isOperationActive() -> Bool {
        operationLock.lock()
        defer { operationLock.unlock() }
        return isOperationInProgress
    }

    enum CardType: String {
        case unknown
        case jpki
        case passport
        case driversLicense
    }
    
    private var pollingTimer: Timer?

    init() {
        setupObserver()
    }

    private func setupObserver() {
        // Fallback to a string-based notification which is common for CTK
        NotificationCenter.default.addObserver(forName: NSNotification.Name("TKSmartCardSlotManagerDidChangeSlots"), object: nil, queue: .main) { [weak self] _ in
            guard self?.isOperationActive() != true else { return }
            self?.checkCurrentState()
        }

        // Also check periodically as a fallback
        pollingTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            guard self?.isOperationActive() != true else { return }
            self?.checkCurrentState()
        }
    }

    func checkCurrentState() {
        // Skip entirely if operation is in progress
        guard !isOperationActive() else { return }

        guard let manager = TKSmartCardSlotManager.default else {
            onCardStateChanged?(false)
            onCardTypeDetected?(.unknown)
            return
        }
        
        // If no slots at all
        if manager.slotNames.isEmpty {
            onCardStateChanged?(false)
            onCardTypeDetected?(.unknown)
            return
        }
        
        let slotNames = manager.slotNames
        var checkedCount = 0
        var foundCard = false
        
        for slotName in slotNames {
            manager.getSlot(withName: slotName) { [weak self] slot in
                DispatchQueue.main.async {
                    if let slot = slot, slot.state == .validCard {
                        foundCard = true

                        // Skip card type detection if operation is in progress
                        guard self?.isOperationActive() != true else { return }

                        // Try to detect card type asynchronously
                        Task {
                            // double check
                            guard self?.isOperationActive() != true else { return }
                            let type = await self?.detectCardType() ?? .unknown
                            
                            // Only report if still not in operation
                            guard self?.isOperationActive() != true else { return }
                            DispatchQueue.main.async {
                                self?.onCardTypeDetected?(type)
                            }
                        }
                    }
                    
                    checkedCount += 1
                    // After checking all slots, update state
                    if checkedCount == slotNames.count {
                        self?.onCardStateChanged?(foundCard)
                        if !foundCard {
                            self?.onCardTypeDetected?(.unknown)
                        }
                    }
                }
            }
        }
    }

    private func detectCardType() async -> CardType {
        // Skip if operation is in progress
        guard !isOperationActive() else { return .unknown }

        // We try to select various AIDs to identify the card
        let aids: [(CardType, Data)] = [
            (.jpki, Data([0xD3, 0x92, 0xf0, 0x00, 0x26, 0x01, 0x00, 0x00, 0x00, 0x01])),
            (.passport, Data([0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01])),
            (.driversLicense, Data([0xA0, 0x00, 0x00, 0x02, 0x31, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
        ]

        for (type, aid) in aids {
            // Check again before each SELECT
            guard !isOperationActive() else { return .unknown }
            do {
                var apdu = Data([0x00, 0xA4, 0x04, 0x0C])
                apdu.append(UInt8(aid.count))
                apdu.append(aid)
                let res = try await transmit(apdu: apdu)
                if res.count >= 2 && res[res.count-2] == 0x90 && res[res.count-1] == 0x00 {
                    return type
                }
            } catch {
                continue
            }
        }
        return .unknown
    }
    
    // Send a raw APDU command to the first available card in any slot
    func transmit(apdu: Data) async throws -> Data {
        // Check if this is a SELECT APDU for JPKI (used by card detection)
        let jpkiSelectPrefix = Data([0x00, 0xA4, 0x04, 0x0C, 0x0A, 0xD3, 0x92, 0xF0, 0x00, 0x26])
        let isDetectionApdu = apdu.count >= jpkiSelectPrefix.count && apdu.prefix(jpkiSelectPrefix.count) == jpkiSelectPrefix

        // Block card detection APDUs during operations
        if isOperationActive() && isDetectionApdu {
            throw NSError(domain: "SmartCardManager", code: 100, userInfo: [NSLocalizedDescriptionKey: "Operation in progress"])
        }

        // Serialize all card operations
        transmitSemaphore.wait()
        defer { transmitSemaphore.signal() }

        // RE-CHECK: Block card detection APDUs if an operation started while we were waiting
        if isOperationActive() && isDetectionApdu {
            throw NSError(domain: "SmartCardManager", code: 100, userInfo: [NSLocalizedDescriptionKey: "Operation in progress"])
        }

        if Self.apduDebugEnabled {
            fputs("APDU> \(apdu.hexString)\n", stderr)
        }
        Self.appendApduLog("APDU> \(apdu.hexString)")
        
        // Use active session if available
        operationLock.lock()
        if let card = activeSessionCard {
            operationLock.unlock()
            let response = try await card.transmit(apdu)
            if Self.apduDebugEnabled { fputs("APDU< \(response.hexString)\n", stderr) }
            Self.appendApduLog("APDU< \(response.hexString)")
            return response
        }
        operationLock.unlock()

        guard let manager = TKSmartCardSlotManager.default else {
            throw NSError(domain: "SmartCardManager", code: 1, userInfo: [NSLocalizedDescriptionKey: "SmartCardSlotManager not available"])
        }

        let slotNames = manager.slotNames
        if slotNames.isEmpty {
             throw NSError(domain: "SmartCardManager", code: 2, userInfo: [NSLocalizedDescriptionKey: "No card reader found"])
        }

        // Find first slot with a card
        var targetSlot: TKSmartCardSlot? = nil

        for slotName in slotNames {
            let slot = await withCheckedContinuation { continuation in
                manager.getSlot(withName: slotName) { slot in
                    continuation.resume(returning: slot)
                }
            }

            if let slot = slot, slot.state == .validCard {
                targetSlot = slot
                break
            }
        }

        guard let slot = targetSlot else {
             throw NSError(domain: "SmartCardManager", code: 4, userInfo: [NSLocalizedDescriptionKey: "No card present in any slot"])
        }
        
        guard let card = slot.makeSmartCard() else {
             throw NSError(domain: "SmartCardManager", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to make smart card object"])
        }
        
        // Begin session (connect)
        let success = await withCheckedContinuation { continuation in
            card.beginSession { success, error in
                if let error = error {
                    fputs("Debug: Session Error: \(error.localizedDescription)\n", stderr)
                }
                continuation.resume(returning: success)
            }
        }
        
        if !success {
             throw NSError(domain: "SmartCardManager", code: 5, userInfo: [NSLocalizedDescriptionKey: "Failed to begin session with card"])
        }
        
        defer {
            card.endSession()
        }
        
        // Transmit APDU
        let response = try await card.transmit(apdu)
        if Self.apduDebugEnabled {
            fputs("APDU< \(response.hexString)\n", stderr)
        }
        Self.appendApduLog("APDU< \(response.hexString)")
        return response
    }
    
    // Helper specifically for detecting if we can talk to a card
    // Sends a SELECT command for JPKI AP as a test
    func checkCard() async -> String {
        do {
            // JPKI AP AID: D3 92 f0 00 26 01 00 00 00 01
            // SELECT APDU: 00 A4 04 0C 0A ...
            let jpkiAid = Data([0xD3, 0x92, 0xf0, 0x00, 0x26, 0x01, 0x00, 0x00, 0x00, 0x01])
            var apdu = Data([0x00, 0xA4, 0x04, 0x0C])
            apdu.append(UInt8(jpkiAid.count))
            apdu.append(jpkiAid)
            
            fputs("Debug: Sending SELECT JPKI AP...\n", stderr)
            let response = try await transmit(apdu: apdu)
            
            let sw1 = response[response.count - 2]
            let sw2 = response[response.count - 1]
            
            if sw1 == 0x90 && sw2 == 0x00 {
                return "Success: JPKI Application Selected (SW=9000)"
            } else {
                return String(format: "Card responded but failed to select JPKI (SW=%02X%02X)", sw1, sw2)
            }
            
        } catch {
            return "Error: \(error.localizedDescription)"
        }
    }
}
