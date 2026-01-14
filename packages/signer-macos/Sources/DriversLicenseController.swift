import Foundation

struct LicenseInfo: Codable {
    let name: String
    let address: String
    let birthDate: String
    let licenseNumber: String
    let issueDate: String
    let expiryDate: String
    let colorClass: String
    var registeredDomicile: String? = nil
    var facePhoto: String? = nil // Base64
    var signature: String? = nil // Base64
    var rawDataGroup1: String? = nil // Base64 raw bytes of common data
    var debugDump: String? = nil // Debug info
}

class DriversLicenseController {
    let manager: SmartCardInterface
    
    // JPDL AID (Common Data)
    static let AID_JPDL = Data([0xA0, 0x00, 0x00, 0x02, 0x31, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    // JPDL AID (Photo)
    static let AID_JPDL_PHOTO = Data([0xA0, 0x00, 0x00, 0x02, 0x31, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    
    init(manager: SmartCardInterface) {
        self.manager = manager
    }
    
    func selectDLAP() async throws {
        try await selectAP(aid: Self.AID_JPDL)
    }
    
    func selectPhotoAP() async throws {
        try await selectAP(aid: Self.AID_JPDL_PHOTO)
    }

    func selectMF() async throws {
        let apdu = Data([0x00, 0xA4, 0x00, 0x00]) // Select MF by ID
        let res = try await manager.transmit(apdu: apdu)
        // Note: Some cards might not return 9000 for MF if already selected, but usually they do.
        try? checkSW(res, context: "Select MF")
    }
    
    private func selectAP(aid: Data) async throws {
        var apdu = Data([0x00, 0xA4, 0x04, 0x0C])
        apdu.append(UInt8(aid.count))
        apdu.append(aid)
        let res = try await manager.transmit(apdu: apdu)
        try checkSW(res, context: "Select AP")
    }
    
    func verifyPIN1(_ pin: String) async throws {
        try await selectMF()
        try await verifyPIN(iefID: Data([0x00, 0x01]), pin: pin)
    }

    func verifyPIN2(_ pin: String) async throws {
        try await selectMF()
        try await verifyPIN(iefID: Data([0x00, 0x02]), pin: pin)
    }

    private func verifyPIN(iefID: Data, pin: String) async throws {
        // First, select the IEF (PIN file) using SELECT FILE
        var selApdu = Data([0x00, 0xA4, 0x02, 0x0C])
        selApdu.append(UInt8(iefID.count))
        selApdu.append(iefID)
        let resSel = try await manager.transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select IEF")

        // Then verify with P2=0x80 (current selected file)
        let pinData = pin.data(using: .ascii) ?? Data()
        var verApdu = Data([0x00, 0x20, 0x00, 0x80])
        verApdu.append(UInt8(pinData.count))
        verApdu.append(pinData)

        let resVer = try await manager.transmit(apdu: verApdu)
        try checkSW(resVer, context: "Verify PIN")
    }
    
    func readData(pin1: String, pin2: String?) async throws -> LicenseInfo {
        // 1. Verify PIN1 (Starts from MF)
        try await verifyPIN1(pin1)
        
        // 2. Select DF1 and Read Common Data
        try await selectDLAP()
        let data = try await readEF(fileID: Data([0x00, 0x01]))
        var info = try parseLicenseInfo(data: data)
        info.rawDataGroup1 = data.base64EncodedString()
        
        // 3. Read Signature (EF07 in DF1 according to jpdl.rs, or EF02 in some mocks)
        // Standard JPDL: Signature is EF07 (00 07)
        if let sig = try? await readEF(fileID: Data([0x00, 0x07])) {
            info.signature = sig.base64EncodedString()
        }
        
        // 4. Verify PIN2 if provided
        if let pin2 = pin2, !pin2.isEmpty {
            do {
                try await verifyPIN2(pin2)
                
                // 5. Read Registered Domicile (EF02 in DF1)
                try await selectDLAP()
                if let honsekiData = try? await readEF(fileID: Data([0x00, 0x02])) {
                    let tlvs = TLVParser.parse(data: honsekiData)
                    // Search for tag 0x41 in all root TLVs
                    for tlv in tlvs {
                        if let found = tlv.find(tag: 0x41) {
                            let value = found.value
                            if value.count > 0 {
                                let sjisData = convertJISToSJIS(value)
                                info.registeredDomicile = decodeSJIS(sjisData)
                            } else {
                                info.registeredDomicile = ""
                            }
                            break
                        }
                    }
                }
                
                // 6. Read Photo (EF01 in DF2)
                try await selectPhotoAP()
                if let photoData = try? await readEF(fileID: Data([0x00, 0x01])) {
                    let photoTlvs = TLVParser.parse(data: photoData)
                    info.debugDump? += "\nPhoto TLVs:\n"
                    for tlv in photoTlvs {
                        info.debugDump? += dumpTLV(tlv)
                    }
                    
                    // Find Tag 5F40
                    for tlv in photoTlvs {
                        if let found = tlv.find(tag: 0x5F40) {
                            info.facePhoto = found.value.base64EncodedString()
                            break
                        }
                    }
                    // Fallback: if no tag found, maybe raw? (Unlikely for JPDL)
                    if info.facePhoto == nil && !photoData.isEmpty {
                         info.facePhoto = photoData.base64EncodedString()
                    }
                }
            } catch {
                print("Warning: Failed to read sensitive data with PIN2: \(error.localizedDescription)")
                info.debugDump? += "\nPIN2 Read Failed: \(error.localizedDescription)"
            }
        }
        
        return info
    }
    
    func readCommonData() async throws -> LicenseInfo {
        let data = try await readEF(fileID: Data([0x00, 0x01]))
        var info = try parseLicenseInfo(data: data)
        info.rawDataGroup1 = data.base64EncodedString()
        
        // Also read signature
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
        
        var dump = "Parsed TLVs:\n"
        for tlv in tlvs {
            dump += dumpTLV(tlv)
        }
        
        func find(_ tag: UInt32, isText: Bool = true, skip: Int = 0) -> String {
            for tlv in tlvs {
                if let found = tlv.find(tag: tag) {
                    var value = found.value
                    if value.count <= skip { return "" }
                    value = value.dropFirst(skip)
                    
                    if isText {
                        let sjisData = convertJISToSJIS(value)
                        return decodeSJIS(sjisData)
                    } else {
                        // ASCII/Number
                        return String(data: value, encoding: .ascii) ?? ""
                    }
                }
            }
            return "Unknown"
        }
        
        // Tags based on TRETJapanNFCReader
        // Analysis shows no header skip needed for text fields
        let name = find(0x12, isText: true, skip: 0)
        let address = find(0x17, isText: true, skip: 0)
        let birthDate = formatGengouDate(find(0x16, isText: false, skip: 0))
        let issueDate = formatGengouDate(find(0x18, isText: false, skip: 0))
        let expiryDate = formatGengouDate(find(0x1B, isText: false, skip: 0))
        let licenseNumber = find(0x21, isText: false, skip: 0)
        let colorClass = find(0x1A, isText: true, skip: 0)
        
        var info = LicenseInfo(
            name: name,
            address: address,
            birthDate: birthDate,
            licenseNumber: licenseNumber,
            issueDate: issueDate,
            expiryDate: expiryDate,
            colorClass: colorClass,
            signature: nil
        )
        info.debugDump = dump
        return info
    }
    
    private func formatGengouDate(_ dateStr: String) -> String {
        guard dateStr.count == 7 else { return dateStr }
        let eraChar = dateStr.prefix(1)
        let yearStr = dateStr.dropFirst(1).prefix(2)
        let monthStr = dateStr.dropFirst(3).prefix(2)
        let dayStr = dateStr.dropFirst(5).prefix(2)
        
        guard let year = Int(yearStr) else { return dateStr }
        
        var eraName = ""
        
        switch eraChar {
        case "1": // Meiji (1868-1912)
            eraName = "明治"
        case "2": // Taisho (1912-1926)
            eraName = "大正"
        case "3": // Showa (1926-1989)
            eraName = "昭和"
        case "4": // Heisei (1989-2019)
            eraName = "平成"
        case "5": // Reiwa (2019-)
            eraName = "令和"
        default:
            return dateStr
        }
        
        return "\(eraName)\(year)年\(monthStr)月\(dayStr)日"
    }
    
    private func convertJISToSJIS(_ data: Data) -> Data {
        var res = Data()
        var i = 0
        let bytes = [UInt8](data)
        while i < bytes.count - 1 {
            let c1 = bytes[i]
            let c2 = bytes[i+1]
            
            // Check if it's a valid JIS X 0208 pair (0x21-0x7E)
            if c1 >= 0x21 && c1 <= 0x7E && c2 >= 0x21 && c2 <= 0x7E {
                var s1 = (c1 - 0x21) / 2
                if s1 <= 0x1E { s1 += 0x81 } else { s1 += 0xC1 }
                
                var s2 = c2
                if c1 % 2 != 0 {
                    s2 += 0x1F
                } else {
                    s2 += 0x7D
                }
                if s2 >= 0x7F { s2 += 1 }
                
                res.append(s1)
                res.append(s2)
                i += 2
            } else {
                // Treat as single byte (ASCII/Hankaku)
                res.append(c1)
                i += 1
            }
        }
        if i < bytes.count {
            res.append(bytes[i])
        }
        return res
    }
    
    private func dumpTLV(_ tlv: TLV, indent: String = "") -> String {
        var str = "\(indent)Tag: \(String(format: "%02X", tlv.tag)) Len: \(tlv.value.count) Value: \(tlv.value.map { String(format: "%02X", $0) }.joined())\n"
        for child in tlv.children {
            str += dumpTLV(child, indent: indent + "  ")
        }
        return str
    }
    
    private func decodeSJIS(_ data: Data) -> String {
        let bytes = [UInt8](data)
        if let str = CFStringCreateWithBytes(kCFAllocatorDefault, bytes, bytes.count, UInt32(CFStringEncodings.dosJapanese.rawValue), false) {
            return str as String
        }
        // Fallback: try removing invalid bytes or just return hex if failed?
        // For now, return a placeholder to indicate decoding failure but presence of data
        return "<?>"
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
            // Short Le: 00 B0 P1 P2 00 (requests 256 bytes)
            let readApdu = Data([0x00, 0xB0, p1, p2, 0x00])
            let res = try await manager.transmit(apdu: readApdu)
            
            if res.count < 2 { break }
            let sw = (UInt16(res[res.count-2]) << 8) | UInt16(res[res.count-1])
            let chunk = res.prefix(res.count-2)
            
            if sw == 0x9000 {
                result.append(chunk)
                offset += chunk.count
                if chunk.count < 256 { break }
            } else if sw == 0x6B00 { // Offset out of range (EOF)
                break
            } else if sw == 0x6C00 || (sw & 0xFF00) == 0x6100 {
                // Wrong length, the card tells us the correct length in the last byte
                let correctLe = res[res.count-1]
                let retryApdu = Data([0x00, 0xB0, p1, p2, correctLe])
                let retryRes = try await manager.transmit(apdu: retryApdu)
                try checkSW(retryRes, context: "Read Binary (retry)")
                let retryChunk = retryRes.prefix(retryRes.count-2)
                result.append(retryChunk)
                break
            } else {
                try checkSW(res, context: "Read Binary at \(offset)")
            }
        }
        return result
    }
    
    private func checkSW(_ data: Data, context: String) throws {
        if data.count < 2 { throw SignerError.driverLicense("\(context): too short") }
        let sw1 = data[data.count-2]
        let sw2 = data[data.count-1]

        if sw1 == 0x90 && sw2 == 0x00 { return }
        if sw1 == 0x63 && (sw2 & 0xF0) == 0xC0 {
            throw SignerError.pinIncorrect(retries: Int(sw2 & 0x0F))
        }
        if sw1 == 0x69 && sw2 == 0x83 {
            throw SignerError.pinLocked
        }
        throw SignerError.driverLicense("\(context) failed: \(String(format: "%02X%02X", sw1, sw2))")
    }
}