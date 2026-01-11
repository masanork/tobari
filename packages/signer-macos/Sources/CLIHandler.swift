import Foundation

struct SignRequest: Codable {
    let challenge: String // Base64URL
    let rp_id: String
    let message: String?
    let user_verification: String?
}

struct SignResponse: Codable {
    let signature: String // Base64URL
    let authData: String? // Base64URL (WebAuthn only)
    let clientDataJSON: String? // Raw JSON string (WebAuthn only)
    let publicKey: String? // JWK or Cert base64
}

class CLIHandler {
    private let isDebug = ProcessInfo.processInfo.environment["TOBARI_DEBUG"] == "1"

    private func debugLog(_ message: String) {
        if isDebug {
            fputs("Debug: \(message)\n", stderr)
        }
    }

    private func printResult<T: Encodable>(_ result: T) {
        do {
            let data = try JSONEncoder().encode(result)
            if let str = String(data: data, encoding: .utf8) {
                print(str)
            }
        } catch {
            fputs("Error encoding result: \(error.localizedDescription)\n", stderr)
        }
    }

    private func printError(_ error: Error) {
        let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        fputs("Error: \(message)\n", stderr)
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
                printError(error)
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
                printError(error)
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
                printError(error)
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
                printError(error)
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
                printResult(info)
                exit(0)
            } catch {
                printError(error)
                exit(1)
            }
        }
        
        if args.contains("--read-mynumber") {
            let pin: String
            if let pinIndex = args.firstIndex(of: "--pin"), pinIndex + 1 < args.count {
                pin = args[pinIndex + 1]
            } else {
                guard let p = SecurityUtils.promptForPIN(title: "My Number Card", message: "Enter your 4-digit PIN for text input assistance") else {
                    exit(1)
                }
                pin = p
            }
            
            debugLog("Reading My Number from JPKI Card...")
            let manager = SmartCardManager()
            let jpki = JPKIController(manager: manager)
            
            do {
                let myNumber = try await jpki.readMyNumber(pin: pin)
                print("{\"myNumber\": \"\(myNumber)\"}")
                exit(0)
            } catch {
                printError(error)
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
                printError(error)
                exit(1)
            }
        }

        if args.contains("--read-passport") {
            let manager = SmartCardManager()
            let controller = PassportController(manager: manager)
            
            do {
                try await controller.selectPassportAP()
                
                if let canIndex = args.firstIndex(of: "--can"), canIndex + 1 < args.count {
                    let can = args[canIndex + 1]
                    debugLog("Using PACE with CAN: \(can)")
                    try await controller.performPACE(password: can, isCan: true)
                } else if let mrzIndex = args.firstIndex(of: "--mrz"), mrzIndex + 1 < args.count {
                    let mrz = args[mrzIndex + 1]
                    if args.contains("--use-pace") {
                        debugLog("Using PACE with MRZ")
                        try await controller.performPACE(password: mrz, isCan: false)
                    } else {
                        debugLog("Using BAC with MRZ")
                        try await controller.performBAC(mrz: mrz)
                    }
                } else {
                    fputs("Error: --mrz or --can is required for passport reading\n", stderr)
                    exit(1)
                }
                
                let dg1 = try await controller.readDG1()
                let dg2 = try await controller.readDG2()
                print("{\"dg1\": \"\(dg1.base64EncodedString())\", \"dg2\": \"\(dg2.base64EncodedString())\"}")
                exit(0)
            } catch {
                printError(error)
                exit(1)
            }
        }

        if args.contains("--read-driver-license") {
            guard let pin1Index = args.firstIndex(of: "--pin1"), pin1Index + 1 < args.count,
                  let pin2Index = args.firstIndex(of: "--pin2"), pin2Index + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --read-driver-license --pin1 <PIN1> --pin2 <PIN2>\n", stderr)
                exit(1)
            }
            let pin1 = args[pin1Index + 1]
            let pin2 = args[pin2Index + 1]
            
            let manager = SmartCardManager()
            let controller = DriversLicenseController(manager: manager)
            do {
                try await controller.selectDLAP()
                try await controller.verifyPIN1(pin1)
                try await controller.verifyPIN2(pin2)
                let info = try await controller.readCommonData()
                printResult(info)
                exit(0)
            } catch {
                printError(error)
                exit(1)
            }
        }

        if args.contains("--read-residence-card") {
            let manager = SmartCardManager()
            let controller = ResidenceCardController(manager: manager)
            do {
                try await controller.selectJPRCAP()
                let info = try await controller.readDF2Info()
                printResult(info)
                exit(0)
            } catch {
                printError(error)
                exit(1)
            }
        }

        if args.contains("--register-passkey") {
            guard let reqIndex = args.firstIndex(of: "--request"), reqIndex + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --register-passkey --request <JSON>\n", stderr)
                exit(1)
            }
            let jsonStr = args[reqIndex + 1]
            guard let jsonData = jsonStr.data(using: .utf8),
                  let request = try? JSONDecoder().decode(SignRequest.self, from: jsonData),
                  let challengeData = fromBase64URL(request.challenge) else {
                printError(SignerError.serialization("Invalid JSON request or challenge"))
                exit(1)
            }

            if #available(macOS 12.0, *) {
                let auth = Authenticator()
                do {
                    let response = try await auth.register(rpID: request.rp_id, challenge: challengeData)
                    printResult(response)
                    exit(0)
                } catch {
                    printError(error)
                    exit(1)
                }
            } else {
                printError(SignerError.internalError("Passkey requires macOS 12.0+"))
                exit(1)
            }
        }

        if args.contains("--sign-passkey") {
            guard let reqIndex = args.firstIndex(of: "--request"), reqIndex + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --sign-passkey --request <JSON>\n", stderr)
                exit(1)
            }
            let jsonStr = args[reqIndex + 1]
            guard let jsonData = jsonStr.data(using: .utf8),
                  let request = try? JSONDecoder().decode(SignRequest.self, from: jsonData),
                  let challengeData = fromBase64URL(request.challenge) else {
                printError(SignerError.serialization("Invalid JSON request or challenge"))
                exit(1)
            }

            if #available(macOS 12.0, *) {
                let auth = Authenticator()
                do {
                    let response = try await auth.sign(rpID: request.rp_id, challenge: challengeData)
                    printResult(response)
                    exit(0)
                } catch {
                    printError(error)
                    exit(1)
                }
            } else {
                printError(SignerError.internalError("Passkey requires macOS 12.0+"))
                exit(1)
            }
        }
        
        if args.contains("--sign-jpki") {
            let signType = args.contains("--type") ? args[args.firstIndex(of: "--type")! + 1] : "auth"
            
            let pin: String
            if let pinIndex = args.firstIndex(of: "--pin"), pinIndex + 1 < args.count {
                pin = args[pinIndex + 1]
            } else {
                let msg = signType == "sign" ? "Enter your 6-16 character Digital Signature PIN" : "Enter your 4-digit PIN for User Authentication"
                guard let p = SecurityUtils.promptForPIN(title: "JPKI Signature", message: msg) else {
                    exit(1)
                }
                pin = p
            }

            guard let reqIndex = args.firstIndex(of: "--request"), reqIndex + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --sign-jpki --pin <PIN> --request <JSON> [--type auth|sign]\n", stderr)
                exit(1)
            }
            
            // Native UX: Ask for Touch ID before card access
            let authenticated = await SecurityUtils.authenticateUser(reason: "Authenticate to sign with My Number Card")
            if !authenticated {
                fputs("Authentication failed or cancelled\n", stderr)
                exit(1)
            }
            
            let jsonStr = args[reqIndex + 1]
            guard let jsonData = jsonStr.data(using: .utf8),
                  let request = try? JSONDecoder().decode(SignRequest.self, from: jsonData) else {
                printError(SignerError.serialization("Invalid JSON request"))
                exit(1)
            }
            
            guard let challengeData = fromBase64URL(request.challenge) else {
                printError(SignerError.invalidChallenge)
                exit(1)
            }

            debugLog("Signing with JPKI Card (\(signType))...")
            let manager = SmartCardManager()
            let jpki = JPKIController(manager: manager)

            do {
                let signature = try await jpki.computeSignature(pin: pin, data: challengeData, type: signType)
                let certData = try await jpki.readCertificate(pin: pin, type: signType)
                let jwk = jpki.extractPublicKeyJWK(from: certData) ?? ""
                
                let response = SignResponse(
                    signature: signature.base64EncodedString()
                        .replacingOccurrences(of: "+", with: "-")
                        .replacingOccurrences(of: "/", with: "_")
                        .replacingOccurrences(of: "=", with: ""),
                    authData: nil,
                    clientDataJSON: nil,
                    publicKey: jwk
                )
                printResult(response)
                exit(0)
            } catch {
                printError(error)
                exit(1)
            }
        }

        guard let reqIndex = args.firstIndex(of: "--request"), reqIndex + 1 < args.count else {
            fputs("Usage: tobari-signer-macos --request '<json>' | --scan-card | --read-attributes --pin <PIN> | --read-mynumber --pin <PIN> | --get-public-key | --read-passport --mrz <MRZ> | --read-driver-license --pin1 <PIN1> --pin2 <PIN2> | --read-residence-card\n", stderr)
            exit(1)
        }
        
        let jsonStr = args[reqIndex + 1]
        guard let jsonData = jsonStr.data(using: .utf8),
              let request = try? JSONDecoder().decode(SignRequest.self, from: jsonData) else {
            printError(SignerError.serialization("Invalid JSON request"))
            exit(1)
        }
        
        guard let challengeData = fromBase64URL(request.challenge) else {
            printError(SignerError.invalidChallenge)
            exit(1)
        }
        
        do {
            let signer = SecureEnclaveSigner()
            let (signature, publicKey) = try signer.sign(challenge: challengeData)
            
            let response = SignResponse(
                signature: signature,
                authData: nil,
                clientDataJSON: nil,
                publicKey: publicKey
            )
            
            printResult(response)
            exit(0)
            
        } catch {
            printError(error)
            exit(1)
        }
    }
}