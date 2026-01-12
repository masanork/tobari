import Foundation
import CryptoTokenKit

protocol SmartCardInterface {
    func transmit(apdu: Data) async throws -> Data
}

class SmartCardManager: SmartCardInterface {
    static let shared = SmartCardManager()
    
    // Observer for card state
    var onCardStateChanged: ((Bool) -> Void)?
    
    init() {
        setupObserver()
    }
    
    private func setupObserver() {
        // Fallback to a string-based notification which is common for CTK
        NotificationCenter.default.addObserver(forName: NSNotification.Name("TKSmartCardSlotManagerDidChangeSlots"), object: nil, queue: .main) { [weak self] _ in
            self?.checkCurrentState()
        }
        
        // Also check periodically as a fallback
        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.checkCurrentState()
        }
    }
    
    func checkCurrentState() {
        guard let manager = TKSmartCardSlotManager.default else {
            onCardStateChanged?(false)
            return
        }
        
        // If no slots at all
        if manager.slotNames.isEmpty {
            onCardStateChanged?(false)
            return
        }
        
        let slotNames = manager.slotNames
        var checkedCount = 0
        var foundCard = false
        
        for slotName in slotNames {
            manager.getSlot(withName: slotName) { slot in
                DispatchQueue.main.async {
                    if let slot = slot, slot.state == .validCard {
                        foundCard = true
                    }
                    
                    checkedCount += 1
                    // After checking all slots, update state
                    if checkedCount == slotNames.count {
                        self.onCardStateChanged?(foundCard)
                    }
                }
            }
        }
    }
    
    // Send a raw APDU command to the first available card in any slot
    func transmit(apdu: Data) async throws -> Data {
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
        return try await card.transmit(apdu)
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
