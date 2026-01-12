import Foundation

/// Manages preview sessions for approval flow
class PreviewSession {
    struct Session {
        let documentData: Data
        let mdoc: MdocDocument
        let disclosedFields: [String]
        let verifierId: String?
        let nonce: String?
        let responseUri: String?
        let createdAt: Date
    }

    private static var sessions: [String: Session] = [:]
    private static let sessionTimeout: TimeInterval = 300 // 5 minutes

    /// Store a preview session
    static func store(
        sessionId: String,
        documentData: Data,
        mdoc: MdocDocument,
        disclosedFields: [String],
        verifierId: String?,
        nonce: String?,
        responseUri: String?
    ) {
        // Clean up expired sessions
        cleanupExpiredSessions()

        let session = Session(
            documentData: documentData,
            mdoc: mdoc,
            disclosedFields: disclosedFields,
            verifierId: verifierId,
            nonce: nonce,
            responseUri: responseUri,
            createdAt: Date()
        )

        sessions[sessionId] = session
    }

    /// Retrieve and remove a preview session
    static func retrieve(sessionId: String) -> Session? {
        defer {
            sessions.removeValue(forKey: sessionId)
        }

        guard let session = sessions[sessionId] else {
            return nil
        }

        // Check if session expired
        if Date().timeIntervalSince(session.createdAt) > sessionTimeout {
            return nil
        }

        return session
    }

    /// Clean up expired sessions
    private static func cleanupExpiredSessions() {
        let now = Date()
        sessions = sessions.filter { _, session in
            now.timeIntervalSince(session.createdAt) <= sessionTimeout
        }
    }

    /// Get all active session IDs (for debugging)
    static func getActiveSessions() -> [String] {
        cleanupExpiredSessions()
        return Array(sessions.keys)
    }
}
