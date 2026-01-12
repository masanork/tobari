import Foundation
import CryptoKit
import CommonCrypto

/// ISO 7816-4 Secure Messaging Implementation for ePassports (BAC)
class SecureMessaging {
    private var ksEnc: SymmetricKey
    private var ksMac: SymmetricKey
    private var ssc: UInt64 // Send Sequence Counter
    
    init(ksEnc: SymmetricKey, ksMac: SymmetricKey, ssc: UInt64) {
        self.ksEnc = ksEnc
        self.ksMac = ksMac
        self.ssc = ssc
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
            // Support both short and extended Lc in input APDU
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
            let paddedData = pad(plainData)
            let encrypted = try aesEncrypt(data: paddedData)
            
            dataField.append(0x87)
            dataField.append(contentsOf: encodeLength(encrypted.count + 1))
            dataField.append(0x01) // Indicator
            dataField.append(encrypted)
        }
        
        // 2. Wrap Le (Tag 97) if present
        // Check for Le at the end
        if apdu.count > 4 {
            let lastByteIdx = apdu.count - 1
            let lePresent: Bool
            let leValue: Data
            
            // Case 2 or 4
            if apdu.count == 5 || apdu.count == 5 + Int(apdu[4]) + 1 {
                // Short Le
                lePresent = true
                leValue = Data([apdu[lastByteIdx]])
            } else if apdu[4] == 0x00 && (apdu.count == 7 || apdu.count == 7 + (Int(apdu[5]) << 8 | Int(apdu[6])) + 2) {
                // Extended Le (2 bytes at end)
                lePresent = true
                leValue = apdu.suffix(2)
            } else {
                lePresent = false
                leValue = Data()
            }
            
            if lePresent {
                dataField.append(0x97)
                dataField.append(contentsOf: encodeLength(leValue.count))
                dataField.append(leValue)
            }
        }
        
        // 3. Calculate MAC (Tag 8E)
        var mdo = Data([cla | 0x0C, ins, p1, p2])
        mdo.append(pad(dataField))
        let mac = try calculateMAC(ssc: ssc, data: mdo)
        
        // 4. Assemble Wrapped APDU
        var wrapped = Data([cla | 0x0C, ins, p1, p2])
        let lcPrime = dataField.count + 10 // 1 (8E) + 1 (08) + 8 (MAC)
        
        if lcPrime > 255 {
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
        wrapped.append(0x00) // Le' (short 00)
        
        return wrapped
    }
    
    /// Unwraps a Secure Messaging response
    func unwrap(response: Data) throws -> (data: Data, sw1: UInt8, sw2: UInt8) {
        guard response.count >= 10 else { throw SignerError.jpki("SM response too short") }
        
        let sw1 = response[response.count-2]
        let sw2 = response[response.count-1]
        
        var offset = 0
        var plainData = Data()
        let bytes = [UInt8](response)
        
        // Loop until we reach MAC tag (8E)
        while offset < response.count - 10 {
            let tag = bytes[offset]
            offset += 1
            
            var lenOffset = offset
            let len = decodeLength(bytes, &lenOffset)
            offset = lenOffset
            
            if tag == 0x87 || tag == 0x85 {
                let value = response.subdata(in: offset..<offset+len)
                let encrypted = value.dropFirst() // Skip indicator
                let decrypted = try aesDecrypt(data: encrypted)
                plainData.append(unpad(decrypted))
            }
            offset += len
        }
        
        return (plainData, sw1, sw2)
    }
    
    // MARK: - Crypto Helpers
    
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
        let first = bytes[offset]
        offset += 1
        if first <= 0x7F {
            return Int(first)
        } else {
            let numBytes = Int(first & 0x7F)
            var len = 0
            for _ in 0..<numBytes {
                len = (len << 8) | Int(bytes[offset])
                offset += 1
            }
            return len
        }
    }
    
    // MARK: - Crypto Helpers
    
    private func aesEncrypt(data: Data) throws -> Data {
        let aes = try AES.GCM.seal(data, using: ksEnc, nonce: AES.GCM.Nonce()) // Note: Passport BAC uses AES-CBC or 3DES-CBC. 
        // Adjustment: ICAO BAC strictly uses DESede (3DES) or AES-CBC with specific padding.
        // CryptoKit doesn't support CBC easily. We use CommonCrypto.
        return try crypt(operation: CCOperation(kCCEncrypt), data: data, key: ksEnc)
    }
    
    private func aesDecrypt(data: Data) throws -> Data {
        return try crypt(operation: CCOperation(kCCDecrypt), data: data, key: ksEnc)
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
                    // Null IV for BAC SM
                    CCCrypt(operation, CCAlgorithm(kCCAlgorithmAES), 0, keyBytes.baseAddress, kCCKeySizeAES128, nil, dataBytes.baseAddress, dataCount, outBytes.baseAddress, outCount, &outLength)
                }
            }
        }
        
        guard status == kCCSuccess else { throw SignerError.internalError("AES failed: \(status)") }
        return outData.prefix(outLength)
    }
    
    private func calculateMAC(ssc: UInt64, data: Data) throws -> Data {
        // ICAO Doc 9303 / ISO 7816-4: MAC is calculated over SSC || Data
        var mdo = Data()
        var sscValue = ssc.bigEndian
        let sscData = withUnsafeBytes(of: &sscValue) { Data($0) }
        mdo.append(sscData)
        mdo.append(data)
        
        // 1. Pad MDO (0x80 followed by 0x00s)
        let paddedMdo = pad(mdo)
        let mdoCount = paddedMdo.count
        
        // 2. Initial Encryption with ksMac using AES-CBC
        let keyData = ksMac.withUnsafeBytes { Data($0) }
        var outLength = Int(0)
        var outData = Data(count: mdoCount + kCCBlockSizeAES128)
        let outCount = outData.count
        
        // We use CCCrypt with No Padding because we padded manually
        let status = outData.withUnsafeMutableBytes { outBytes in
            paddedMdo.withUnsafeBytes { dataBytes in
                keyData.withUnsafeBytes { keyBytes in
                    // Null IV
                    CCCrypt(CCOperation(kCCEncrypt), CCAlgorithm(kCCAlgorithmAES), 0, keyBytes.baseAddress, kCCKeySizeAES128, nil, dataBytes.baseAddress, mdoCount, outBytes.baseAddress, outCount, &outLength)
                }
            }
        }
        
        guard status == kCCSuccess else { throw SignerError.internalError("MAC calculation failed: \(status)") }
        
        // 3. For ISO 7816-4 SM MAC, we take the FIRST 8 bytes of the LAST block
        // (Note: This matches typical implementation for AES-based SM)
        let lastBlockOffset = outLength - 16
        guard lastBlockOffset >= 0 else { throw SignerError.internalError("Invalid MAC output length") }
        return outData.subdata(in: lastBlockOffset..<lastBlockOffset + 8)
    }
    
    private func pad(_ data: Data) -> Data {
        var padded = data
        padded.append(0x80)
        while padded.count % 16 != 0 { padded.append(0x00) }
        return padded
    }
    
    private func unpad(_ data: Data) -> Data {
        if let lastIndex = data.lastIndex(of: 0x80) {
            return data.prefix(upTo: lastIndex)
        }
        return data
    }
}
