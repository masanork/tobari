import Foundation
import CryptoKit
import CommonCrypto

/// ISO 7816-4 Secure Messaging Implementation for ePassports
class SecureMessaging {
    enum ProtocolType {
        case bac
        case pace
    }

    private var ksEnc: SymmetricKey
    private var ksMac: SymmetricKey
    private var ssc: UInt64
    private var proto: ProtocolType
    
    init(ksEnc: SymmetricKey, ksMac: SymmetricKey, ssc: UInt64, proto: ProtocolType = .bac) {
        self.ksEnc = SecureMessaging.adjustKeyParity(ksEnc)
        self.ksMac = SecureMessaging.adjustKeyParity(ksMac)
        self.ssc = ssc
        self.proto = proto
    }
    
    private static func adjustKeyParity(_ key: SymmetricKey) -> SymmetricKey {
        var keyData = key.withUnsafeBytes { Data($0) }
        for i in 0..<keyData.count {
            var byte = keyData[i]
            var bits = 0
            for j in 0..<8 {
                if (byte >> j) & 0x01 == 1 { bits += 1 }
            }
            if bits % 2 == 0 {
                byte ^= 0x01 // Toggle LSB to make parity odd
            }
            keyData[i] = byte
        }
        return SymmetricKey(data: keyData)
    }
    
    /// Increments the Send Sequence Counter
    private func incrementSSC() {
        ssc += 1
    }
    
    /// Wraps a plain APDU into a Secure Messaging APDU
    func wrap(apdu: Data) throws -> Data {
        incrementSSC()
        
        let cla = apdu[0]
        let ins = apdu[1]
        let p1 = apdu[2]
        let p2 = apdu[3]
        
        var dataField = Data()
        
        // 1. Process plain data if present
        if apdu.count > 5 {
            let lc: Int
            let headerOffset: Int
            if apdu[4] == 0x00 && apdu.count >= 7 {
                lc = Int(apdu[5]) << 8 | Int(apdu[6])
                headerOffset = 7
            } else {
                lc = Int(apdu[4])
                headerOffset = 5
            }
            
            let plainData = apdu.subdata(in: headerOffset..<headerOffset+lc)
            let encrypted = try encrypt(data: plainData)
            
            dataField.append(0x87)
            dataField.append(contentsOf: encodeLength(encrypted.count + 1))
            dataField.append(0x01) // Indicator
            dataField.append(encrypted)
        }
        
        // 2. Wrap Le (Tag 97) if present
        var shouldAppendLe = false
        var leIsExtended = false
        if apdu.count >= 5 {
            let lastByteIdx = apdu.count - 1
            let lePresent: Bool
            let leValue: Data
            
            if apdu.count == 5 {
                // Case: CLA INS P1 P2 Le
                lePresent = true
                leValue = Data([apdu[4]])
            } else if apdu.count == 5 + (apdu[4] == 0 ? 0 : Int(apdu[4])) + 1 {
                // Case: CLA INS P1 P2 Lc Data Le
                lePresent = true
                leValue = Data([apdu[lastByteIdx]])
            } else if apdu[4] == 0x00 && apdu.count >= 7 {
                // Extended length checks
                let lc = Int(apdu[5]) << 8 | Int(apdu[6])
                if apdu.count == 7 { // Extended Le only
                    lePresent = true
                    leValue = apdu.suffix(2)
                } else if apdu.count == 7 + lc + 2 { // Extended Lc + Data + Extended Le
                    lePresent = true
                    leValue = apdu.suffix(2)
                } else {
                    lePresent = false
                    leValue = Data()
                }
            } else {
                lePresent = false
                leValue = Data()
            }
            
            if lePresent {
                shouldAppendLe = true
                leIsExtended = (leValue.count == 2)
                dataField.append(0x97)
                dataField.append(contentsOf: encodeLength(leValue.count))
                dataField.append(leValue)
            }
        }
        
        // 3. Calculate MAC (Tag 8E)
        var mdo = Data([cla | 0x0C, ins, p1, p2])
        mdo.append(dataField)
        let mac = try calculateMAC(ssc: ssc, data: mdo)
        
        // 4. Assemble Wrapped APDU
        var wrapped = Data([cla | 0x0C, ins, p1, p2])
        let lcPrime = dataField.count + 10 // 8E + 08 + 8 bytes MAC
        
        let useExtended = lcPrime > 255 || (shouldAppendLe && leIsExtended)
        
        if useExtended {
            wrapped.append(0x00)
            wrapped.append(UInt8((lcPrime >> 8) & 0xFF))
            wrapped.append(UInt8(lcPrime & 0xFF))
        } else {
            wrapped.append(UInt8(lcPrime))
        }
        
        wrapped.append(dataField)
        wrapped.append(0x8E)
        wrapped.append(0x08)
        wrapped.append(mac)
        
        // Always append Le' for MRTD SM as a response (at least SW/MAC) is always expected
        if useExtended {
            wrapped.append(contentsOf: [0x00, 0x00])
        } else {
            wrapped.append(0x00)
        }
        
        return wrapped
    }
    
    /// Unwraps a Secure Messaging response
    func unwrap(response: Data) throws -> (data: Data, sw1: UInt8, sw2: UInt8) {
        guard response.count >= 2 else { throw SignerError.passport("SM response too short") }
        
        let transportSw1 = response[response.count - 2]
        let transportSw2 = response[response.count - 1]
        
        if transportSw1 != 0x90 || transportSw2 != 0x00 {
            return (Data(), transportSw1, transportSw2)
        }
        
        incrementSSC()
        
        let raw = response.prefix(response.count - 2)
        let bytes = [UInt8](raw)
        var offset = 0
        
        var do87: Data?
        var do99: Data?
        var do8e: Data?
        
        while offset < bytes.count {
            let tag = bytes[offset]
            offset += 1
            
            var lenOffset = offset
            let len = decodeLength(bytes, &lenOffset)
            offset = lenOffset
            
            guard offset + len <= bytes.count else {
                throw SignerError.passport("SM response length overflow")
            }
            
            let value = raw.subdata(in: offset..<offset+len)
            switch tag {
            case 0x87, 0x85:
                do87 = value
            case 0x99:
                do99 = value
            case 0x8E:
                do8e = value
            default:
                break
            }
            offset += len
        }
        
        guard let do99Value = do99, do99Value.count == 2 else {
            throw SignerError.passport("SM response missing DO99")
        }
        
        let sw1 = do99Value[0]
        let sw2 = do99Value[1]
        
        if let do8eValue = do8e {
            let expectedMac = try calculateResponseMAC(do87: do87, do99: do99Value)
            if do8eValue != expectedMac {
                throw SignerError.passport("SM response MAC mismatch")
            }
        } else if do87 != nil {
            throw SignerError.passport("SM response missing DO8E")
        }
        
        var plainData = Data()
        if let do87Value = do87 {
            let encrypted: Data
            if do87Value.first == 0x01 {
                encrypted = do87Value.dropFirst()
            } else {
                encrypted = do87Value
            }
            let decrypted = try decrypt(data: encrypted)
            plainData.append(decrypted)
        }
        
        return (plainData, sw1, sw2)
    }
    
    // MARK: - Crypto Primitives
    
    private func encrypt(data: Data) throws -> Data {
        let padded = pad(data)
        if proto == .bac {
            // ICAO 9303-11: For BAC, 3DES CBC uses IV=0
            let iv = Data(count: 8)
            return try crypt3DES(operation: CCOperation(kCCEncrypt), data: padded, key: ksEnc, iv: iv)
        } else {
            return try aesEncrypt(data: padded)
        }
    }
    
    private func decrypt(data: Data) throws -> Data {
        let decrypted: Data
        if proto == .bac {
            // ICAO 9303-11: For BAC, 3DES CBC uses IV=0
            let iv = Data(count: 8)
            decrypted = try crypt3DES(operation: CCOperation(kCCDecrypt), data: data, key: ksEnc, iv: iv)
        } else {
            decrypted = try aesDecrypt(data: data)
        }
        return unpad(decrypted)
    }
    
    private func deriveIV(ssc: UInt64) throws -> Data {
        var sscValue = ssc.bigEndian
        let sscData = withUnsafeBytes(of: &sscValue) { Data($0) }
        // For BAC, IV = Enc(ksEnc, SSC)
        return try crypt3DES(operation: CCOperation(kCCEncrypt), data: sscData, key: ksEnc, iv: Data(count: 8))
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

    private func calculateMAC(ssc: UInt64, data: Data) throws -> Data {
        var mdo = Data()
        var sscValue = ssc.bigEndian
        let sscData = withUnsafeBytes(of: &sscValue) { Data($0) }
        mdo.append(sscData)
        
        // ICAO 9303 / ISO 7816-4: The command header (4 bytes) 
        // MUST be padded to 8 bytes with 80 00 00 00
        let header = data.prefix(4)
        mdo.append(header)
        mdo.append(contentsOf: [0x80, 0x00, 0x00, 0x00])
        
        // Followed by the rest of the data (dataField)
        if data.count > 4 {
            mdo.append(data.dropFirst(4))
        }
        
        let paddedMdo = pad(mdo)

        if proto == .bac {
            return try calculateRetailMAC(data: paddedMdo, key: ksMac)
        } else {
            // PACE/AES MAC (Simplified last block of CBC)
            let keyData = ksMac.withUnsafeBytes { Data($0) }
            var outLength = Int(0)
            var outData = Data(count: paddedMdo.count + kCCBlockSizeAES128)
            let status = outData.withUnsafeMutableBytes { outBytes in
                paddedMdo.withUnsafeBytes { dataBytes in
                    keyData.withUnsafeBytes { keyBytes in
                        CCCrypt(CCOperation(kCCEncrypt), CCAlgorithm(kCCAlgorithmAES), 0, keyBytes.baseAddress, kCCKeySizeAES128, nil, dataBytes.baseAddress, paddedMdo.count, outBytes.baseAddress, outBytes.count, &outLength)
                    }
                }
            }
            guard status == kCCSuccess else { throw SignerError.internalError("AES MAC failed") }
            return outData.subdata(in: outLength - 16..<outLength - 8)
        }
    }

    private func calculateResponseMAC(do87: Data?, do99: Data) throws -> Data {
        var mdo = Data()
        var sscValue = ssc.bigEndian
        let sscData = withUnsafeBytes(of: &sscValue) { Data($0) }
        mdo.append(sscData)
        
        if let do87Value = do87 {
            mdo.append(0x87)
            mdo.append(contentsOf: encodeLength(do87Value.count))
            mdo.append(do87Value)
        }
        
        mdo.append(0x99)
        mdo.append(0x02)
        mdo.append(do99)
        
        let padded = pad(mdo)
        if proto == .bac {
            return try calculateRetailMAC(data: padded, key: ksMac)
        } else {
            let keyData = ksMac.withUnsafeBytes { Data($0) }
            var outLength = Int(0)
            var outData = Data(count: padded.count + kCCBlockSizeAES128)
            let status = outData.withUnsafeMutableBytes { outBytes in
                padded.withUnsafeBytes { dataBytes in
                    keyData.withUnsafeBytes { keyBytes in
                        CCCrypt(CCOperation(kCCEncrypt), CCAlgorithm(kCCAlgorithmAES), 0, keyBytes.baseAddress, kCCKeySizeAES128, nil, dataBytes.baseAddress, padded.count, outBytes.baseAddress, outBytes.count, &outLength)
                    }
                }
            }
            guard status == kCCSuccess else { throw SignerError.internalError("AES MAC failed") }
            return outData.subdata(in: outLength - 16..<outLength - 8)
        }
    }

    private func calculateRetailMAC(data: Data, key: SymmetricKey) throws -> Data {
        let keyData = key.withUnsafeBytes { Data($0) }
        let k1 = keyData.prefix(8)
        let k2 = keyData.subdata(in: 8..<16)
        var currentIV = Data(count: 8)
        for i in 0..<(data.count / 8) {
            let block = data.subdata(in: (i*8)..<(i*8+8))
            let input = Data(zip(block, currentIV).map { $0 ^ $1 })
            currentIV = try cryptDES(operation: CCOperation(kCCEncrypt), data: input, key: k1)
        }
        let decrypted = try cryptDES(operation: CCOperation(kCCDecrypt), data: currentIV, key: k2)
        return try cryptDES(operation: CCOperation(kCCEncrypt), data: decrypted, key: k1)
    }

    private func cryptDES(operation: CCOperation, data: Data, key: Data) throws -> Data {
        var outLength = Int(0)
        var outData = Data(count: data.count + kCCBlockSizeDES)
        let status = outData.withUnsafeMutableBytes { outBytes in
            data.withUnsafeBytes { dataBytes in
                key.withUnsafeBytes { keyBytes in
                    CCCrypt(operation, CCAlgorithm(kCCAlgorithmDES), UInt32(kCCOptionECBMode), keyBytes.baseAddress, kCCKeySizeDES, nil, dataBytes.baseAddress, data.count, outBytes.baseAddress, outBytes.count, &outLength)
                }
            }
        }
        guard status == kCCSuccess else { throw SignerError.internalError("DES failed") }
        return outData.prefix(outLength)
    }
    
    private func pad(_ data: Data) -> Data {
        var padded = data
        padded.append(0x80)
        let blockSize = proto == .bac ? 8 : 16
        while padded.count % blockSize != 0 { padded.append(0x00) }
        return padded
    }
    
    private func unpad(_ data: Data) -> Data {
        if let lastIndex = data.lastIndex(of: 0x80) {
            return data.prefix(upTo: lastIndex)
        }
        return data
    }

    private func encodeLength(_ len: Int) -> Data {
        if len <= 0x7F {
            return Data([UInt8(len)])
        } else if len <= 0xFF {
            return Data([0x81, UInt8(len)])
        } else {
            return Data([0x82, UInt8((len >> 8) & 0xFF), UInt8(len & 0xFF)])
        }
    }
    
    private func decodeLength(_ bytes: [UInt8], _ offset: inout Int) -> Int {
        if offset >= bytes.count { return 0 }
        let first = bytes[offset]
        offset += 1
        if first <= 0x7F {
            return Int(first)
        } else {
            let numBytes = Int(first & 0x7F)
            var len = 0
            for _ in 0..<numBytes {
                if offset < bytes.count {
                    len = (len << 8) | Int(bytes[offset])
                    offset += 1
                }
            }
            return len
        }
    }
    
    private func aesEncrypt(data: Data) throws -> Data {
        return try cryptAES(operation: CCOperation(kCCEncrypt), data: data, key: ksEnc)
    }
    
    private func aesDecrypt(data: Data) throws -> Data {
        return try cryptAES(operation: CCOperation(kCCDecrypt), data: data, key: ksEnc)
    }
    
    private func cryptAES(operation: CCOperation, data: Data, key: SymmetricKey) throws -> Data {
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
}
