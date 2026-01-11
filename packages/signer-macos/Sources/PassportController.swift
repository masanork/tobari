import Foundation
import CryptoKit
import CommonCrypto

class PassportController {
    let manager: SmartCardInterface
    
    // ICAO 9303 AID
    static let AID_PASSPORT = Data([0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01])
    
    init(manager: SmartCardInterface) {
        self.manager = manager
    }
    
    func selectPassportAP() async throws {
        var apdu = Data([0x00, 0xA4, 0x04, 0x0C])
        apdu.append(UInt8(Self.AID_PASSPORT.count))
        apdu.append(Self.AID_PASSPORT)
        
        let res = try await manager.transmit(apdu: apdu)
        try checkSW(res, context: "Select Passport AP")
    }
    
    // Simplified BAC implementation (Placeholder for real crypto)
    func performBAC(mrz: String) async throws {
        // In a real implementation, we would derive Kenc and Kmac from MRZ,
        // perform Mutual Authentication, and establish Secure Messaging.
        // For now, we'll assume the card allows reading without SM or it's a mock.
        debugPrint("Performing BAC with MRZ: \(mrz)")
    }
    
    func readDG1() async throws -> Data {
        return try await readEF(fileID: Data([0x01, 0x01]))
    }
    
    func readDG2() async throws -> Data {
        return try await readEF(fileID: Data([0x01, 0x02]))
    }
    
    private func readEF(fileID: Data) async throws -> Data {
        // Select EF
        var selApdu = Data([0x00, 0xA4, 0x02, 0x0C, 0x02])
        selApdu.append(fileID)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select EF")
        
        // Read Binary (simplified, handle large files in chunks)
        var result = Data()
        var offset = 0
        while true {
            let p1 = UInt8((offset >> 8) & 0xFF)
            let p2 = UInt8(offset & 0xFF)
            let readApdu = Data([0x00, 0xB0, p1, p2, 0x00])
            let res = try await manager.transmit(apdu: readApdu)
            if res.count < 2 { break }
            let chunk = res.subdata(in: 0..<res.count-2)
            if chunk.isEmpty { break }
            result.append(chunk)
            offset += chunk.count
            if chunk.count < 256 { break }
        }
        return result
    }
    
    private func checkSW(_ data: Data, context: String) throws {
        if data.count < 2 { throw SignerError.jpki("\(context): too short") }
        let sw = (UInt16(data[data.count-2]) << 8) | UInt16(data[data.count-1])
        if sw != 0x9000 {
            throw SignerError.jpki("\(context) failed: \(String(format: "%04X", sw))")
        }
    }
}
