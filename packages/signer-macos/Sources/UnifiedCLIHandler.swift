import Foundation

/// Handles unified request/response format for all signer operations by dispatching to specialized handlers.
class UnifiedCLIHandler {
    private let isDebug = ProcessInfo.processInfo.environment["TOBARI_DEBUG"] == "1"
    
    private let cardHandler = CardReadHandler()
    private let cryptoHandler = CryptoHandler()
    private let appHandler = ApplicationHandler()
    private let presentationHandler = PresentationHandler()

    private func debugLog(_ message: String) {
        if isDebug {
            fputs("Debug: \(message)\n", stderr)
        }
    }

    /// Print a unified response to stdout
    private func printResponse(_ response: UnifiedResponse) {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(response)
            if let str = String(data: data, encoding: .utf8) {
                print(str)
            }
        } catch {
            fputs("Error encoding response: \(error.localizedDescription)\n", stderr)
        }
    }

    /// Main entry point for unified request handling
    func handle(request: UnifiedRequest) async {
        debugLog("Processing command: \(request.command)")
        
        let response: UnifiedResponse

        switch request.command {
        case "sign_presentation", "approve_preview", "inspect_document":
            response = await presentationHandler.handle(request: request)

        case "read_card":
            response = await cardHandler.handle(request: request)

        case "create_application", "register_device":
            response = await appHandler.handle(request: request)

        case "sign_data", "decrypt_data", "get_public_key", "sign_with_jpki":
            response = await cryptoHandler.handle(request: request)

        default:
            response = UnifiedResponse.error(
                command: request.command,
                type: .unsupportedCommand,
                message: "Command '\(request.command)' is not supported"
            )
        }

        printResponse(response)
    }
}