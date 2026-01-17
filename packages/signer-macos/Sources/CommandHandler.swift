import Foundation

/// Protocol for objects that can handle a specific unified command
protocol CommandHandler {
    func handle(request: UnifiedRequest) async -> UnifiedResponse
}

/// Common utilities for command handlers
extension CommandHandler {
    func debugLog(_ message: String) {
        if ProcessInfo.processInfo.environment["TOBARI_DEBUG"] == "1" {
            fputs("Debug: \(message)\n", stderr)
        }
    }
    
    func decodeParams<T: Codable>(_ type: T.Type, from params: AnyCodable) throws -> T {
        let encoder = JSONEncoder()
        let data = try encoder.encode(params)
        let decoder = JSONDecoder()
        return try decoder.decode(T.self, from: data)
    }
    
    func handleSignerError(_ error: Error, command: String) -> UnifiedResponse {
        if let signerError = error as? SignerError {
            switch signerError {
            case .pinIncorrect(let retries):
                return UnifiedResponse.error(
                    command: command,
                    type: .incorrectPin,
                    message: "Incorrect PIN. \(retries) retries remaining.",
                    details: ["retries": retries]
                )
            case .pinLocked:
                return UnifiedResponse.error(
                    command: command,
                    type: .pinLocked,
                    message: "PIN is locked. Please visit your local municipal office to reset it."
                )
            default:
                return UnifiedResponse.error(
                    command: command,
                    type: .internalError,
                    message: signerError.localizedDescription
                )
            }
        }
        
        return UnifiedResponse.error(
            command: command,
            type: .internalError,
            message: error.localizedDescription
        )
    }
}
