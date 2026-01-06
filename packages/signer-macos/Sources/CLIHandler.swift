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
            fputs("Scanning for Smart Card...\n", stderr)
            let manager = SmartCardManager()
            let result = await manager.checkCard()
            print(result)
            exit(0)
        }

        if args.contains("--read-attributes") {
            // Find PIN
            guard let pinIndex = args.firstIndex(of: "--pin"), pinIndex + 1 < args.count else {
                fputs("Usage: tobari-signer-macos --read-attributes --pin <PIN>\n", stderr)
                exit(1)
            }
            let pin = args[pinIndex + 1]
            
            fputs("Reading attributes from JPKI Card...\n", stderr)
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
            
            fputs("Reading My Number from JPKI Card...\n", stderr)
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
        
        // JPKI Signing is temporarily disabled due to Extended APDU compatibility issues on macOS
        // if args.contains("--sign-jpki") { ... }

        guard let reqIndex = args.firstIndex(of: "--request"), reqIndex + 1 < args.count else {
            fputs("Usage: tobari-signer-macos --request '<json>' | --scan-card | --read-attributes --pin <PIN> | --read-mynumber --pin <PIN>\n", stderr)
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
            if let nsError = error as NSError? {
                 fputs("Debug: Error Domain: \(nsError.domain), Code: \(nsError.code)\n", stderr)
            }
            exit(1)
        }
    }
}
