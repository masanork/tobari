import Foundation
import CryptoKit
import CommonCrypto

struct PassportInfo: Codable {
    var name: String = ""
    var passportNumber: String = ""
    var nationality: String = ""
    var birthDate: String = ""
    var gender: String = ""
    var expiryDate: String = ""
    var address: String?
    var issuingAuthority: String?
    var issueDate: String?
    var facePhoto: String? // Base64
    var sod: String? // Base64 EF.SOD
    var protocolUsed: String = "Unknown"
    var dg14: String? // Security Infos
    var dg15: String? // AA Public Key
}

class PassportController {
    let manager: SmartCardInterface
    private var sm: SecureMessaging?
    private var currentProtocol: String = "None"
    
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
    
    /// Performs PACE (Password Authenticated Connection Establishment)
    func performPACE(password: String, isCan: Bool = false) async throws {
        self.currentProtocol = "PACE"
        // 1. MSE:Set AT
        // CLA=00, INS=22, P1=C1, P2=A4, Lc=0F (Algorithm: PACE-ECDH-GM-AES-CBC-CMAC-128, etc)
        // Data identifies the password type (MRZ or CAN)
        let pwdTag: UInt8 = isCan ? 0x02 : 0x01
        let algID = Data([0x04, 0x00, 0x7F, 0x00, 0x07, 0x02, 0x02, 0x04, 0x02, 0x02]) // Example OID for ECDH-GM
        var mseData = Data([0x80])
        mseData.append(UInt8(algID.count))
        mseData.append(algID)
        mseData.append(contentsOf: [0x83, 0x01, pwdTag])
        
        var mseApdu = Data([0x00, 0x22, 0xC1, 0xA4, UInt8(mseData.count)])
        mseApdu.append(mseData)
        let mseRes = try await manager.transmit(apdu: mseApdu)
        try checkSW(mseRes, context: "MSE:Set AT")
        
        // 2. Step 1: Get Encrypted Nonce
        // GENERAL AUTHENTICATE: 00 86 00 00 02 7C 00 00
        let ga1Res = try await manager.transmit(apdu: Data([0x00, 0x86, 0x00, 0x00, 0x02, 0x7C, 0x00, 0x00]))
        try checkSW(ga1Res, context: "PACE GA1")
        // Extract nonce (Tag 80 inside 7C)
        let encryptedNonce = ga1Res.subdata(in: 4..<ga1Res.count-2)
        
        // 3. Step 2: Map Nonce (Exchange ephemeral keys)
        let kPace = PassportKDF.derivePaceKey(password: password, isCan: isCan)
        let nonce = try aesDecrypt(data: encryptedNonce, key: kPace)
        
        let ephemeralSecretIf = P256.KeyAgreement.PrivateKey()
        let ephemeralPubIf = ephemeralSecretIf.publicKey.x963Representation
        
        // Compute G' = [nonce]G + P_if
        let gPrimeData = try ECMath.computeMappedGenerator(scalarS: nonce, pointP: ephemeralPubIf)
        
        var ga2Data = Data([0x7C, UInt8(ephemeralPubIf.count + 2), 0x81])
        ga2Data.append(UInt8(ephemeralPubIf.count))
        ga2Data.append(ephemeralPubIf)
        
        var ga2Apdu = Data([0x00, 0x86, 0x00, 0x00, UInt8(ga2Data.count)])
        ga2Apdu.append(ga2Data)
        ga2Apdu.append(0x00) // Le
        
        let ga2Res = try await manager.transmit(apdu: ga2Apdu)
        try checkSW(ga2Res, context: "PACE GA2")
        
        // GA2 Response contains the Card's ephemeral public key P_ic (Tag 82)
        // We skip exact parsing for now and assume the card followed the protocol.
        
        // 4. Step 3: Key Agreement on Mapped Curve
        // Remote public key P_ic is in ga2Res (Tag 82)
        // For brevity in this POC, we extract the payload of Tag 82 (assumed at fixed offset or via simple TLV)
        let cardPubKaData = ga2Res.subdata(in: 4..<ga2Res.count-2)
        
        let (ephemeralPubFinal, sharedSecret) = try ECMath.performECDHWithMappedGenerator(gPrimeData: gPrimeData, remotePublicKeyData: cardPubKaData)
        
        // Step 3: Exchange ephemeral public keys for final shared secret (GA3)
        var ga3Data = Data([0x7C, UInt8(ephemeralPubFinal.count + 2), 0x83])
        ga3Data.append(UInt8(ephemeralPubFinal.count))
        ga3Data.append(ephemeralPubFinal)
        
        var ga3Apdu = Data([0x00, 0x86, 0x00, 0x00, UInt8(ga3Data.count)])
        ga3Apdu.append(ga3Data)
        ga3Apdu.append(0x00)
        
        let ga3Res = try await manager.transmit(apdu: ga3Apdu)
        try checkSW(ga3Res, context: "PACE GA3")
        
        // 5. Establish Secure Messaging
        let (ksEnc, ksMac) = PACEUtils.deriveSessionKeys(sharedSecret: sharedSecret)
        
        // SSC is typically initialized to 0 or derived from previous steps in PACE
        self.sm = SecureMessaging(ksEnc: ksEnc, ksMac: ksMac, ssc: 0, proto: .pace)
        
        debugPrint("PACE Secure Messaging Established with Shared Secret: \(sharedSecret.count) bytes")
    }
    
    /// Performs BAC (Basic Access Control) Mutual Authentication
    func performBAC(mrz: String) async throws {
        self.currentProtocol = "BAC"
        // 1. Derive Static Keys from MRZ
        let (kEnc, kMac) = try PassportKDF.deriveKeys(mrz: mrz)
        
        // 2. Get Challenge (RND.IC)
        // CLA=00, INS=84 (GET CHALLENGE), P1=00, P2=00, Le=08
        let getChallengeApdu = Data([0x00, 0x84, 0x00, 0x00, 0x08])
        let rndIcRes = try await manager.transmit(apdu: getChallengeApdu)
        try checkSW(rndIcRes, context: "Get Challenge")
        let rndIc = rndIcRes.prefix(8)
        if rndIc.count != 8 {
            throw SignerError.passport("Invalid RND.IC length: \(rndIc.count)")
        }
        
        // 3. Prepare Mutual Authentication Data
        var rng = SystemRandomNumberGenerator()
        let rndIf = Data((0..<8).map { _ in UInt8.random(in: 0...255, using: &rng) })
        let kIf = Data((0..<16).map { _ in UInt8.random(in: 0...255, using: &rng) })
        
        // S = RND.IF || RND.IC || K.IF
        var s = Data()
        s.append(rndIf)
        s.append(rndIc)
        s.append(kIf)
        
        // E.IF = Enc(Kenc, S) using 3DES-CBC with IV=0
        let eIf = try des3Encrypt(data: s, key: kEnc)
        
        // M.IF = Retail-MAC(Kmac, E.IF)
        let mIf = try calculateRetailMAC(data: eIf, key: kMac)
        
        // 4. Send EXTERNAL AUTHENTICATE
        // CLA=00, INS=82, P1=00, P2=00, Lc=28, Data=E.IF || M.IF, Le=28
        var authApdu = Data([0x00, 0x82, 0x00, 0x00, 0x28])
        authApdu.append(eIf)
        authApdu.append(mIf)
        authApdu.append(0x28)
        
        let authRes = try await manager.transmit(apdu: authApdu)
        try checkSW(authRes, context: "Mutual Auth")
        
        // 5. Establish Session Keys
        let eIc = authRes.prefix(32)
        let sRes = try des3Decrypt(data: eIc, key: kEnc)
        // S.RES = RND.IC || RND.IF || K.IC
        if sRes.count < 32 {
             throw SignerError.passport("Invalid Mutual Auth Response length")
        }
        
        let decryptedRndIc = sRes.prefix(8)
        if decryptedRndIc != rndIc {
             let expected = rndIc.map { String(format: "%02X", $0) }.joined()
             let got = decryptedRndIc.map { String(format: "%02X", $0) }.joined()
             print("DEBUG: RND.IC mismatch! Expected: \(expected), Got: \(got)")
             throw SignerError.passport("Mutual Auth: RND.IC mismatch")
        }
        
        let decryptedRndIf = sRes.dropFirst(8).prefix(8)
        if decryptedRndIf != rndIf {
             let expected = rndIf.map { String(format: "%02X", $0) }.joined()
             let got = decryptedRndIf.map { String(format: "%02X", $0) }.joined()
             print("DEBUG: RND.IF mismatch! Expected: \(expected), Got: \(got)")
             throw SignerError.passport("Mutual Auth: RND.IF mismatch")
        }

        let kIc = Data(sRes.suffix(16)) // Reset indices
        
        // K.Seed = K.IF ^ K.IC
        var kSeed = Data(count: 16)
        for i in 0..<16 {
            kSeed[i] = kIf[i] ^ kIc[i]
        }
        
        // Derive KS.enc, KS.mac
        let ksEncBytes = deriveSessionKey(seed: kSeed, counter: [0x00, 0x00, 0x00, 0x01])
        let ksMacBytes = deriveSessionKey(seed: kSeed, counter: [0x00, 0x00, 0x00, 0x02])
        
        // 6. Initialize Secure Messaging
        // SSC = RND.IC(4-8) || RND.IF(4-8)
        var sscData = Data()
        sscData.append(rndIc.suffix(4))
        sscData.append(rndIf.suffix(4))
        let ssc = sscData.withUnsafeBytes { $0.load(as: UInt64.self).byteSwapped }
        
        self.sm = SecureMessaging(ksEnc: SymmetricKey(data: ksEncBytes), ksMac: SymmetricKey(data: ksMacBytes), ssc: ssc, proto: .bac)
        print("DEBUG: KS.Enc: \(ksEncBytes.map { String(format: "%02X", $0) }.joined())")
        print("DEBUG: KS.Mac: \(ksMacBytes.map { String(format: "%02X", $0) }.joined())")
        print("DEBUG: SSC: \(String(format: "%016llX", ssc))")
        debugPrint("Secure Messaging Established.")
    }
    
    func readDG1() async throws -> Data {
        return try await readEF(fileID: Data([0x01, 0x01]))
    }
    
    func readDG2() async throws -> Data {
        return try await readEF(fileID: Data([0x01, 0x02]))
    }
    
    func readDG11() async throws -> Data {
        return try await readEF(fileID: Data([0x01, 0x0B]))
    }
    
    func readDG12() async throws -> Data {
        return try await readEF(fileID: Data([0x01, 0x0C]))
    }
    
    func readSOD() async throws -> Data {
        return try await readEF(fileID: Data([0x01, 0x1D])) // EF.SOD is 01 1D
    }
    
    func readDG14() async throws -> Data {
        return try await readEF(fileID: Data([0x01, 0x0E]))
    }
    
    func readDG15() async throws -> Data {
        return try await readEF(fileID: Data([0x01, 0x0F]))
    }
    
    func readFullPassportInfo() async throws -> PassportInfo {
        let dg1 = try await readDG1()
        let dg2 = try await readDG2()
        let dg11 = try? await readDG11()
        let dg12 = try? await readDG12()
        let dg14 = try? await readDG14()
        let dg15 = try? await readDG15()
        let sod = try? await readSOD()
        
        var info = parseDG1(dg1)
        info.facePhoto = dg2.base64EncodedString()
        if let sodData = sod { info.sod = sodData.base64EncodedString() }
        if let dg14Data = dg14 { info.dg14 = dg14Data.base64EncodedString() }
        if let dg15Data = dg15 { info.dg15 = dg15Data.base64EncodedString() }
        info.protocolUsed = self.currentProtocol
        
        if let dg11Data = dg11 {
            let dg11Info = parseDG11(dg11Data)
            if info.name.isEmpty, let dg11Name = dg11Info.name { info.name = dg11Name }
            info.address = dg11Info.address
        }
        
        if let dg12Data = dg12 {
            let dg12Info = parseDG12(dg12Data)
            info.issuingAuthority = dg12Info.authority
            info.issueDate = dg12Info.issueDate
        }
        
        return info
    }
    
    private func parseDG1(_ data: Data) -> PassportInfo {
        // DG1 is Tag 61 -> L -> MRZ (TD3 is 88 bytes, TD1 is 90)
        let tlvs = TLVParser.parse(data: data)
        guard let mrzData = tlvs.first?.value,
              let mrz = String(data: mrzData, encoding: .ascii) else {
            return PassportInfo()
        }
        
        // Simple TD3 (Passport) MRZ parsing
        // Line 1: P<JPNKYOKUYA<<TARO<<<<<<<<<<<<<<<<<<<<<<<<
        // Line 2: TR77777770JPN8501019M2512311<<<<<<<<<<<<<<06
        let lines = mrz.split(separator: "\n").map(String.init)
        if lines.count < 2 { return PassportInfo() }
        
        let line1 = lines[0]
        let line2 = lines[1]
        
        var info = PassportInfo()
        if line1.count >= 44 {
            info.nationality = String(line1.prefix(5).suffix(3))
            let namePart = String(line1.suffix(39))
            info.name = namePart.replacingOccurrences(of: "<", with: " ").trimmingCharacters(in: .whitespaces)
        }
        
        if line2.count >= 44 {
            info.passportNumber = String(line2.prefix(9))
            info.birthDate = String(line2.prefix(19).suffix(6))
            info.gender = String(line2.prefix(21).suffix(1))
            info.expiryDate = String(line2.prefix(27).suffix(6))
        }
        
        return info
    }
    
    private func parseDG11(_ data: Data) -> (name: String?, address: String?) {
        let tlvs = TLVParser.parse(data: data)
        guard let wrapper = tlvs.first?.find(tag: 0x5C) else { return (nil, nil) }
        
        // Tags: 5F0E (Name), 5F11 (Address)
        let name = wrapper.findString(tag: 0x5F0E)
        let address = wrapper.findString(tag: 0x5F11)
        return (name, address)
    }
    
    private func parseDG12(_ data: Data) -> (authority: String?, issueDate: String?) {
        let tlvs = TLVParser.parse(data: data)
        guard let wrapper = tlvs.first?.find(tag: 0x5C) else { return (nil, nil) }
        
        // Tags: 5F19 (Issuing Authority), 5F26 (Issue Date)
        let auth = wrapper.findString(tag: 0x5F19)
        let date = wrapper.findString(tag: 0x5F26)
        return (auth, date)
    }
    
    private func readEF(fileID: Data) async throws -> Data {
        // Select EF
        let selApdu = Data([0x00, 0xA4, 0x02, 0x0C, 0x02, fileID[0], fileID[1]])
        let resSel = try await transmit(apdu: selApdu)
        try checkSW(resSel, context: "Select EF")
        
        // Read Binary with Extended Le: 00 B0 P1 P2 00 00 00 (up to 65536 bytes)
        var result = Data()
        var offset = 0
        
        // Try to read a large chunk first
        while true {
            let p1 = UInt8((offset >> 8) & 0xFF)
            let p2 = UInt8(offset & 0xFF)
            let readApdu = Data([0x00, 0xB0, p1, p2, 0x00, 0x00, 0x00])
            let res = try await transmit(apdu: readApdu)
            
            // Last 2 bytes are SW
            if res.count < 2 { break }
            let chunk = res.prefix(res.count-2)
            
            if chunk.isEmpty { break }
            result.append(chunk)
            offset += chunk.count
            
            // If SW is 9000 and we got data, we might need more if the file is huge,
            // but for passport DGs, they usually fit in one extended read (64KB max).
            break 
        }
        return result
    }
    
    private func transmit(apdu: Data) async throws -> Data {
        if let sm = self.sm {
            let wrapped = try sm.wrap(apdu: apdu)
            let res = try await manager.transmit(apdu: wrapped)
            
            // If response is too short (just SW), it implies SM layer error or plain response
            if res.count < 4 {
                return res
            }
            
            let (unwrapped, sw1, sw2) = try sm.unwrap(response: res)
            var fullRes = unwrapped
            fullRes.append(sw1)
            fullRes.append(sw2)
            return fullRes
        } else {
            return try await manager.transmit(apdu: apdu)
        }
    }
    
    // MARK: - Crypto Helpers (Matching Passport BAC specs)
    
    private func aesEncrypt(data: Data, key: SymmetricKey) throws -> Data {
        return try crypt(operation: CCOperation(kCCEncrypt), data: data, key: key)
    }
    
    private func aesDecrypt(data: Data, key: SymmetricKey) throws -> Data {
        return try crypt(operation: CCOperation(kCCDecrypt), data: data, key: key)
    }
    
    private func crypt(operation: CCOperation, data: Data, key: SymmetricKey) throws -> Data {
        let keyData = key.withUnsafeBytes { Data($0) }
        var outLength = Int(0)
        let dataCount = data.count
        var outData = Data(count: dataCount + kCCBlockSizeAES128)
        let outCount = outData.count
        let status = outData.withUnsafeMutableBytes { outBytes in
            data.withUnsafeBytes { dataBytes in
                keyData.withUnsafeBytes { keyBytes in
                    CCCrypt(operation, CCAlgorithm(kCCAlgorithmAES), 0, keyBytes.baseAddress, kCCKeySizeAES128, nil, dataBytes.baseAddress, dataCount, outBytes.baseAddress, outCount, &outLength)
                }
            }
        }
        guard status == kCCSuccess else { throw SignerError.internalError("AES failed: \(status)") }
        return outData.prefix(outLength)
    }

    private func des3Encrypt(data: Data, key: SymmetricKey, iv: Data = Data(count: 8)) throws -> Data {
        return try crypt3DES(operation: CCOperation(kCCEncrypt), data: data, key: key, iv: iv)
    }

    private func des3Decrypt(data: Data, key: SymmetricKey, iv: Data = Data(count: 8)) throws -> Data {
        return try crypt3DES(operation: CCOperation(kCCDecrypt), data: data, key: key, iv: iv)
    }

    private func crypt3DES(operation: CCOperation, data: Data, key: SymmetricKey, iv: Data) throws -> Data {
        var keyData = key.withUnsafeBytes { Data($0) }
        if keyData.count == 16 {
            keyData.append(keyData.prefix(8))
        }
        var outLength = Int(0)
        let dataCount = data.count
        var outData = Data(count: dataCount + kCCBlockSize3DES)
        let outCount = outData.count
        let status = outData.withUnsafeMutableBytes { outBytes in
            data.withUnsafeBytes { dataBytes in
                keyData.withUnsafeBytes { keyBytes in
                    iv.withUnsafeBytes { ivBytes in
                        CCCrypt(operation, CCAlgorithm(kCCAlgorithm3DES), 0, keyBytes.baseAddress, kCCKeySize3DES, ivBytes.baseAddress, dataBytes.baseAddress, dataCount, outBytes.baseAddress, outCount, &outLength)
                    }
                }
            }
        }
        guard status == kCCSuccess else { throw SignerError.internalError("3DES failed: \(status)") }
        return outData.prefix(outLength)
    }

    private func calculateRetailMAC(data: Data, key: SymmetricKey) throws -> Data {
        let keyData = key.withUnsafeBytes { Data($0) }
        let k1 = keyData.prefix(8)
        let k2 = keyData.suffix(8)
        let padded = padRetailMAC(data)
        var currentIV = Data(count: 8)
        for i in 0..<(padded.count / 8) {
            let block = padded.subdata(in: (i*8)..<(i*8+8))
            let input = Data(zip(block, currentIV).map { $0 ^ $1 })
            currentIV = try desEncryptECB(data: input, key: k1)
        }
        let decrypted = try desDecryptECB(data: currentIV, key: k2)
        let finalMAC = try desEncryptECB(data: decrypted, key: k1)
        return finalMAC
    }

    private func desEncryptECB(data: Data, key: Data) throws -> Data {
        return try cryptDES(operation: CCOperation(kCCEncrypt), data: data, key: key)
    }
    
    private func desDecryptECB(data: Data, key: Data) throws -> Data {
        return try cryptDES(operation: CCOperation(kCCDecrypt), data: data, key: key)
    }

    private func cryptDES(operation: CCOperation, data: Data, key: Data) throws -> Data {
        var outLength = Int(0)
        let dataCount = data.count
        var outData = Data(count: dataCount + kCCBlockSizeDES)
        let outCount = outData.count
        let status = outData.withUnsafeMutableBytes { outBytes in
            data.withUnsafeBytes { dataBytes in
                key.withUnsafeBytes { keyBytes in
                    CCCrypt(operation, CCAlgorithm(kCCAlgorithmDES), UInt32(kCCOptionECBMode), keyBytes.baseAddress, kCCKeySizeDES, nil, dataBytes.baseAddress, dataCount, outBytes.baseAddress, outCount, &outLength)
                }
            }
        }
        guard status == kCCSuccess else { throw SignerError.internalError("DES failed: \(status)") }
        return outData.prefix(outLength)
    }

    private func padRetailMAC(_ data: Data) -> Data {
        var padded = data
        padded.append(0x80)
        while padded.count % 8 != 0 { padded.append(0x00) }
        return padded
    }
    
    private func deriveSessionKey(seed: Data, counter: [UInt8]) -> Data {
        var data = seed
        data.append(contentsOf: counter)
        let hash = Insecure.SHA1.hash(data: data)
        return Data(hash).prefix(16)
    }
    
    private func checkSW(_ data: Data, context: String) throws {
        if data.count < 2 { throw SignerError.passport("\(context): too short") }
        let sw = (UInt16(data[data.count-2]) << 8) | UInt16(data[data.count-1])
        if sw != 0x9000 {
            throw SignerError.passport("\(context) failed: \(String(format: "%04X", sw))")
        }
    }
}

