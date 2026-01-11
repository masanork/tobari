import Foundation
import CryptoKit

class PassportKDF {
    /// Derives Kenc and Kmac from MRZ information
    static func deriveKeys(mrz: String) throws -> (kEnc: SymmetricKey, kMac: SymmetricKey) {
        // 1. Calculate SHA-1 hash of the MRZ information
        // Expected MRZ input: PassportNo + CheckDigit + BirthDate + CheckDigit + ExpiryDate + CheckDigit
        let hash = Insecure.SHA1.hash(data: Data(mrz.utf8))
        let kSeed = Data(hash).prefix(16)
        
        // 2. Derive Kenc (counter 00000001)
        let kEnc = deriveKey(seed: kSeed, counter: [0x00, 0x00, 0x00, 0x01])
        
        // 3. Derive Kmac (counter 00000002)
        let kMac = deriveKey(seed: kSeed, counter: [0x00, 0x00, 0x00, 0x02])
        
        return (SymmetricKey(data: kEnc), SymmetricKey(data: kMac))
    }
    
    /// Derives Kpi (Password Key) for PACE from MRZ or CAN
    static func derivePaceKey(password: String, isCan: Bool = false) -> SymmetricKey {
        // 1. Calculate SHA-1 hash of the password
        // Password is MRZ (part) or CAN (6 digits)
        var data = password.data(using: .utf8)!
        
        // 2. Map password to Kpi
        // For PACE with MRZ/CAN, we use the specific counter 00000003
        var seedData = Data(Insecure.SHA1.hash(data: data))
        seedData = seedData.prefix(16)
        
        let kPace = deriveKey(seed: seedData, counter: [0x00, 0x00, 0x00, 0x03])
        return SymmetricKey(data: kPace)
    }
    
    private static func deriveKey(seed: Data, counter: [UInt8]) -> Data {
        var data = seed
        data.append(contentsOf: counter)
        let hash = Insecure.SHA1.hash(data: data)
        return Data(hash).prefix(16) // Return 16 bytes for AES-128
    }
    
    /// Constructs the MRZ info string from parts if needed
    static func constructMRZInfo(number: String, birth: String, expiry: String) -> String {
        let n = number.padding(toLength: 9, withPad: "<", startingAt: 0)
        let nc = calculateCheckDigit(n)
        let b = birth
        let bc = calculateCheckDigit(b)
        let e = expiry
        let ec = calculateCheckDigit(e)
        return "\(n)\(nc)\(b)\(bc)\(e)\(ec)"
    }
    
    private static func calculateCheckDigit(_ s: String) -> Int {
        let weights = [7, 3, 1]
        var sum = 0
        for (i, char) in s.enumerated() {
            let val: Int
            if char == "<" {
                val = 0
            } else if let d = Int(String(char)) {
                val = d
            } else {
                val = Int(char.asciiValue! - 55) // A=10, B=11...
            }
            sum += val * weights[i % 3]
        }
        return sum % 10
    }
}
