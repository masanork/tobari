import Foundation
import LocalAuthentication
import CryptoKit
import Security

class SecureEnclaveSigner {
    private let keyTag = "io.github.masanork.tobari.device-key.v1"
    
    // Utility for Base64URL
    private func toBase64URL(_ data: Data) -> String {
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    func sign(challenge: Data) throws -> (signature: String, publicKey: String) {
        // 1. Get Key
        let privateKey = try getOrCreatePrivateKey()
        
        // 2. Prepare Public Key (JWK)
        let pubKey = privateKey.publicKey
        let rawPub = pubKey.rawRepresentation
        let x = rawPub.subdata(in: 1..<33)
        let y = rawPub.subdata(in: 33..<65)
        
        let jwk = """
        {
          "kty": "EC",
          "crv": "P-256",
          "x": "\(toBase64URL(x))",
          "y": "\(toBase64URL(y))"
        }
        """
        
        // 3. Sign
        fputs("Debug: Requesting signature...\n", stderr)
        let signature = try privateKey.signature(for: challenge)
        fputs("Debug: Signature generated successfully.\n", stderr)
        
        return (toBase64URL(signature.derRepresentation), jwk)
    }

    private func getOrCreatePrivateKey() throws -> SecureEnclave.P256.Signing.PrivateKey {
        fputs("Debug: Attempting to retrieve existing key from Keychain...\n", stderr)
        
        let pwdQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: keyTag,
            kSecReturnData as String: true
        ]
        
        var pwdItem: CFTypeRef? = nil
        let pwdStatus = SecItemCopyMatching(pwdQuery as CFDictionary, &pwdItem)
        
        // TODO: Remove this deletion logic once development stabilizes or make it a flag
        if pwdStatus == errSecSuccess, let _ = pwdItem as? Data {
            fputs("Debug: Found existing key in Keychain. DELETING for debugging (Clean State)...\n", stderr)
            let deleteQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: keyTag
            ]
            SecItemDelete(deleteQuery as CFDictionary)
            // Fall through to generation
        } else if pwdStatus != errSecItemNotFound {
            fputs("Debug: SecItemCopyMatching failed with status: \(pwdStatus)\n", stderr)
        } else {
            fputs("Debug: Key not found. Generating new key...\n", stderr)
        }
        
        // Generate new key
        var error: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [], // No user presence required for now (for CLI testing)
            &error
        ) else {
            throw error!.takeRetainedValue() as Error
        }
        
        fputs("Debug: Creating new SecureEnclave key...\n", stderr)
        let privateKey = try SecureEnclave.P256.Signing.PrivateKey(accessControl: accessControl)
        
        // Save to Keychain
        let saveQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: keyTag,
            kSecValueData as String: privateKey.dataRepresentation
        ]
        
        fputs("Debug: Saving new key to Keychain...\n", stderr)
        let status = SecItemAdd(saveQuery as CFDictionary, nil)
        if status != errSecSuccess {
            fputs("Debug: SecItemAdd failed with status: \(status)\n", stderr)
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: nil)
        }
        
        fputs("Debug: Key saved successfully.\n", stderr)
        return privateKey
    }
}
