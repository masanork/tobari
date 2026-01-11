import Foundation
import CryptoKit
import Security

class SecureEnclaveEncryption {
    private let keyTagSecure = "io.github.masanork.tobari.device-enc-key.v1.se"
    private let keyTagSoftware = "io.github.masanork.tobari.device-enc-key.v1.sw"
    private let keyService = "io.github.masanork.tobari.signer"
    private let useKeychain = ProcessInfo.processInfo.environment["TOBARI_SIGNER_USE_KEYCHAIN"] == "1"

    private enum DeviceAgreementKey {
        case secureEnclave(SecureEnclave.P256.KeyAgreement.PrivateKey)
        case software(P256.KeyAgreement.PrivateKey)
    }

    // Utility for Base64URL
    private func toBase64URL(_ data: Data) -> String {
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
    
    private func fromBase64URL(_ string: String) -> Data? {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 {
            base64.append("=")
        }
        return Data(base64Encoded: base64)
    }

    // Decrypt (Key Agreement -> HKDF -> AES-GCM or direct decryption if using sealed box)
    // For simplicity and standard compliance, we usually use ECIES (Ephemeral-Static ECDH).
    // Input:
    // - ephemeralPublicKey: Data (The sender's ephemeral public key)
    // - ciphertext: Data (The encrypted content)
    // - salt: Data? (Optional salt for HKDF)
    // - info: Data? (Optional info for HKDF)
    // 
    // However, to keep the CLI simple, we might assume a standard ECIES flow.
    // Let's implement a standard ECIES decrypt where input is a JSON containing ephemPub, ciphertext, tag, iv.
    
    struct EncryptedMessage: Codable {
        let ephemeralPublicKey: String // Base64URL
        let ciphertext: String // Base64URL
        let iv: String // Base64URL
        let tag: String // Base64URL
    }
    
    func decrypt(jsonString: String) throws -> Data {
        guard let jsonData = jsonString.data(using: .utf8),
              let msg = try? JSONDecoder().decode(EncryptedMessage.self, from: jsonData) else {
            throw NSError(domain: "SecureEnclaveEncryption", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid JSON structure"])
        }
        
        guard let ephemPubData = fromBase64URL(msg.ephemeralPublicKey),
              let ciphertext = fromBase64URL(msg.ciphertext),
              let iv = fromBase64URL(msg.iv),
              let tag = fromBase64URL(msg.tag) else {
             throw NSError(domain: "SecureEnclaveEncryption", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid Base64URL data"])
        }
        
        fputs("Debug: Ephemeral Public Key Len: \(ephemPubData.count)\n", stderr)
        fputs("Debug: Ephemeral Public Key Hex: \(ephemPubData.prefix(8).map { String(format: "%02x", $0) }.joined())\n", stderr)

        // Reconstruct Sender Public Key
        // x963Representation expects 65 bytes (0x04 + X + Y)
        let senderPubKey: P256.KeyAgreement.PublicKey
        if ephemPubData.count == 65 {
            senderPubKey = try P256.KeyAgreement.PublicKey(x963Representation: ephemPubData)
        } else {
            senderPubKey = try P256.KeyAgreement.PublicKey(rawRepresentation: ephemPubData)
        }
        
        // Get Receiver Private Key
        let privKey = try getOrCreatePrivateKey()
        
        // Perform Shared Secret Derivation
        let sharedSecret: SharedSecret
        switch privKey {
        case .secureEnclave(let k):
            fputs("Debug: Using Secure Enclave Private Key\n", stderr)
            sharedSecret = try k.sharedSecretFromKeyAgreement(with: senderPubKey)
        case .software(let k):
            fputs("Debug: Using Software Private Key\n", stderr)
            sharedSecret = try k.sharedSecretFromKeyAgreement(with: senderPubKey)
        }
        
        // Derive Symmetric Key (HKDF-SHA256)
        let salt = "tobari-ecies-salt".data(using: .utf8)!
        let info = "tobari-ecies-info".data(using: .utf8)!
        
        fputs("Debug: Deriving symmetric key with HKDF-SHA256...\n", stderr)
        let symmetricKey = sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: salt,
            sharedInfo: info,
            outputByteCount: 32
        )
        
        // Debug: Print derived key hash
        let keyHash = SHA256.hash(data: symmetricKey.withUnsafeBytes { Data($0) })
        fputs("Debug: Derived Key SHA256: \(keyHash.map { String(format: "%02x", $0) }.joined())\n", stderr)
        
        // Decrypt using AES-GCM
        fputs("Debug: Decrypting with AES-GCM (ivLen=\(iv.count), cipherLen=\(ciphertext.count), tagLen=\(tag.count))...\n", stderr)
        fputs("Debug: IV Hex: \(iv.map { String(format: "%02x", $0) }.joined())\n", stderr)
        fputs("Debug: Tag Hex: \(tag.map { String(format: "%02x", $0) }.joined())\n", stderr)

        let sealedBox = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ciphertext, tag: tag)
        let decrypted = try AES.GCM.open(sealedBox, using: symmetricKey)
        
        fputs("Debug: Decryption successful.\n", stderr)
        return decrypted
    }

    func getPublicKey() throws -> String {
        let key = try getOrCreatePrivateKey()
        let rawPub: Data
        switch key {
        case .secureEnclave(let k):
            rawPub = k.publicKey.rawRepresentation
        case .software(let k):
            rawPub = k.publicKey.rawRepresentation
        }
        
        let x = rawPub.subdata(in: 1..<33)
        let y = rawPub.subdata(in: 33..<65)
        
        return """
        {
          "kty": "EC",
          "crv": "P-256",
          "x": "\(toBase64URL(x))",
          "y": "\(toBase64URL(y))"
        }
        """
    }

    private func getOrCreatePrivateKey() throws -> DeviceAgreementKey {
        if useKeychain {
            fputs("Debug: Attempting to retrieve existing encryption key from Keychain...\n", stderr)

            // Try Secure Enclave first
            let secureQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keyService,
                kSecAttrAccount as String: keyTagSecure,
                kSecReturnData as String: true
            ]
            
            var item: CFTypeRef?
            let status = SecItemCopyMatching(secureQuery as CFDictionary, &item)
            if status == errSecSuccess, let data = item as? Data {
                if let key = try? SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: data) {
                    fputs("Debug: Loaded Secure Enclave encryption key.\n", stderr)
                    return .secureEnclave(key)
                }
            }
            
            // Try Software
            let softQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keyService,
                kSecAttrAccount as String: keyTagSoftware,
                kSecReturnData as String: true
            ]
            
            var softItem: CFTypeRef?
            let softStatus = SecItemCopyMatching(softQuery as CFDictionary, &softItem)
            if softStatus == errSecSuccess, let data = softItem as? Data {
                if let key = try? P256.KeyAgreement.PrivateKey(rawRepresentation: data) {
                    fputs("Debug: Loaded software encryption key.\n", stderr)
                    return .software(key)
                }
            }
        }
        
        // Create New
        fputs("Debug: Creating new encryption key...\n", stderr)
        var error: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil, 
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [], 
            &error
        ) else {
            throw error!.takeRetainedValue() as Error
        }
        
        do {
            let privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: accessControl)
            if useKeychain {
                let query: [String: Any] = [
                    kSecClass as String: kSecClassGenericPassword,
                    kSecAttrService as String: keyService,
                    kSecAttrAccount as String: keyTagSecure,
                    kSecValueData as String: privateKey.dataRepresentation
                ]
                SecItemDelete(query as CFDictionary)
                SecItemAdd(query as CFDictionary, nil)
            }
            return .secureEnclave(privateKey)
        } catch {
            fputs("Debug: Secure Enclave failed, falling back to software.\n", stderr)
            let privateKey = P256.KeyAgreement.PrivateKey()
             if useKeychain {
                let query: [String: Any] = [
                    kSecClass as String: kSecClassGenericPassword,
                    kSecAttrService as String: keyService,
                    kSecAttrAccount as String: keyTagSoftware,
                    kSecValueData as String: privateKey.rawRepresentation
                ]
                SecItemDelete(query as CFDictionary)
                SecItemAdd(query as CFDictionary, nil)
            }
            return .software(privateKey)
        }
    }
}
