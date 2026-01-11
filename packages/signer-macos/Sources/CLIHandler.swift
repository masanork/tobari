import Foundation

struct SignRequest: Codable {
    let challenge: String // Base64URL
    let rp_id: String
    let message: String?
}

struct SignResponse: Codable {
    let signature: String // Base64URL (DER encoded)
    let publicKey: String // JWK JSON String
}

class CLIHandler {
    private let isDebug = ProcessInfo.processInfo.environment["TOBARI_DEBUG"] == "1"

    private func debugLog(_ message: String) {
        if isDebug {
            fputs("Debug: \(message)\n", stderr)
        }
    }

    // Utility for Base64URL input
    private func fromBase64URL(_ string: String) -> Data? {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 {
            base64.append("=")
        }
        return Data(base64Encoded: base64)
    }

    func run() async {
        let args = ProcessInfo.processInfo.arguments
        
        if args.contains("--scan-card") {
            debugLog("Scanning for Smart Card...")
            let manager = SmartCardManager()
            let result = await manager.checkCard()
            print(result)
            exit(0)
        }

        if args.contains("--get-public-key") {
            do {
                let signer = SecureEnclaveSigner()
                let jwk = try signer.getPublicKey()
                print("{\"publicKey\": \(jwk)}")
                exit(0)
            } catch {
                fputs("Error: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
        }
        
        if args.contains("--get-encryption-public-key") {
            do {
                let encrypter = SecureEnclaveEncryption()
                let jwk = try encrypter.getPublicKey()
                print("{\"publicKey\": \(jwk)}")
                exit(0)
            } catch {
                fputs("Error: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
        }
        
        if args.contains("--decrypt") {
            guard let inputIndex = args.firstIndex(of: "--input"), inputIndex + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --decrypt --input <JSON>\n", stderr)
                exit(1)
            }
            let jsonStr = args[inputIndex + 1]
            
            do {
                let encrypter = SecureEnclaveEncryption()
                let decryptedData = try encrypter.decrypt(jsonString: jsonStr)
                
                if let text = String(data: decryptedData, encoding: .utf8) {
                    let safeText = text.replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: "\\n")
                    print("{\"plaintext\": \"\(safeText)\"}")
                } else {
                    let base64 = decryptedData.base64EncodedString()
                    print("{\"plaintextBase64\": \"\(base64)\"}")
                }
                exit(0)
            } catch {
                fputs("Error: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
        }

        if args.contains("--read-certificate") {
            guard let pinIndex = args.firstIndex(of: "--pin"), pinIndex + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --read-certificate --pin <PIN>\n", stderr)
                exit(1)
            }
            let pin = args[pinIndex + 1]
            
            debugLog("Reading User Authentication Certificate from JPKI Card...")
            let manager = SmartCardManager()
            let jpki = JPKIController(manager: manager)
            
            do {
                let certData = try await jpki.readCertificate(pin: pin)
                let certBase64 = certData.base64EncodedString()
                let jwk = jpki.extractPublicKeyJWK(from: certData) ?? ""
                
                print("{\"certificate\": \"\(certBase64)\", \"publicKeyJWK\": \(jwk.isEmpty ? "null" : jwk)}")
                exit(0)
            } catch {
                fputs("Error: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
        }

        if args.contains("--read-attributes") {
            guard let pinIndex = args.firstIndex(of: "--pin"), pinIndex + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --read-attributes --pin <PIN>\n", stderr)
                exit(1)
            }
            let pin = args[pinIndex + 1]
            
            debugLog("Reading attributes from JPKI Card...")
            let manager = SmartCardManager()
            let jpki = JPKIController(manager: manager)
            
            do {
                let info = try await jpki.readAttributes(pin: pin)
                let encoder = JSONEncoder()
                encoder.outputFormatting = .prettyPrinted
                let jsonData = try encoder.encode(info)
                print(String(data: jsonData, encoding: .utf8)!)
                exit(0)
            } catch {
                fputs("Error: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
        }
        
        if args.contains("--read-mynumber") {
             guard let pinIndex = args.firstIndex(of: "--pin"), pinIndex + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --read-mynumber --pin <PIN>\n", stderr)
                exit(1)
            }
            let pin = args[pinIndex + 1]
            
            debugLog("Reading My Number from JPKI Card...")
            let manager = SmartCardManager()
            let jpki = JPKIController(manager: manager)
            
            do {
                let myNumber = try await jpki.readMyNumber(pin: pin)
                print("{\"myNumber\": \"\(myNumber)\"}")
                exit(0)
            } catch {
                fputs("Error: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
        }

        if args.contains("--read-face-photo") {
             guard let pinIndex = args.firstIndex(of: "--pin"), pinIndex + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --read-face-photo --pin <PIN>\n", stderr)
                exit(1)
            }
            let pin = args[pinIndex + 1]
            
            debugLog("Reading Face Photo from JPKI Card...")
            let manager = SmartCardManager()
            let jpki = JPKIController(manager: manager)
            
            do {
                let photoData = try await jpki.readFacePhoto(pin: pin)
                let photoBase64 = photoData.base64EncodedString()
                print("{\"photo\": \"\(photoBase64)\"}")
                exit(0)
            } catch {
                fputs("Error: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
        }
        
        if args.contains("--sign-jpki") {
             guard let pinIndex = args.firstIndex(of: "--pin"), pinIndex + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --sign-jpki --pin <PIN> --request <JSON>\n", stderr)
                exit(1)
            }
            let pin = args[pinIndex + 1]

            guard let reqIndex = args.firstIndex(of: "--request"), reqIndex + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --sign-jpki --pin <PIN> --request <JSON>\n", stderr)
                exit(1)
            }
            
            let jsonStr = args[reqIndex + 1]
            guard let jsonData = jsonStr.data(using: .utf8),
                  let request = try? JSONDecoder().decode(SignRequest.self, from: jsonData) else {
                fputs("Invalid JSON request\n", stderr)
                exit(1)
            }
            
            guard let challengeData = fromBase64URL(request.challenge) else {
                fputs("Invalid Base64URL challenge\n", stderr)
                exit(1)
            }

            debugLog("Signing with JPKI Card...")
            let manager = SmartCardManager()
            let jpki = JPKIController(manager: manager)

            do {
                let signature = try await jpki.computeAuthSignature(pin: pin, data: challengeData)
                let certData = try await jpki.readCertificate(pin: pin)
                let jwk = jpki.extractPublicKeyJWK(from: certData) ?? ""
                
                let response = SignResponse(
                    signature: signature.base64EncodedString()
                        .replacingOccurrences(of: "+", with: "-")
                        .replacingOccurrences(of: "/", with: "_")
                        .replacingOccurrences(of: "=", with: ""),
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

        guard let reqIndex = args.firstIndex(of: "--request"), reqIndex + 1 < args.count else {
            fputs("Usage: tobari-signer-macos --request '<json>' | --scan-card | --read-attributes --pin <PIN> | --read-mynumber --pin <PIN> | --get-public-key\n", stderr)
            exit(1)
        }
        
        let jsonStr = args[reqIndex + 1]
        guard let jsonData = jsonStr.data(using: .utf8),
              let request = try? JSONDecoder().decode(SignRequest.self, from: jsonData) else {
            fputs("Invalid JSON request\n", stderr)
            exit(1)
        }
        
        guard let challengeData = fromBase64URL(request.challenge) else {
            fputs("Invalid Base64URL challenge\n", stderr)
            exit(1)
        }
        
        do {
            let signer = SecureEnclaveSigner()
            let (signature, publicKey) = try signer.sign(challenge: challengeData)
            
            let response = SignResponse(
                signature: signature,
                publicKey: publicKey
            )
            
            let responseData = try JSONEncoder().encode(response)
            print(String(data: responseData, encoding: .utf8)!)
            exit(0)
            
        } catch {
            fputs("Error: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
}