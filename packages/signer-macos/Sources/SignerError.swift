import Foundation

enum SignerError: Error, LocalizedError {
    case authenticator(String)
    case jpki(String)
    case pinIncorrect(retries: Int)
    case pinLocked
    case serialization(String)
    case internalError(String)
    case noRequest
    case invalidChallenge
    
    var errorDescription: String? {
        switch self {
        case .authenticator(let msg): return "Authenticator error: \(msg)"
        case .jpki(let msg): return "JPKI error: \(msg)"
        case .pinIncorrect(let retries): return "Incorrect PIN. \(retries) attempts remaining."
        case .pinLocked: return "The PIN is locked. Please visit a municipal office to reset it."
        case .serialization(let msg): return "Serialization error: \(msg)"
        case .internalError(let msg): return "Internal error: \(msg)"
        case .noRequest: return "No request found"
        case .invalidChallenge: return "Invalid challenge"
        }
    }
}
