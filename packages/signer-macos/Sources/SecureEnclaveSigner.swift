import Foundation
import CryptoKit
import Security

class SecureEnclaveSigner {
    private let keyTagSecure = "io.github.masanork.tobari.device-key.v1.se"
    private let keyTagSoftware = "io.github.masanork.tobari.device-key.v1.sw"
    private let keyService = "io.github.masanork.tobari.signer"
    private let useKeychain = ProcessInfo.processInfo.environment["TOBARI_SIGNER_USE_KEYCHAIN"] == "1"
    private let deviceJwkPath = ProcessInfo.processInfo.environment["TOBARI_DEVICE_JWK_PATH"]

    private enum DeviceSigningKey {
        case secureEnclave(SecureEnclave.P256.Signing.PrivateKey)
        case software(P256.Signing.PrivateKey)
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

    func sign(challenge: Data) throws -> (signature: String, publicKey: String) {
        // 1. Get Key
        let key = try getOrCreatePrivateKey()
        
        // 2. Prepare Public Key (JWK)
        let rawPub: Data
        switch key {
        case .secureEnclave(let privateKey):
            rawPub = privateKey.publicKey.rawRepresentation
        case .software(let privateKey):
            rawPub = privateKey.publicKey.rawRepresentation
        }
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
        let signature: P256.Signing.ECDSASignature
        switch key {
        case .secureEnclave(let privateKey):
            signature = try privateKey.signature(for: challenge)
        case .software(let privateKey):
            signature = try privateKey.signature(for: challenge)
        }
        fputs("Debug: Signature generated successfully.\n", stderr)
        
        return (toBase64URL(signature.rawRepresentation), jwk)
    }

    private func getOrCreatePrivateKey() throws -> DeviceSigningKey {
        if let path = deviceJwkPath {
            if let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
               let jwk = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let d = jwk["d"] as? String,
               let raw = fromBase64URL(d) {
                let privateKey = try P256.Signing.PrivateKey(rawRepresentation: raw)
                fputs("Debug: Using device key from TOBARI_DEVICE_JWK_PATH.\n", stderr)
                return .software(privateKey)
            } else {
                fputs("Debug: Failed to load TOBARI_DEVICE_JWK_PATH. Falling back to generated key.\n", stderr)
            }
        }
        if useKeychain {
            fputs("Debug: Attempting to retrieve existing key from Keychain...\n", stderr)

            let secureQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keyService,
                kSecAttrAccount as String: keyTagSecure,
                kSecReturnData as String: true
            ]

            var secureItem: CFTypeRef? = nil
            let secureStatus = SecItemCopyMatching(secureQuery as CFDictionary, &secureItem)
            if secureStatus == errSecSuccess, let data = secureItem as? Data {
                if let key = try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: data) {
                    fputs("Debug: Loaded Secure Enclave key from Keychain.\n", stderr)
                    return .secureEnclave(key)
                }
            } else if secureStatus != errSecItemNotFound {
                fputs("Debug: SecItemCopyMatching (secure) failed with status: \(secureStatus)\n", stderr)
            }

            let softwareQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keyService,
                kSecAttrAccount as String: keyTagSoftware,
                kSecReturnData as String: true
            ]

            var softwareItem: CFTypeRef? = nil
            let softwareStatus = SecItemCopyMatching(softwareQuery as CFDictionary, &softwareItem)
            if softwareStatus == errSecSuccess, let data = softwareItem as? Data {
                if let key = try? P256.Signing.PrivateKey(rawRepresentation: data) {
                    fputs("Debug: Loaded software key from Keychain.\n", stderr)
                    return .software(key)
                }
            } else if softwareStatus != errSecItemNotFound {
                fputs("Debug: SecItemCopyMatching (software) failed with status: \(softwareStatus)\n", stderr)
            } else {
                fputs("Debug: Key not found. Generating new key...\n", stderr)
            }
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
        do {
            let privateKey = try SecureEnclave.P256.Signing.PrivateKey(accessControl: accessControl)

            // Save to Keychain
            let saveQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keyService,
                kSecAttrAccount as String: keyTagSecure,
                kSecValueData as String: privateKey.dataRepresentation
            ]

            if useKeychain {
                fputs("Debug: Saving new Secure Enclave key to Keychain...\n", stderr)
                SecItemDelete(saveQuery as CFDictionary)
                let status = SecItemAdd(saveQuery as CFDictionary, nil)
                if status != errSecSuccess {
                    fputs("Debug: SecItemAdd failed with status: \(status)\n", stderr)
                    throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: nil)
                }
                fputs("Debug: Secure Enclave key saved successfully.\n", stderr)
            }
            return .secureEnclave(privateKey)
        } catch {
            fputs("Debug: Secure Enclave key creation failed. Falling back to software key.\n", stderr)
            let privateKey = P256.Signing.PrivateKey()
            let saveQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keyService,
                kSecAttrAccount as String: keyTagSoftware,
                kSecValueData as String: privateKey.rawRepresentation
            ]
            if useKeychain {
                SecItemDelete(saveQuery as CFDictionary)
                let status = SecItemAdd(saveQuery as CFDictionary, nil)
                if status != errSecSuccess {
                    fputs("Debug: SecItemAdd failed with status: \(status)\n", stderr)
                    throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: nil)
                }
                fputs("Debug: Software key saved successfully.\n", stderr)
            }
            return .software(privateKey)
        }
    }
}
