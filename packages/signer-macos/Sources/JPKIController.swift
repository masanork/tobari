import Foundation
import CryptoKit

struct BasicInfo: Codable {
    var name: String = ""
    var address: String = ""
    var birthDate: String = ""
    var gender: String = ""
    var facePhoto: String? = nil // Base64 encoded
}

class JPKIController {
    let manager: SmartCardInterface
    
    // Constants
    enum FileID {
        static let DF_JPKI = Data([0xD3, 0x92, 0xf0, 0x00, 0x26, 0x01, 0x00, 0x00, 0x00, 0x01])
        static let DF_INPUT_SUPPORT = Data([0xD3, 0x92, 0x10, 0x00, 0x31, 0x00, 0x01, 0x01, 0x04, 0x08])
        static let DF_FACE_RECOGNITION = Data([0xD3, 0x92, 0x10, 0x00, 0x31, 0x00, 0x01, 0x01, 0x04, 0x02])
        
        static let EF_AUTH_PIN = Data([0x00, 0x18])
        static let EF_SIGN_PIN = Data([0x00, 0x1B]) // Digital Signature PIN (6-16 chars)
        static let EF_INPUT_SUPPORT_PIN = Data([0x00, 0x11])
        static let EF_MYNUMBER = Data([0x00, 0x01])
        static let EF_ATTRIBUTES = Data([0x00, 0x02])
        static let EF_SURFACE_INFO = Data([0x00, 0x05])
        static let EF_SURFACE_INFO_B = Data([0x00, 0x06])
        static let EF_FACE_PHOTO = Data([0x00, 0x02]) // Usually under Face Recognition AP
        static let EF_AUTH_KEY = Data([0x00, 0x17])
        static let EF_SIGN_KEY = Data([0x00, 0x1A]) // Digital Signature Key
        static let EF_USER_AUTH_CERT = Data([0x00, 0x0A])
        static let EF_SIGN_CERT = Data([0x00, 0x01]) // Digital Signature Certificate
    }
    
    enum APDU {
        static let CLA_ISO: UInt8 = 0x00
        static let INS_SELECT_FILE: UInt8 = 0xA4
        static let INS_READ_BINARY: UInt8 = 0xB0
        static let INS_VERIFY: UInt8 = 0x20
        static let INS_COMPUTE_DIGITAL_SIGNATURE: UInt8 = 0x2A
    }
    
    init(manager: SmartCardInterface) {
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
    
    private func selectEF(_ ef: Data) async throws {
        // SELECT FILE (EF): CLA=00, INS=A4, P1=02, P2=0C
        var apdu = Data([APDU.CLA_ISO, APDU.INS_SELECT_FILE, 0x02, 0x0C])
        apdu.append(UInt8(ef.count))
        apdu.append(ef)
        
        let res = try await manager.transmit(apdu: apdu)
        try checkSW(res, context: "Select EF")
    }

    // MARK: - PIN Verification
    
    // For Auth (4 digits) or Input Support (4 digits)
    func verifyPIN(ef: Data, pin: String) async throws {
        try await verifyPINInternal(ef: ef, pin: pin)
    }

    func getPINRetryCount(ef: Data) async throws -> Int {
        // Select PIN EF
        try await selectEF(ef)
        
        // VERIFY with empty Lc to get retry count: CLA=00, INS=20, P1=00, P2=80, Lc=absent
        let verApdu = Data([APDU.CLA_ISO, APDU.INS_VERIFY, 0x00, 0x80])
        let res = try await manager.transmit(apdu: verApdu)
        
        if res.count >= 2 {
            let sw1 = res[res.count - 2]
            let sw2 = res[res.count - 1]
            if sw1 == 0x63 {
                return Int(sw2 & 0x0F) // SW2=CX means X attempts left
            } else if sw1 == 0x90 && sw2 == 0x00 {
                return 3 // Or whatever max is, but usually 9000 means already verified or no limit info
            }
        }
        return -1 // Unknown
    }

    private func verifyPINInternal(ef: Data, pin: String) async throws {
        // 1. Select PIN EF
        try await selectEF(ef)
        
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
    
    // MARK: - Certificate
    
    func readCertificate(pin: String, type: String = "auth") async throws -> Data {
        // 1. Select JPKI AP
        try await selectJPKIAP()
        
        // 2. Verify PIN
        if type == "sign" {
            try await verifyPIN(ef: FileID.EF_SIGN_PIN, pin: pin)
            // 3. Read Certificate EF
            return try await readEFFull(ef: FileID.EF_SIGN_CERT)
        } else {
            try await verifyPIN(ef: FileID.EF_AUTH_PIN, pin: pin)
            // 3. Read Certificate EF
            return try await readEFFull(ef: FileID.EF_USER_AUTH_CERT)
        }
    }

    struct CertificateInfo: Codable {
        let subject: String
        let publicKeyJWK: String?
    }

    func parseCertificate(_ certData: Data) -> CertificateInfo? {
        guard let certificate = SecCertificateCreateWithData(nil, certData as CFData) else {
            return nil
        }
        
        let subject = SecCertificateCopySubjectSummary(certificate) as String? ?? "Unknown"
        let jwk = extractPublicKeyJWK(from: certData)
        
        return CertificateInfo(
            subject: subject,
            publicKeyJWK: jwk
        )
    }

    func extractPublicKeyJWK(from certData: Data) -> String? {
        guard let certificate = SecCertificateCreateWithData(nil, certData as CFData) else {
            return nil
        }
        
        guard let publicKey = SecCertificateCopyKey(certificate) else {
            return nil
        }
        
        var error: Unmanaged<CFError>?
        guard let keyData = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            return nil
        }
        
        var offset = 0
        let bytes = [UInt8](keyData)
        if bytes.isEmpty { return nil }
        
        if bytes[offset] != 0x30 { return nil }
        offset += 1
        let _ = decodeLength(bytes, &offset)
        
        if offset >= bytes.count || bytes[offset] != 0x02 { return nil }
        offset += 1
        let nLen = decodeLength(bytes, &offset)
        if offset + nLen > bytes.count { return nil }
        var nData = keyData.subdata(in: offset..<offset+nLen)
        offset += nLen
        
        if nData.first == 0x00 {
            nData = nData.dropFirst()
        }
        
        if offset >= bytes.count || bytes[offset] != 0x02 { return nil }
        offset += 1
        let eLen = decodeLength(bytes, &offset)
        if offset + eLen > bytes.count { return nil }
        let eData = keyData.subdata(in: offset..<offset+eLen)
        
        let nB64 = nData.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        let eB64 = eData.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
            
        return """
        {
          "kty": "RSA",
          "n": "\(nB64)",
          "e": "\(eB64)",
          "alg": "RS256",
          "use": "sig"
        }
        """
    }

    private func decodeLength(_ bytes: [UInt8], _ offset: inout Int) -> Int {
        if offset >= bytes.count { return 0 }
        let first = bytes[offset]
        offset += 1
        if first < 0x80 {
            return Int(first)
        } else {
            let numBytes = Int(first & 0x7F)
            var len = 0
            for _ in 0..<numBytes {
                if offset >= bytes.count { break }
                len = (len << 8) | Int(bytes[offset])
                offset += 1
            }
            return len
        }
    }

    // MARK: - Signing
    
    func computeSignature(pin: String, data: Data, type: String = "auth") async throws -> Data {
        // 1. Select JPKI AP
        try await selectJPKIAP()
        
        // 2. Verify PIN
        let keyEF: Data
        if type == "sign" {
            try await verifyPIN(ef: FileID.EF_SIGN_PIN, pin: pin)
            keyEF = FileID.EF_SIGN_KEY
        } else {
            try await verifyPIN(ef: FileID.EF_AUTH_PIN, pin: pin)
            keyEF = FileID.EF_AUTH_KEY
        }
        
        // 3. Select Private Key EF
        try await selectEF(keyEF)
        
        // 4. Hash Data (SHA256)
        let digest = SHA256.hash(data: data)
        
        // 5. Construct DigestInfo (SHA-256)
        var digestInfo = Data([
            0x30, 0x31, 0x30, 0x0D, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02,
            0x01, 0x05, 0x00, 0x04, 0x20
        ])
        digestInfo.append(Data(digest))
        
        // 6. Compute Digital Signature
        var signApdu = Data([0x80, APDU.INS_COMPUTE_DIGITAL_SIGNATURE, 0x00, 0x80])
        signApdu.append(UInt8(digestInfo.count))
        signApdu.append(digestInfo)
        signApdu.append(0x00)
        
        let res = try await manager.transmit(apdu: signApdu)
        try checkSW(res, context: "Compute Digital Signature")
        
        return res.subdata(in: 0..<res.count-2)
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

    // MARK: - Reading Face Photo
    
    func readFacePhoto(pin: String) async throws -> Data {
        // 1. Select Face Recognition AP
        try await selectDF(FileID.DF_FACE_RECOGNITION)
        
        // 2. Verify PIN (using the same PIN EF ID 00 11 as Input Support usually works, or it is the specific PIN EF for this AP)
        // Note: In many implementations, the PIN EF is 00 11 for 4-digit PINs across APs.
        try await verifyPIN(ef: FileID.EF_INPUT_SUPPORT_PIN, pin: pin)
        
        // 3. Read Face Photo EF (00 02)
        let data = try await readEFFull(ef: FileID.EF_FACE_PHOTO)
        
        // 4. Parse TLV to find tag DF27
        return try extractFacePhoto(from: data)
    }
    
    private func extractFacePhoto(from data: Data) throws -> Data {
        var i = 0
        let len = data.count
        
        while i < len {
            // Tag
            if i + 1 >= len { break }
            let tag = (UInt16(data[i]) << 8) | UInt16(data[i+1])
            i += 2
            
            // Length
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
            
            if i + valueLen > len { break }
            let valueData = data.subdata(in: i..<i+valueLen)
            
            if tag == 0xDF27 {
                return valueData
            }
            
            // If it's a constructed tag (like DF20 or FF20), strictly we should recurse,
            // but for face photo it is often at top level or inside DF20.
            // Simple approach: if not found, continue.
            // If we need recursion, we can implement it, but let's try linear scan for now
            // or if it's nested, we just treat the value as nested TLV stream?
            // Actually, usually DF27 is inside a wrapper.
            // Let's implement a recursive-like search by just scanning the whole buffer for DF 27?
            // No, that's dangerous.
            // Let's assume standard structure: Wrapper -> DF27.
            
            if tag == 0xDF20 || tag == 0xFF20 {
                 // Recurse / Dive into this value
                 if let found = try? extractFacePhoto(from: valueData) {
                     return found
                 }
            }
            
            i += valueLen
        }
        
        throw NSError(domain: "JPKIController", code: 6, userInfo: [NSLocalizedDescriptionKey: "Face photo tag (DF27) not found"])
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
            // READ BINARY with Extended Le: CLA=00, INS=B0, P1, P2, Le=00 00 00 (65536 bytes)
            let readApdu = Data([APDU.CLA_ISO, APDU.INS_READ_BINARY, p1, p2, 0x00, 0x00, 0x00])
            
            let res = try await manager.transmit(apdu: readApdu)
            // Last 2 bytes are SW
            if res.count < 2 { break }
            let chunk = res.subdata(in: 0..<res.count-2)
            
            if chunk.isEmpty { break }
            resultData.append(chunk)
            offset += UInt16(chunk.count)
            
            // If less than requested (and not exactly 256 or multiple of block), likely EOF
            // With Extended Le, if we get anything, we check if it's the end.
            // If we got some data, but the status is 9000, we check if more is needed.
            // For now, if we get any data, we append. If SW is 9000 and chunk is not empty, 
            // we continue until we get an error or empty chunk.
            if chunk.isEmpty { break }
            
            // To be safe with some readers, if we get less than a "typical" extended chunk
            // but still got data, we might want to continue or stop.
            // Most cards will just return what's available up to Le.
            break // If we used Extended Le and got data, we likely got the whole EF or a large chunk.
        }
        
        return resultData
    }
    
    private func checkSW(_ data: Data, context: String) throws {
        if data.count < 2 {
            throw SignerError.jpki("\(context): Response too short")
        }
        let sw1 = data[data.count - 2]
        let sw2 = data[data.count - 1]
        
        if sw1 == 0x90 && sw2 == 0x00 {
            return
        }
        
        if sw1 == 0x63 && (sw2 & 0xF0) == 0xC0 {
            throw SignerError.pinIncorrect(retries: Int(sw2 & 0x0F))
        }
        
        if sw1 == 0x69 && sw2 == 0x83 {
            throw SignerError.pinLocked
        }
        
        throw SignerError.jpki("\(context) failed with SW=\(String(format: "%02X%02X", sw1, sw2))")
    }
    
    private func parseBasicInfo(data: Data) throws -> BasicInfo {
        var info = BasicInfo()
        let tlvs = TLVParser.parse(data: data)
        
        // JPKI attributes can be siblings or nested under 0xDF20.
        // We'll flatten the first level of nesting to be sure.
        var allTlvs = tlvs
        for tlv in tlvs {
            if tlv.tag == 0xDF20 {
                allTlvs.append(contentsOf: TLVParser.parse(data: tlv.value))
            }
        }
        
        func getString(tag: UInt32) -> String? {
            guard let data = allTlvs.first(where: { $0.tag == tag })?.value else { return nil }
            return String(data: data, encoding: .utf8)
        }
        
        if let name = getString(tag: 0xDF22) { info.name = name }
        if let address = getString(tag: 0xDF23) { info.address = address }
        if let birthDate = getString(tag: 0xDF24) { info.birthDate = birthDate }
        if let gender = getString(tag: 0xDF25) { info.gender = gender }
        
        return info
    }
}
