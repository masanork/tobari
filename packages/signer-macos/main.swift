import Foundation
import LocalAuthentication
import CryptoKit
import Security

struct SignRequest: Codable {
    let challenge: String // Base64URL
    let rp_id: String
    let message: String?
}

struct SignResponse: Codable {
    let signature: String // Base64URL (DER encoded)
    let publicKey: String // JWK JSON String
}

// Utility for Base64URL
extension String {
    func fromBase64URL() -> Data? {
        var base64 = self
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 {
            base64.append("=")
        }
        return Data(base64Encoded: base64)
    }
}

extension Data {
    func toBase64URL() -> String {
        return self.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

let keyTag = "io.github.masanork.tobari.device-key.v1"

func getOrCreatePrivateKey() throws -> SecureEnclave.P256.Signing.PrivateKey {
    // Try to find key data representation in Keychain (GenericPassword)
    let pwdQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: keyTag,
        kSecReturnData as String: true
    ]
    
    var pwdItem: CFTypeRef? = nil
    let pwdStatus = SecItemCopyMatching(pwdQuery as CFDictionary, &pwdItem)
    
    if pwdStatus == errSecSuccess, let data = pwdItem as? Data {
        return try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: data)
    }
    
    // Generate new key in Secure Enclave
    let accessControl = SecAccessControlCreateWithFlags(
        nil,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        .userPresence, // Requires Touch ID / Passcode
        nil
    )!
    
    let privateKey = try SecureEnclave.P256.Signing.PrivateKey(accessControl: accessControl)
    
    // Save data representation to Keychain
    let saveQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: keyTag,
        kSecValueData as String: privateKey.dataRepresentation
    ]
    
    SecItemAdd(saveQuery as CFDictionary, nil)
    
    return privateKey
}

func main() {
    let args = ProcessInfo.processInfo.arguments
    guard let reqIndex = args.firstIndex(of: "--request"), reqIndex + 1 < args.count else {
        fputs("Usage: tobari-signer-macos --request '<json>'\n", stderr)
        exit(1)
    }
    
    let jsonStr = args[reqIndex + 1]
    guard let jsonData = jsonStr.data(using: .utf8),
          let request = try? JSONDecoder().decode(SignRequest.self, from: jsonData) else {
        fputs("Invalid JSON request\n", stderr)
        exit(1)
    }
    
    guard let challengeData = request.challenge.fromBase64URL() else {
        fputs("Invalid Base64URL challenge\n", stderr)
        exit(1)
    }
    
    do {
        // 1. Get Key (User Presence might be required here if configured, or at signing time)
        let privateKey = try getOrCreatePrivateKey()
        
        // 2. Prepare Public Key (JWK)
        let pubKey = privateKey.publicKey
        // P256 public key raw representation: 0x04 (uncompressed) + 32 bytes X + 32 bytes Y
        // Total 65 bytes
        let rawPub = pubKey.rawRepresentation
        let x = rawPub.subdata(in: 1..<33)
        let y = rawPub.subdata(in: 33..<65)
        
        let jwk = """
        {
          "kty": "EC",
          "crv": "P-256",
          "x": "\(x.toBase64URL())",
          "y": "\(y.toBase64URL())"
        }
        """
        
        // 3. Sign
        // The .userPresence access control triggers the system authentication dialog here
        let signature = try privateKey.signature(for: challengeData)
        
        let response = SignResponse(
            signature: signature.derRepresentation.toBase64URL(),
            publicKey: jwk
        )
        
        let responseData = try JSONEncoder().encode(response)
        print(String(data: responseData, encoding: .utf8)!)
        exit(0)
        
    } catch {
        fputs("Error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

main()