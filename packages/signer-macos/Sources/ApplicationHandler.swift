import Foundation

class ApplicationHandler: CommandHandler {
    func handle(request: UnifiedRequest) async -> UnifiedResponse {
        switch request.command {
        case "create_application":
            return await handleCreateApplication(request)
        case "register_device":
            return await handleRegisterDevice(request)
        default:
            return UnifiedResponse.error(command: request.command, type: .unsupportedCommand, message: "Unsupported application command")
        }
    }

    private func handleCreateApplication(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(CreateApplicationParams.self, from: request.params)
            var jpkiPin = params.jpkiPin
            if jpkiPin == nil || jpkiPin?.isEmpty == true {
                jpkiPin = await MainActor.run {
                    SecurityUtils.promptForPIN(title: "マイナンバーカード 暗証番号", message: "券面事項入力補助用の4桁の数字を入力してください。")
                }
            }
            guard let finalPin = jpkiPin, !finalPin.isEmpty else {
                return UnifiedResponse.error(command: request.command, type: .invalidRequest, message: "JPKI PIN is required")
            }

            let creator = ApplicationCreator(debugLog: { _ in })
            let application = try await creator.createApplication(
                requestedDocType: params.requestedDocType,
                requestedFields: params.requestedFields,
                jpkiPin: finalPin,
                jpkiSignatureType: "auth"
            )

            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let applicationJSON = try encoder.encode(application)

            if let outputPath = params.outputPath {
                try applicationJSON.write(to: URL(fileURLWithPath: outputPath))
            }

            let applicationDict = try JSONSerialization.jsonObject(with: applicationJSON) as! [String: Any]
            return UnifiedResponse.success(
                command: request.command,
                type: .application,
                format: .json,
                data: applicationDict,
                metadata: ["applicationId": application.applicationId, "deviceBindingEnabled": true]
            )
        } catch {
            return handleSignerError(error, command: request.command)
        }
    }

    private func handleRegisterDevice(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let signer = SecureEnclaveSigner()
            let signingPublicKeyJWK = try signer.getPublicKey()
            let encryption = SecureEnclaveEncryption()
            let encryptionPublicKeyJWK = try encryption.getPublicKey()

            return UnifiedResponse.success(
                command: request.command,
                type: .key,
                format: .json,
                data: ["signingPublicKey": signingPublicKeyJWK, "encryptionPublicKey": encryptionPublicKeyJWK],
                metadata: ["platform": "macos"]
            )
        } catch {
            return handleSignerError(error, command: request.command)
        }
    }
}
