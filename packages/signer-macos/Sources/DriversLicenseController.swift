import Foundation

struct LicenseInfo: Codable {
    let name: String
    let address: String
    let birthDate: String
    let licenseNumber: String
    let issueDate: String
    let expiryDate: String
    let colorClass: String
    var signature: String? = nil // Base64
}

class DriversLicenseController {
    let manager: SmartCardInterface
    
    // JPDL AID (Japan Driver License)
    static let AID_JPDL = Data([0xA0, 0x00, 0x00, 0x02, 0x31, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    
    init(manager: SmartCardInterface) {
        self.manager = manager
    }
    
    func selectDLAP() async throws {
        var apdu = Data([0x00, 0xA4, 0x04, 0x0C])
        apdu.append(UInt8(Self.AID_JPDL.count))
        apdu.append(Self.AID_JPDL)
        
        let res = try await manager.transmit(apdu: apdu)
        try checkSW(res, context: "Select DL AP")
    }
    
    func verifyPIN1(_ pin: String) async throws {
        try await verifyPIN(fileID: Data([0x00, 0x11]), pin: pin)
    }
    
    func verifyPIN2(_ pin: String) async throws {
        try await verifyPIN(fileID: Data([0x00, 0x12]), pin: pin)
    }
    
    private func verifyPIN(fileID: Data, pin: String) async throws {
        // Select PIN EF
        var selApdu = Data([0x00, 0xA4, 0x02, 0x0C, 0x02])
        selApdu.append(fileID)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select PIN EF")
        
        // Verify
        let pinData = pin.data(using: .ascii) ?? Data()
        var verApdu = Data([0x00, 0x20, 0x00, 0x80])
        verApdu.append(UInt8(pinData.count))
        verApdu.append(pinData)
        
        let resVer = try await manager.transmit(apdu: verApdu)
        try checkSW(resVer, context: "Verify PIN")
    }
    
    func readCommonData() async throws -> LicenseInfo {
        let data = try await readEF(fileID: Data([0x00, 0x01]))
        var info = try parseLicenseInfo(data: data)
        
        // Also read signature (Group 7 usually contains the issuer signature)
        if let sig = try? await readSignature() {
            info.signature = sig.base64EncodedString()
        }
        
        return info
    }
    
    func readSignature() async throws -> Data {
        // Read Signature EF (00 02 in the same AP usually)
        return try await readEF(fileID: Data([0x00, 0x02]))
    }
    
    private func parseLicenseInfo(data: Data) throws -> LicenseInfo {
        let tlvs = TLVParser.parse(data: data)
        let sjis = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.shiftJIS.rawValue)))
        
        let name = tlvs.first?.findString(tag: 0x12, encoding: sjis) ?? "Unknown"
        let address = tlvs.first?.findString(tag: 0x13, encoding: sjis) ?? "Unknown"
        let birthDate = tlvs.first?.findString(tag: 0x14, encoding: sjis) ?? "Unknown"
        let issueDate = tlvs.first?.findString(tag: 0x15, encoding: sjis) ?? "Unknown"
        let expiryDate = tlvs.first?.findString(tag: 0x17, encoding: sjis) ?? "Unknown"
        let licenseNumber = tlvs.first?.findString(tag: 0x16, encoding: .ascii) ?? "Unknown"
        
        let colorClass = tlvs.first?.findString(tag: 0x18, encoding: sjis) ?? ""
        
        return LicenseInfo(
            name: name,
            address: address,
            birthDate: birthDate,
            licenseNumber: licenseNumber,
            issueDate: issueDate,
            expiryDate: expiryDate,
            colorClass: colorClass,
            signature: nil
        )
    }
    
    private func readEF(fileID: Data) async throws -> Data {
        var selApdu = Data([0x00, 0xA4, 0x02, 0x0C, 0x02])
        selApdu.append(fileID)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select EF")
        
        var result = Data()
        var offset = 0
        while true {
            let p1 = UInt8((offset >> 8) & 0xFF)
            let p2 = UInt8(offset & 0xFF)
            let readApdu = Data([0x00, 0xB0, p1, p2, 0x00, 0x00, 0x00])
            let res = try await manager.transmit(apdu: readApdu)
            
            if res.count < 2 { break }
            let chunk = res.prefix(res.count-2)
            if chunk.isEmpty { break }
            result.append(chunk)
            offset += chunk.count
            if chunk.count < 256 { break }
            break 
        }
        return result
    }
    
    private func checkSW(_ data: Data, context: String) throws {
        if data.count < 2 { throw SignerError.jpki("\(context): too short") }
        let sw1 = data[data.count-2]
        let sw2 = data[data.count-1]
        
        if sw1 == 0x90 && sw2 == 0x00 { return }
        if sw1 == 0x63 && (sw2 & 0xF0) == 0xC0 {
            throw SignerError.pinIncorrect(retries: Int(sw2 & 0x0F))
        }
        if sw1 == 0x69 && sw2 == 0x83 {
            throw SignerError.pinLocked
        }
        throw SignerError.jpki("\(context) failed: \(String(format: "%02X%02X", sw1, sw2))")
    }
}