import Foundation

// MARK: - Unified Request/Response Protocol

/// Unified request format for all signer operations
struct UnifiedRequest: Codable {
    let command: String
    let params: AnyCodable
    let preview: Bool?

    enum CodingKeys: String, CodingKey {
        case command, params, preview
    }
}

/// Unified response format for all signer operations
struct UnifiedResponse: Codable {
    let status: ResponseStatus
    let command: String
    let result: ResponseResult?
    let preview: PreviewInfo?
    let error: ErrorInfo?

    enum ResponseStatus: String, Codable {
        case success
        case error
        case preview
    }
}

/// Main result data container
struct ResponseResult: Codable {
    let type: ResultType
    let format: DataFormat
    let data: AnyCodable  // Base64URL string or JSON object
    let metadata: [String: AnyCodable]?

    enum ResultType: String, Codable {
        case vp              // Verifiable Presentation
        case signature       // Signature data
        case cardData        // Smart card read data
        case key             // Public key or key pair
        case application     // Application document
        case encrypted       // Encrypted data
    }

    enum DataFormat: String, Codable {
        case cose            // CBOR Object Signing and Encryption
        case json            // JSON object
        case cbor            // CBOR binary
        case jwt             // JSON Web Token
        case der             // DER encoded
        case base64          // Raw Base64 data
    }
}

/// Preview information for user approval
struct PreviewInfo: Codable {
    let summary: String
    let fields: [PreviewField]?
    let requiresApproval: Bool
    let sessionId: String?

    struct PreviewField: Codable {
        let name: String
        let value: String
        let disclosed: Bool
    }
}

/// Error information
struct ErrorInfo: Codable {
    let type: ErrorType
    let message: String
    let details: [String: AnyCodable]?

    enum ErrorType: String, Codable {
        case incorrectPin = "IncorrectPin"
        case pinLocked = "PinLocked"
        case cardNotFound = "CardNotFound"
        case userCancelled = "UserCancelled"
        case invalidRequest = "InvalidRequest"
        case internalError = "InternalError"
        case unsupportedCommand = "UnsupportedCommand"
    }
}

// MARK: - Command-Specific Parameters

/// Parameters for sign_presentation command
struct SignPresentationParams: Codable {
    let documentPath: String?          // Path to mdoc file
    let documentData: String?          // Base64URL encoded document
    let disclosureFields: [String]?    // Fields to disclose
    let verifierId: String?            // OID4VP Client ID
    let nonce: String?                 // OID4VP session nonce
    let responseUri: String?           // OID4VP response URI
    let outputFormat: String?          // "cose" or "jwt"
}

/// Parameters for read_card command
struct ReadCardParams: Codable {
    let cardType: CardType
    let pin: String?
    let pin1: String?
    let pin2: String?
    let mrz: String?                   // For passport
    let can: String?                   // For passport PACE
    let usePace: Bool?
    let includeMyNumber: Bool?         // For JPKI: include My Number (12 digits)
    let includeFacePhoto: Bool?        // For JPKI: include face photo
    let includeCertificates: Bool?     // For JPKI: include certificates

    enum CardType: String, Codable {
        case jpki = "jpki"
        case passport = "passport"
        case driversLicense = "drivers_license"
        case residenceCard = "residence_card"
    }
}

/// Parameters for create_application command
struct CreateApplicationParams: Codable {
    let requestedDocType: String       // DocType to apply for (e.g. "jp.go.juminhyo.v1")
    let requestedFields: [String]?     // Optional: specific fields requested
    let jpkiPin: String?              // PIN for JPKI signature
    let outputPath: String?           // Where to save application
}

/// Parameters for register_device command
struct RegisterDeviceParams: Codable {
    let keyType: String?               // "passkey" or "secure_enclave"
    let exportPublicKey: Bool?         // Export public key in JWK format
}

/// Parameters for sign_data command (generic signature)
struct SignDataParams: Codable {
    let data: String                   // Base64URL encoded data to sign
    let algorithm: String?             // "ES256", "ES384", "RS256", etc.
    let keyId: String?                // Optional key identifier
}

/// Parameters for sign_with_jpki command
struct SignWithJpkiParams: Codable {
    let data: String                   // Base64URL encoded data to sign
    let pin: String                    // JPKI PIN (auth or sign)
    let signatureType: String?         // "auth" or "sign" (default: "auth")
}

/// Parameters for decrypt_data command
struct DecryptDataParams: Codable {
    let encryptedData: String          // Base64URL encoded HPKE encrypted data
    let metadata: [String: String]?    // Optional decryption metadata
}

// MARK: - AnyCodable Helper

/// Type-erased Codable container for flexible JSON structures
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let dictionary = try? container.decode([String: AnyCodable].self) {
            value = dictionary.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode AnyCodable"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dictionary as [String: Any]:
            try container.encode(dictionary.mapValues { AnyCodable($0) })
        default:
            throw EncodingError.invalidValue(
                value,
                EncodingError.Context(
                    codingPath: container.codingPath,
                    debugDescription: "Cannot encode AnyCodable"
                )
            )
        }
    }
}

// MARK: - Helper Extensions

extension UnifiedResponse {
    /// Create a success response
    static func success(
        command: String,
        type: ResponseResult.ResultType,
        format: ResponseResult.DataFormat,
        data: Any,
        metadata: [String: Any]? = nil
    ) -> UnifiedResponse {
        let result = ResponseResult(
            type: type,
            format: format,
            data: AnyCodable(data),
            metadata: metadata?.mapValues { AnyCodable($0) }
        )

        return UnifiedResponse(
            status: .success,
            command: command,
            result: result,
            preview: nil,
            error: nil
        )
    }

    /// Create an error response
    static func error(
        command: String,
        type: ErrorInfo.ErrorType,
        message: String,
        details: [String: Any]? = nil
    ) -> UnifiedResponse {
        let errorInfo = ErrorInfo(
            type: type,
            message: message,
            details: details?.mapValues { AnyCodable($0) }
        )

        return UnifiedResponse(
            status: .error,
            command: command,
            result: nil,
            preview: nil,
            error: errorInfo
        )
    }

    /// Create a preview response
    static func preview(
        command: String,
        summary: String,
        fields: [PreviewInfo.PreviewField],
        sessionId: String
    ) -> UnifiedResponse {
        let previewInfo = PreviewInfo(
            summary: summary,
            fields: fields,
            requiresApproval: true,
            sessionId: sessionId
        )

        return UnifiedResponse(
            status: .preview,
            command: command,
            result: nil,
            preview: previewInfo,
            error: nil
        )
    }
}

// MARK: - Backward Compatibility

/// Legacy SignRequest format (for backward compatibility)
struct LegacySignRequest: Codable {
    let challenge: String
    let rp_id: String
    let message: String?
    let user_verification: String?
}

/// Legacy SignResponse format (for backward compatibility)
struct LegacySignResponse: Codable {
    let signature: String
    let authData: String?
    let clientDataJSON: String?
    let publicKey: String?
}
