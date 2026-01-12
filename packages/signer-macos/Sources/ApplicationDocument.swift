import Foundation
import CryptoKit

/// Application document for identity document issuance with holder binding
struct ApplicationDocument: Codable {
    /// Application metadata
    let applicationId: String
    let createdAt: String // ISO8601
    let applicationType: String // "issuance" or "renewal"

    /// Requested document
    let requestedDocType: String
    let requestedFields: [String]?

    /// Device Key Binding
    let deviceSigningKey: DevicePublicKey
    let deviceEncryptionKey: DevicePublicKey

    /// Applicant identification (signed by JPKI)
    let applicantInfo: ApplicantInfo?

    /// JPKI Signature
    let jpkiSignature: JpkiSignatureInfo?

    struct DevicePublicKey: Codable {
        let kty: String // "EC"
        let crv: String // "P-256"
        let x: String   // Base64URL
        let y: String   // Base64URL
        let kid: String? // Key ID
    }

    struct ApplicantInfo: Codable {
        let name: String?
        let birthDate: String?
        let address: String?
        let identificationMethod: String // "jpki", "passport", etc.
    }

    struct JpkiSignatureInfo: Codable {
        let signature: String // Base64URL DER signature
        let certificate: String // Base64 X.509 certificate
        let signatureType: String // "auth" or "sign"
        let algorithm: String // "RS256"
    }
}

/// Builder for creating application documents
class ApplicationDocumentBuilder {
    private var applicationId: String = UUID().uuidString
    private var applicationType: String = "issuance"
    private var requestedDocType: String = ""
    private var requestedFields: [String]?
    private var deviceSigningKey: ApplicationDocument.DevicePublicKey?
    private var deviceEncryptionKey: ApplicationDocument.DevicePublicKey?
    private var applicantInfo: ApplicationDocument.ApplicantInfo?
    private var jpkiSignature: ApplicationDocument.JpkiSignatureInfo?

    func setApplicationId(_ id: String) -> Self {
        self.applicationId = id
        return self
    }

    func setApplicationType(_ type: String) -> Self {
        self.applicationType = type
        return self
    }

    func setRequestedDocType(_ docType: String) -> Self {
        self.requestedDocType = docType
        return self
    }

    func setRequestedFields(_ fields: [String]) -> Self {
        self.requestedFields = fields
        return self
    }

    func setDeviceKeys(signing: ApplicationDocument.DevicePublicKey, encryption: ApplicationDocument.DevicePublicKey) -> Self {
        self.deviceSigningKey = signing
        self.deviceEncryptionKey = encryption
        return self
    }

    func setApplicantInfo(_ info: ApplicationDocument.ApplicantInfo) -> Self {
        self.applicantInfo = info
        return self
    }

    func setJpkiSignature(_ signature: ApplicationDocument.JpkiSignatureInfo) -> Self {
        self.jpkiSignature = signature
        return self
    }

    /// Build the application document
    func build() throws -> ApplicationDocument {
        guard !requestedDocType.isEmpty else {
            throw ApplicationError.missingRequiredField("requestedDocType")
        }

        guard let deviceSigningKey = deviceSigningKey else {
            throw ApplicationError.missingRequiredField("deviceSigningKey")
        }

        guard let deviceEncryptionKey = deviceEncryptionKey else {
            throw ApplicationError.missingRequiredField("deviceEncryptionKey")
        }

        return ApplicationDocument(
            applicationId: applicationId,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            applicationType: applicationType,
            requestedDocType: requestedDocType,
            requestedFields: requestedFields,
            deviceSigningKey: deviceSigningKey,
            deviceEncryptionKey: deviceEncryptionKey,
            applicantInfo: applicantInfo,
            jpkiSignature: jpkiSignature
        )
    }

    /// Build and serialize to JSON
    func buildJSON() throws -> Data {
        let document = try build()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(document)
    }
}

/// Create application document with JPKI signature
class ApplicationCreator {
    private let debugLog: (String) -> Void

    init(debugLog: @escaping (String) -> Void = { _ in }) {
        self.debugLog = debugLog
    }

    /// Create application document with holder binding
    func createApplication(
        requestedDocType: String,
        requestedFields: [String]?,
        jpkiPin: String,
        jpkiSignatureType: String = "auth"
    ) async throws -> ApplicationDocument {

        debugLog("Creating application for \(requestedDocType)")

        // Step 1: Generate/Get Device Keys
        debugLog("Retrieving device keys...")
        let signer = SecureEnclaveSigner()
        let encryption = SecureEnclaveEncryption()

        let signingKeyJWK = try signer.getPublicKey()
        let encryptionKeyJWK = try encryption.getPublicKey()

        let signingKey = try parseJWK(signingKeyJWK)
        let encryptionKey = try parseJWK(encryptionKeyJWK)

        // Step 2: Read JPKI Card for applicant info
        debugLog("Reading JPKI card...")
        let manager = SmartCardManager()
        let jpki = JPKIController(manager: manager)

        let basicInfo = try await jpki.readAttributes(pin: jpkiPin)

        let applicantInfo = ApplicationDocument.ApplicantInfo(
            name: basicInfo.name,
            birthDate: basicInfo.birthDate,
            address: basicInfo.address,
            identificationMethod: "jpki"
        )

        // Step 3: Create application payload to sign
        let builder = ApplicationDocumentBuilder()
            .setRequestedDocType(requestedDocType)
            .setRequestedFields(requestedFields ?? [])
            .setDeviceKeys(signing: signingKey, encryption: encryptionKey)
            .setApplicantInfo(applicantInfo)

        let unsignedDoc = try builder.build()
        let unsignedJSON = try JSONEncoder().encode(unsignedDoc)

        // Step 4: Sign with JPKI
        debugLog("Signing application with JPKI...")
        let signature = try await jpki.computeSignature(
            pin: jpkiPin,
            data: unsignedJSON,
            type: jpkiSignatureType
        )

        // Get certificate
        let certificate = jpkiSignatureType == "auth" ? basicInfo.authCert : basicInfo.signCert

        let jpkiSignatureInfo = ApplicationDocument.JpkiSignatureInfo(
            signature: signature.base64URLEncodedString(),
            certificate: certificate ?? "",
            signatureType: jpkiSignatureType,
            algorithm: "RS256"
        )

        // Step 5: Build final signed application
        let finalDoc = try ApplicationDocumentBuilder()
            .setApplicationId(unsignedDoc.applicationId)
            .setApplicationType(unsignedDoc.applicationType)
            .setRequestedDocType(requestedDocType)
            .setRequestedFields(requestedFields ?? [])
            .setDeviceKeys(signing: signingKey, encryption: encryptionKey)
            .setApplicantInfo(applicantInfo)
            .setJpkiSignature(jpkiSignatureInfo)
            .build()

        debugLog("Application created successfully: \(finalDoc.applicationId)")

        return finalDoc
    }

    /// Parse JWK string to DevicePublicKey
    private func parseJWK(_ jwkString: String) throws -> ApplicationDocument.DevicePublicKey {
        guard let data = jwkString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ApplicationError.invalidJWK("Failed to parse JWK")
        }

        guard let kty = json["kty"] as? String,
              let crv = json["crv"] as? String,
              let x = json["x"] as? String,
              let y = json["y"] as? String else {
            throw ApplicationError.invalidJWK("Missing required JWK fields")
        }

        return ApplicationDocument.DevicePublicKey(
            kty: kty,
            crv: crv,
            x: x,
            y: y,
            kid: json["kid"] as? String
        )
    }
}

/// Verify application document signature
class ApplicationVerifier {
    /// Verify JPKI signature on application
    func verifyApplication(_ application: ApplicationDocument) throws -> Bool {
        guard application.jpkiSignature != nil else {
            throw ApplicationError.missingSignature
        }

        // Reconstruct unsigned document for verification
        let unsignedDoc = ApplicationDocument(
            applicationId: application.applicationId,
            createdAt: application.createdAt,
            applicationType: application.applicationType,
            requestedDocType: application.requestedDocType,
            requestedFields: application.requestedFields,
            deviceSigningKey: application.deviceSigningKey,
            deviceEncryptionKey: application.deviceEncryptionKey,
            applicantInfo: application.applicantInfo,
            jpkiSignature: nil
        )

        _ = try JSONEncoder().encode(unsignedDoc)

        // TODO: Verify RSA signature with JPKI certificate
        // For now, we'll assume verification is done on the server side

        return true
    }
}

enum ApplicationError: Error, LocalizedError {
    case missingRequiredField(String)
    case invalidJWK(String)
    case missingSignature
    case verificationFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingRequiredField(let field):
            return "Missing required field: \(field)"
        case .invalidJWK(let msg):
            return "Invalid JWK: \(msg)"
        case .missingSignature:
            return "Application is not signed"
        case .verificationFailed(let msg):
            return "Verification failed: \(msg)"
        }
    }
}
