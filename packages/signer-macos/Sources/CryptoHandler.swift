import Foundation

class CryptoHandler: CommandHandler {
    func handle(request: UnifiedRequest) async -> UnifiedResponse {
        switch request.command {
        case "sign_data":
            return await handleSignData(request)
        case "decrypt_data":
            return await handleDecryptData(request)
        case "get_public_key":
            return await handleGetPublicKey(request)
        case "sign_with_jpki":
            return await handleSignWithJpki(request)
        default:
            return UnifiedResponse.error(command: request.command, type: .unsupportedCommand, message: "Unsupported crypto command")
        }
    }

    private func handleSignData(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(SignDataParams.self, from: request.params)
            guard let challengeData = Data(base64URLEncoded: params.data) else {
                return UnifiedResponse.error(command: request.command, type: .invalidRequest, message: "Invalid Base64URL data")
            }

            let authenticated = await SecurityUtils.authenticateUser(reason: "Sign data with device key")
            guard authenticated else {
                return UnifiedResponse.error(command: request.command, type: .userCancelled, message: "User cancelled authentication")
            }

            let signer = SecureEnclaveSigner()
            let (signature, publicKey) = try signer.sign(challenge: challengeData)

            return UnifiedResponse.success(
                command: request.command,
                type: .signature,
                format: .json,
                data: ["signature": signature, "publicKey": publicKey],
                metadata: ["algorithm": params.algorithm ?? "ES256"]
            )
        } catch {
            return handleSignerError(error, command: request.command)
        }
    }

    private func handleDecryptData(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(DecryptDataParams.self, from: request.params)
            
            if let jsonString = params.encryptedData,
               let jsonData = jsonString.data(using: .utf8),
               let envelope = try? JSONDecoder().decode(Envelope.self, from: jsonData),
               envelope.version == "2.0" {
                
                if let prfRecipient = envelope.recipients.compactMap({ r -> WebAuthnPrfRecipient? in
                    if case .webAuthnPrf(let val) = r { return val }
                    return nil
                }).first {
                    
                    guard let salt = Data(base64URLEncoded: prfRecipient.salt),
                          let credentialID = Data(base64URLEncoded: prfRecipient.kid) else {
                        throw NSError(domain: "CryptoHandler", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid Base64URL in PRF recipient"])
                    }
                    
                    if #available(macOS 14.0, *) {
                        let auth = Authenticator()
                        let rpID = params.metadata?["rpId"] ?? "localhost"
                        
                        let response = try await auth.signWithPrf(
                            rpID: rpID, 
                            challenge: Data(count: 32), 
                            salt: salt, 
                            credentialID: credentialID
                        )
                        
                        guard let prfOutputStr = response.prf,
                              let prfOutput = Data(base64URLEncoded: prfOutputStr) else {
                            throw NSError(domain: "CryptoHandler", code: 3, userInfo: [NSLocalizedDescriptionKey: "No PRF output received"])
                        }
                        
                        let decryptor = EnvelopeEncryption()
                        let decryptedData = try decryptor.decrypt(envelope: envelope, prfOutput: prfOutput, prfKid: prfRecipient.kid)
                        
                        return UnifiedResponse.success(command: request.command, type: .encrypted, format: .base64, data: decryptedData.base64URLEncodedString())
                    } else {
                        throw NSError(domain: "CryptoHandler", code: 4, userInfo: [NSLocalizedDescriptionKey: "PRF decryption requires macOS 14.0+"])
                    }
                }
            }
            
            let encryption = SecureEnclaveEncryption()
            let decryptedData: Data
            if let components = params.components {
                decryptedData = try encryption.decrypt(components: components)
            } else if let jsonString = params.encryptedData {
                decryptedData = try encryption.decrypt(jsonString: jsonString)
            } else {
                throw NSError(domain: "CryptoHandler", code: 1, userInfo: [NSLocalizedDescriptionKey: "Either components or encryptedData is required"])
            }
            
            return UnifiedResponse.success(command: request.command, type: .encrypted, format: .base64, data: decryptedData.base64URLEncodedString())
        } catch {
            return handleSignerError(error, command: request.command)
        }
    }

    private func handleGetPublicKey(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let signer = SecureEnclaveSigner()
            let publicKeyJWK = try signer.getPublicKey()
            return UnifiedResponse.success(command: request.command, type: .key, format: .json, data: publicKeyJWK)
        } catch {
            return handleSignerError(error, command: request.command)
        }
    }

    private func handleSignWithJpki(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(SignWithJpkiParams.self, from: request.params)
            guard let dataToSign = Data(base64URLEncoded: params.data) else {
                return UnifiedResponse.error(command: request.command, type: .invalidRequest, message: "Invalid Base64URL data")
            }

            let signatureType = params.signatureType ?? "auth"
            var pin = params.pin
            if pin == nil || pin?.isEmpty == true {
                pin = await MainActor.run {
                    SecurityUtils.promptForPIN(
                        title: "マイナンバーカード 暗証番号",
                        message: signatureType == "auth" ? "利用者証明用（4桁）の数字を入力してください。" : "署名用（6〜16桁）の英数字を入力してください。"
                    )
                }
            }
            guard let finalPin = pin, !finalPin.isEmpty else {
                return UnifiedResponse.error(command: request.command, type: .invalidRequest, message: "PIN is required")
            }

            let manager = SmartCardManager.shared
            manager.beginOperation()
            defer { manager.endOperation() }
            let jpki = JPKIController(manager: manager)
            let signature = try await jpki.computeSignature(pin: finalPin, data: dataToSign, type: signatureType)
            let info = try await jpki.readAttributes(pin: finalPin)
            let certificate = signatureType == "auth" ? info.authCert : info.signCert

            return UnifiedResponse.success(
                command: request.command,
                type: .signature,
                format: .json,
                data: ["signature": signature.base64URLEncodedString(), "certificate": certificate ?? "", "algorithm": "RS256"],
                metadata: ["signatureType": signatureType, "keyType": "jpki"]
            )
        } catch {
            return handleSignerError(error, command: request.command)
        }
    }
}
