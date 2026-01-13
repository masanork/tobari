import Foundation
import CryptoKit
import Security

class SecureEnclaveEncryption {
    private let keyTagSecure = "io.github.masanork.tobari.device-enc-key.v1.se"
    private let keyTagSoftware = "io.github.masanork.tobari.device-enc-key.v1.sw"
    private let keyService = "io.github.masanork.tobari.signer"
    private let useKeychain = ProcessInfo.processInfo.environment["TOBARI_SIGNER_USE_KEYCHAIN"] == "1"
    private let forceSoftwareKey = ProcessInfo.processInfo.environment["TOBARI_SIGNER_SOFTWARE_KEY"] == "1"
    private let keyFilePath = ProcessInfo.processInfo.environment["TOBARI_SIGNER_KEY_FILE"]

    private enum DeviceAgreementKey {
        case secureEnclave(SecureEnclave.P256.KeyAgreement.PrivateKey)
        case software(P256.KeyAgreement.PrivateKey)
    }

    func decrypt(components: EncryptedComponents) throws -> Data {
        guard let ephemPubData = Data(base64URLEncoded: components.ephemeralPublicKey),
              let ciphertext = Data(base64URLEncoded: components.ciphertext),
              let iv = Data(base64URLEncoded: components.iv),
              let tag = Data(base64URLEncoded: components.tag) else {
             throw NSError(domain: "SecureEnclaveEncryption", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid Base64URL data"])
        }
        
        let senderPubKey: P256.KeyAgreement.PublicKey
        do {
            if ephemPubData.count == 65 {
                senderPubKey = try P256.KeyAgreement.PublicKey(x963Representation: ephemPubData)
            } else {
                senderPubKey = try P256.KeyAgreement.PublicKey(rawRepresentation: ephemPubData)
            }
        } catch {
            throw error
        }
        
        let privKey = try getOrCreatePrivateKey()
        let sharedSecret: SharedSecret
        do {
            switch privKey {
            case .secureEnclave(let k):
                sharedSecret = try k.sharedSecretFromKeyAgreement(with: senderPubKey)
            case .software(let k):
                sharedSecret = try k.sharedSecretFromKeyAgreement(with: senderPubKey)
            }
        } catch {
            throw error
        }
        
        let salt = "tobari-ecies-salt".data(using: .utf8)!
        let info = "tobari-ecies-info".data(using: .utf8)!

        let symmetricKey = sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: salt,
            sharedInfo: info,
            outputByteCount: 32
        )
        
        do {
            let sealedBox = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ciphertext, tag: tag)
            return try AES.GCM.open(sealedBox, using: symmetricKey)
        } catch {
            throw error
        }
    }

    func decrypt(jsonString: String) throws -> Data {
        let jsonData = jsonString.data(using: .utf8)!
        let msg = try JSONDecoder().decode(EncryptedComponents.self, from: jsonData)
        return try decrypt(components: msg)
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

        // Use Array slicing instead of subdata to avoid potential crash
        let rawBytes = [UInt8](rawPub)
        let xBytes = Array(rawBytes[0..<32])
        let yBytes = Array(rawBytes[32..<64])
        let x = Data(xBytes)
        let y = Data(yBytes)

        let toB64U = { (d: Data) in d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }

        return """
        {
          "kty": "EC",
          "crv": "P-256",
          "x": "\(toB64U(x))",
          "y": "\(toB64U(y))"
        }
        """
    }

    private func getOrCreatePrivateKey() throws -> DeviceAgreementKey {
        // Try to load from file first (for testing/CI environments)
        if let filePath = keyFilePath, forceSoftwareKey {
            if let data = try? Data(contentsOf: URL(fileURLWithPath: filePath)),
               let key = try? P256.KeyAgreement.PrivateKey(rawRepresentation: data) {
                return .software(key)
            }
        }

        // Skip Secure Enclave if software key is forced
        if forceSoftwareKey {
            if useKeychain {
                let softQuery: [String: Any] = [
                    kSecClass as String: kSecClassGenericPassword,
                    kSecAttrService as String: keyService,
                    kSecAttrAccount as String: keyTagSoftware,
                    kSecReturnData as String: true
                ]

                var softItem: CFTypeRef?
                if SecItemCopyMatching(softQuery as CFDictionary, &softItem) == errSecSuccess, let data = softItem as? Data {
                    if let key = try? P256.KeyAgreement.PrivateKey(rawRepresentation: data) {
                        return .software(key)
                    }
                }
            }

            let privateKey = P256.KeyAgreement.PrivateKey()

            // Save to file if specified
            if let filePath = keyFilePath {
                try? privateKey.rawRepresentation.write(to: URL(fileURLWithPath: filePath))
            }

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

        if useKeychain {
            let secureQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keyService,
                kSecAttrAccount as String: keyTagSecure,
                kSecReturnData as String: true
            ]

            var item: CFTypeRef?
            if SecItemCopyMatching(secureQuery as CFDictionary, &item) == errSecSuccess, let data = item as? Data {
                if let key = try? SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: data) {
                    return .secureEnclave(key)
                }
            }

            let softQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keyService,
                kSecAttrAccount as String: keyTagSoftware,
                kSecReturnData as String: true
            ]

            var softItem: CFTypeRef?
            if SecItemCopyMatching(softQuery as CFDictionary, &softItem) == errSecSuccess, let data = softItem as? Data {
                if let key = try? P256.KeyAgreement.PrivateKey(rawRepresentation: data) {
                    return .software(key)
                }
            }
        }

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