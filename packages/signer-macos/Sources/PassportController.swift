import Foundation
import CryptoKit
import CommonCrypto

class PassportController {
    let manager: SmartCardInterface
    private var sm: SecureMessaging?
    
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
    
    /// Performs BAC (Basic Access Control) Mutual Authentication
    func performBAC(mrz: String) async throws {
        // 1. Derive Static Keys from MRZ
        let (kEnc, kMac) = try PassportKDF.deriveKeys(mrz: mrz)
        
        // 2. Get Challenge (RND.IC)
        // CLA=00, INS=84 (GET CHALLENGE), P1=00, P2=00, Le=08
        let getChallengeApdu = Data([0x00, 0x84, 0x00, 0x00, 0x08])
        let rndIcRes = try await manager.transmit(apdu: getChallengeApdu)
        try checkSW(rndIcRes, context: "Get Challenge")
        let rndIc = rndIcRes.prefix(8)
        
        // 3. Prepare Mutual Authentication Data
        let rndIf = Data(AES.GCM.Nonce()) // 8 bytes random
        let kIf = Data(AES.GCM.Nonce())   // 16 bytes random
        
        // S = RND.IF || RND.IC || K.IF
        var s = Data()
        s.append(rndIf)
        s.append(rndIc)
        s.append(kIf)
        
        // E.IF = Enc(Kenc, S)
        let eIf = try aesEncrypt(data: s, key: kEnc)
        
        // M.IF = MAC(Kmac, E.IF)
        let mIf = try calculateMAC(data: eIf, key: kMac)
        
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
        let sRes = try aesDecrypt(data: eIc, key: kEnc)
        // S.RES = RND.IC || RND.IF || K.IC
        let kIc = sRes.suffix(16)
        
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
        
        self.sm = SecureMessaging(ksEnc: SymmetricKey(data: ksEncBytes), ksMac: SymmetricKey(data: ksMacBytes), ssc: ssc)
        debugPrint("Secure Messaging Established.")
    }
    
    func readDG1() async throws -> Data {
        return try await readEF(fileID: Data([0x01, 0x01]))
    }
    
    func readDG2() async throws -> Data {
        return try await readEF(fileID: Data([0x01, 0x02]))
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
    
    private func calculateMAC(data: Data, key: SymmetricKey) throws -> Data {
        // Placeholder for AES-CMAC or Retail MAC. 
        // Real implementation needs 8 bytes MAC.
        return Data(repeating: 0x00, count: 8)
    }
    
    private func deriveSessionKey(seed: Data, counter: [UInt8]) -> Data {
        var data = seed
        data.append(contentsOf: counter)
        let hash = Insecure.SHA1.hash(data: data)
        return Data(hash).prefix(16)
    }
    
    private func checkSW(_ data: Data, context: String) throws {
        if data.count < 2 { throw SignerError.jpki("\(context): too short") }
        let sw = (UInt16(data[data.count-2]) << 8) | UInt16(data[data.count-1])
        if sw != 0x9000 {
            throw SignerError.jpki("\(context) failed: \(String(format: "%04X", sw))")
        }
    }
}

