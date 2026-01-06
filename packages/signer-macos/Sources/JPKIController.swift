import Foundation

struct BasicInfo: Codable {
    var name: String = ""
    var address: String = ""
    var birthDate: String = ""
    var gender: String = ""
    var facePhoto: String? = nil // Base64 encoded
}

class JPKIController {
    let manager: SmartCardManager
    
    // Constants
    enum FileID {
        static let DF_JPKI = Data([0xD3, 0x92, 0xf0, 0x00, 0x26, 0x01, 0x00, 0x00, 0x00, 0x01])
        static let DF_INPUT_SUPPORT = Data([0xD3, 0x92, 0x10, 0x00, 0x31, 0x00, 0x01, 0x01, 0x04, 0x08])
        static let DF_FACE_RECOGNITION = Data([0xD3, 0x92, 0x10, 0x00, 0x31, 0x00, 0x01, 0x01, 0x04, 0x02])
        
        static let EF_AUTH_PIN = Data([0x00, 0x18])
        static let EF_INPUT_SUPPORT_PIN = Data([0x00, 0x11])
        static let EF_MYNUMBER = Data([0x00, 0x01])
        static let EF_ATTRIBUTES = Data([0x00, 0x02])
        static let EF_SURFACE_INFO = Data([0x00, 0x05])
        static let EF_SURFACE_INFO_B = Data([0x00, 0x06])
        static let EF_FACE_PHOTO = Data([0x00, 0x02]) // Usually under Face Recognition AP
    }
    
    enum APDU {
        static let CLA_ISO: UInt8 = 0x00
        static let INS_SELECT_FILE: UInt8 = 0xA4
        static let INS_READ_BINARY: UInt8 = 0xB0
        static let INS_VERIFY: UInt8 = 0x20
    }
    
    init(manager: SmartCardManager) {
        self.manager = manager
    }
    
    // MARK: - AP Selection
    
    func selectJPKIAP() async throws {
        try await selectDF(FileID.DF_JPKI)
    }
    
    func selectInputSupportAP() async throws {
        try await selectDF(FileID.DF_INPUT_SUPPORT)
    }

    private func selectDF(_ df: Data) async throws {
        // SELECT FILE (DF) by Name: CLA=00, INS=A4, P1=04, P2=0C
        var apdu = Data([APDU.CLA_ISO, APDU.INS_SELECT_FILE, 0x04, 0x0C])
        apdu.append(UInt8(df.count))
        apdu.append(df)
        
        let res = try await manager.transmit(apdu: apdu)
        try checkSW(res, context: "Select DF")
    }
    
    // MARK: - PIN Verification
    
    // For Auth (4 digits) or Input Support (4 digits)
    func verifyPIN(ef: Data, pin: String) async throws {
        try await verifyPINInternal(ef: ef, pin: pin)
    }

    private func verifyPINInternal(ef: Data, pin: String) async throws {
        // 1. Select PIN EF
        var selApdu = Data([APDU.CLA_ISO, APDU.INS_SELECT_FILE, 0x02, 0x0C])
        selApdu.append(UInt8(ef.count))
        selApdu.append(ef)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select PIN EF")
        
        // 2. VERIFY
        // CLA=00, INS=20, P1=00, P2=80
        guard let pinData = pin.data(using: .utf8) else {
             throw NSError(domain: "JPKIController", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid PIN encoding"])
        }
        
        var verApdu = Data([APDU.CLA_ISO, APDU.INS_VERIFY, 0x00, 0x80])
        verApdu.append(UInt8(pinData.count))
        verApdu.append(pinData)
        
        let resVer = try await manager.transmit(apdu: verApdu)
        try checkSW(resVer, context: "Verify PIN")
    }
    
    // MARK: - Reading My Number    
    func readMyNumber(pin: String) async throws -> String {
        // 1. Select Input Support AP
        try await selectInputSupportAP()
        
        // 2. Verify PIN (4 digits)
        try await verifyPIN(ef: FileID.EF_INPUT_SUPPORT_PIN, pin: pin)
        
        // 3. Read My Number EF (0001)
        let data = try await readEFFull(ef: FileID.EF_MYNUMBER)
        
        // 4. Parse (12 digits)
        // Data usually contains 12 digits directly, or inside a block.
        // We scan for 12 consecutive digits in raw bytes.
        
        // Find sequence of 12 digits (ASCII 0x30...0x39)
        let digitRange = UInt8(ascii: "0")...UInt8(ascii: "9")
        var consecutiveDigits = 0
        var startIndex = 0
        
        for (index, byte) in data.enumerated() {
            if digitRange.contains(byte) {
                if consecutiveDigits == 0 {
                    startIndex = index
                }
                consecutiveDigits += 1
                
                if consecutiveDigits == 12 {
                    // Found 12 digits
                    let numberData = data.subdata(in: startIndex..<startIndex+12)
                    if let numberStr = String(data: numberData, encoding: .ascii) {
                        return numberStr
                    }
                }
            } else {
                consecutiveDigits = 0
            }
        }
        
        throw NSError(domain: "JPKIController", code: 5, userInfo: [NSLocalizedDescriptionKey: "Could not find 12-digit My Number in data (len=\(data.count))"])
    }
    
    // MARK: - Reading Attributes
    
    func readAttributes(pin: String) async throws -> BasicInfo {
        // 1. Select Input Support AP
        try await selectInputSupportAP()
        
        // 2. Verify PIN
        try await verifyPIN(ef: FileID.EF_INPUT_SUPPORT_PIN, pin: pin)
        
        // 3. Read Attributes EF
        let data = try await readEFFull(ef: FileID.EF_ATTRIBUTES)
        
        // 4. Parse
        return try parseBasicInfo(data: data)
    }
    
    // MARK: - Helpers
    
    private func readEFFull(ef: Data) async throws -> Data {
        // Select EF
        var selApdu = Data([APDU.CLA_ISO, APDU.INS_SELECT_FILE, 0x02, 0x0C])
        selApdu.append(UInt8(ef.count))
        selApdu.append(ef)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select EF for Read")
        
        var resultData = Data()
        var offset: UInt16 = 0
        
        while true {
            let p1 = UInt8((offset >> 8) & 0xFF)
            let p2 = UInt8(offset & 0xFF)
            // READ BINARY: CLA=00, INS=B0, P1, P2, Le=00 (Max)
            let readApdu = Data([APDU.CLA_ISO, APDU.INS_READ_BINARY, p1, p2, 0x00])
            
            let res = try await manager.transmit(apdu: readApdu)
            // Last 2 bytes are SW
            if res.count < 2 { break }
            let chunk = res.subdata(in: 0..<res.count-2)
            
            if chunk.isEmpty { break }
            resultData.append(chunk)
            offset += UInt16(chunk.count)
            
            // If less than 256 bytes returned (assuming standard Le=00 behavior), likely EOF
            // Though strict check is loop until empty or error
            if chunk.count < 256 { break }
        }
        
        return resultData
    }
    
    private func checkSW(_ data: Data, context: String) throws {
        if data.count < 2 {
            throw NSError(domain: "JPKIController", code: 2, userInfo: [NSLocalizedDescriptionKey: "\(context): Response too short"])
        }
        let sw1 = data[data.count - 2]
        let sw2 = data[data.count - 1]
        
        if sw1 == 0x90 && sw2 == 0x00 {
            return
        }
        
        throw NSError(domain: "JPKIController", code: 3, userInfo: [NSLocalizedDescriptionKey: "\(context) failed with SW=\(String(format: "%02X%02X", sw1, sw2))"])
    }
    
    private func parseBasicInfo(data: Data) throws -> BasicInfo {
        var info = BasicInfo()
        var i = 0
        let len = data.count
        
        while i < len {
            // Tag (2 bytes usually for these specific tags)
            if i + 1 >= len { break }
            let tag = (UInt16(data[i]) << 8) | UInt16(data[i+1])
            i += 2
            
            // Length (ASN.1 BER-TLV)
            if i >= len { break }
            var valueLen = Int(data[i])
            i += 1
            
            if valueLen == 0x81 {
                if i >= len { break }
                valueLen = Int(data[i])
                i += 1
            } else if valueLen == 0x82 {
                if i + 1 >= len { break }
                valueLen = (Int(data[i]) << 8) | Int(data[i+1])
                i += 2
            } else if valueLen > 0x82 {
                break // Unsupported
            }
            
            // Wrapper tags
            if tag == 0xDF20 || tag == 0xFF20 {
                continue
            }
            
            if i + valueLen > len { break }
            let valueData = data.subdata(in: i..<i+valueLen)
            i += valueLen
            
            guard let text = String(data: valueData, encoding: .utf8) else { continue }
            
            switch tag {
            case 0xDF22: info.name = text
            case 0xDF23: info.address = text
            case 0xDF24: info.birthDate = text
            case 0xDF25: info.gender = text
            default: break
            }
        }
        
        return info
    }
}
