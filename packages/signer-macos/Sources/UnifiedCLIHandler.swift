import Foundation

/// Handles unified request/response format for all signer operations
class UnifiedCLIHandler {
    private let isDebug = ProcessInfo.processInfo.environment["TOBARI_DEBUG"] == "1"

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
        case "sign_presentation":
            response = await handleSignPresentation(request)

        case "read_card":
            response = await handleReadCard(request)

        case "create_application":
            response = await handleCreateApplication(request)

        case "register_device":
            response = await handleRegisterDevice(request)

        case "sign_data":
            response = await handleSignData(request)

        case "decrypt_data":
            response = await handleDecryptData(request)

        case "get_public_key":
            response = await handleGetPublicKey(request)

        case "approve_preview":
            response = await handleApprovePreview(request)

        case "sign_with_jpki":
            response = await handleSignWithJpki(request)

        default:
            response = UnifiedResponse.error(
                command: request.command,
                type: .unsupportedCommand,
                message: "Command '\(request.command)' is not supported"
            )
        }

        printResponse(response)
    }

    // MARK: - Command Handlers

    private func handleSignPresentation(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(SignPresentationParams.self, from: request.params)

            // Load document data
            let documentData: Data
            if let docPath = params.documentPath {
                documentData = try Data(contentsOf: URL(fileURLWithPath: docPath))
            } else if let docDataB64 = params.documentData {
                guard let data = Data(base64URLEncoded: docDataB64) else {
                    return UnifiedResponse.error(
                        command: request.command,
                        type: .invalidRequest,
                        message: "Invalid Base64URL encoded document data"
                    )
                }
                documentData = data
            } else {
                return UnifiedResponse.error(
                    command: request.command,
                    type: .invalidRequest,
                    message: "Either documentPath or documentData is required"
                )
            }

            // Parse mdoc
            let mdoc = try CoseParser.parseMdoc(data: documentData)

            // Determine fields to disclose
            let disclosedFields = params.disclosureFields ?? mdoc.getAllFields()

            debugLog("Parsed mdoc: \(mdoc.docType)")
            debugLog("Disclosed fields: \(disclosedFields.joined(separator: ", "))")

            // Preview mode: return preview information
            if request.preview == true {
                var previewFields: [PreviewInfo.PreviewField] = []

                for field in mdoc.getAllFields() {
                    let displayName = mdoc.getFieldDisplayName(field)
                    let value = mdoc.getFieldValue(field)
                    let disclosed = disclosedFields.contains(field)

                    previewFields.append(PreviewInfo.PreviewField(
                        name: displayName,
                        value: disclosed ? value : "***",
                        disclosed: disclosed
                    ))
                }

                let summary = """
                You are about to sign a Verifiable Presentation for \(mdoc.docType).
                \(disclosedFields.count) of \(mdoc.getAllFields().count) fields will be disclosed.
                """

                let sessionId = UUID().uuidString

                // Store preview session for later approval
                PreviewSession.store(
                    sessionId: sessionId,
                    documentData: documentData,
                    mdoc: mdoc,
                    disclosedFields: disclosedFields,
                    verifierId: params.verifierId,
                    nonce: params.nonce,
                    responseUri: params.responseUri
                )

                return UnifiedResponse.preview(
                    command: request.command,
                    summary: summary,
                    fields: previewFields,
                    sessionId: sessionId
                )
            }

            // Execute mode: sign and create VP
            // TODO: Implement actual VP signing with Device Authentication
            return UnifiedResponse.error(
                command: request.command,
                type: .internalError,
                message: "VP signing execution not yet implemented. Use preview mode first."
            )

        } catch let error as CoseError {
            return UnifiedResponse.error(
                command: request.command,
                type: .invalidRequest,
                message: "Failed to parse mdoc: \(error.localizedDescription)"
            )
        } catch {
            return UnifiedResponse.error(
                command: request.command,
                type: .internalError,
                message: "Failed to process presentation: \(error.localizedDescription)"
            )
        }
    }

    private func handleReadCard(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(ReadCardParams.self, from: request.params)

            switch params.cardType {
            case .jpki:
                return await readJPKI(params: params, command: request.command)

            case .passport:
                return await readPassport(params: params, command: request.command)

            case .driversLicense:
                return await readDriversLicense(params: params, command: request.command)

            case .residenceCard:
                return await readResidenceCard(command: request.command)
            }

        } catch {
            return UnifiedResponse.error(
                command: request.command,
                type: .invalidRequest,
                message: "Invalid parameters: \(error.localizedDescription)"
            )
        }
    }

    private func handleCreateApplication(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(CreateApplicationParams.self, from: request.params)

            debugLog("Creating application for docType: \(params.requestedDocType)")

            // Validate JPKI PIN
            guard let jpkiPin = params.jpkiPin, !jpkiPin.isEmpty else {
                return UnifiedResponse.error(
                    command: request.command,
                    type: .invalidRequest,
                    message: "JPKI PIN is required"
                )
            }

            // Validate requested docType
            guard !params.requestedDocType.isEmpty else {
                return UnifiedResponse.error(
                    command: request.command,
                    type: .invalidRequest,
                    message: "requestedDocType is required"
                )
            }

            // Create application with holder binding
            let creator = ApplicationCreator(debugLog: debugLog)
            let application = try await creator.createApplication(
                requestedDocType: params.requestedDocType,
                requestedFields: params.requestedFields,
                jpkiPin: jpkiPin,
                jpkiSignatureType: "auth"
            )

            // Serialize to JSON
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let applicationJSON = try encoder.encode(application)

            // Save to output path if specified
            if let outputPath = params.outputPath {
                try applicationJSON.write(to: URL(fileURLWithPath: outputPath))
                debugLog("Application saved to: \(outputPath)")
            }

            // Convert to dictionary for response
            let applicationDict = try JSONSerialization.jsonObject(with: applicationJSON) as! [String: Any]

            return UnifiedResponse.success(
                command: request.command,
                type: .application,
                format: .json,
                data: applicationDict,
                metadata: [
                    "applicationId": application.applicationId,
                    "requestedDocType": application.requestedDocType,
                    "deviceBindingEnabled": true,
                    "outputPath": params.outputPath ?? ""
                ]
            )

        } catch let error as SignerError {
            return handleSignerError(error, command: request.command)
        } catch let error as ApplicationError {
            return UnifiedResponse.error(
                command: request.command,
                type: .invalidRequest,
                message: error.localizedDescription
            )
        } catch {
            return UnifiedResponse.error(
                command: request.command,
                type: .internalError,
                message: "Failed to create application: \(error.localizedDescription)"
            )
        }
    }

    private func handleRegisterDevice(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try? decodeParams(RegisterDeviceParams.self, from: request.params)
            let keyType = params?.keyType ?? "secure_enclave"

            debugLog("Registering device with key type: \(keyType)")

            // Get signing key
            let signer = SecureEnclaveSigner()
            let signingPublicKeyJWK = try signer.getPublicKey()

            // Get encryption key
            let encryption = SecureEnclaveEncryption()
            let encryptionPublicKeyJWK = try encryption.getPublicKey()

            let result: [String: Any] = [
                "signingPublicKey": signingPublicKeyJWK,
                "encryptionPublicKey": encryptionPublicKeyJWK,
                "keyType": keyType
            ]

            return UnifiedResponse.success(
                command: request.command,
                type: .key,
                format: .json,
                data: result,
                metadata: [
                    "platform": "macos"
                ]
            )

        } catch {
            return UnifiedResponse.error(
                command: request.command,
                type: .internalError,
                message: "Failed to register device: \(error.localizedDescription)"
            )
        }
    }

    private func handleSignData(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(SignDataParams.self, from: request.params)

            guard let challengeData = Data(base64URLEncoded: params.data) else {
                return UnifiedResponse.error(
                    command: request.command,
                    type: .invalidRequest,
                    message: "Invalid Base64URL encoded data"
                )
            }

            // Request user authentication
            let authenticated = await SecurityUtils.authenticateUser(
                reason: "Sign data with device key"
            )
            guard authenticated else {
                return UnifiedResponse.error(
                    command: request.command,
                    type: .userCancelled,
                    message: "User cancelled authentication"
                )
            }

            let signer = SecureEnclaveSigner()
            let (signature, publicKey) = try signer.sign(challenge: challengeData)

            let result: [String: String] = [
                "signature": signature,
                "publicKey": publicKey
            ]

            return UnifiedResponse.success(
                command: request.command,
                type: .signature,
                format: .json,
                data: result,
                metadata: [
                    "algorithm": params.algorithm ?? "ES256"
                ]
            )

        } catch {
            return UnifiedResponse.error(
                command: request.command,
                type: .internalError,
                message: "Failed to sign data: \(error.localizedDescription)"
            )
        }
    }

    private func handleDecryptData(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(DecryptDataParams.self, from: request.params)

            // The encryptedData should be a JSON string containing ephemeralPublicKey, ciphertext, iv, tag
            let encryption = SecureEnclaveEncryption()
            let decryptedData = try encryption.decrypt(jsonString: params.encryptedData)
            let decryptedBase64URL = decryptedData.base64URLEncodedString()

            return UnifiedResponse.success(
                command: request.command,
                type: .encrypted,
                format: .base64,
                data: decryptedBase64URL
            )

        } catch {
            return UnifiedResponse.error(
                command: request.command,
                type: .internalError,
                message: "Failed to decrypt data: \(error.localizedDescription)"
            )
        }
    }

    private func handleGetPublicKey(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let signer = SecureEnclaveSigner()
            let publicKeyJWK = try signer.getPublicKey()

            return UnifiedResponse.success(
                command: request.command,
                type: .key,
                format: .json,
                data: publicKeyJWK
            )

        } catch {
            return UnifiedResponse.error(
                command: request.command,
                type: .internalError,
                message: "Failed to get public key: \(error.localizedDescription)"
            )
        }
    }

    private func handleApprovePreview(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            // Extract sessionId from params
            guard let sessionId = (request.params.value as? [String: Any])?["sessionId"] as? String else {
                return UnifiedResponse.error(
                    command: request.command,
                    type: .invalidRequest,
                    message: "sessionId is required"
                )
            }

            // Retrieve preview session
            guard let session = PreviewSession.retrieve(sessionId: sessionId) else {
                return UnifiedResponse.error(
                    command: request.command,
                    type: .invalidRequest,
                    message: "Preview session not found or expired"
                )
            }

            debugLog("Approving preview session: \(sessionId)")
            debugLog("Disclosed fields: \(session.disclosedFields.joined(separator: ", "))")

            // Request user authentication
            let authenticated = await SecurityUtils.authenticateUser(
                reason: "Sign Verifiable Presentation"
            )

            guard authenticated else {
                return UnifiedResponse.error(
                    command: request.command,
                    type: .userCancelled,
                    message: "User cancelled authentication"
                )
            }

            // Create Device Authentication signature
            // For now, we'll create a simple signature over the disclosed fields
            let disclosedFieldsData = session.disclosedFields.joined(separator: ",").data(using: .utf8)!
            let signer = SecureEnclaveSigner()
            let (signature, publicKey) = try signer.sign(challenge: disclosedFieldsData)

            // TODO: Create proper VP with DeviceAuth structure
            // For now, return signature and metadata
            let result: [String: Any] = [
                "signature": signature,
                "publicKey": publicKey,
                "docType": session.mdoc.docType,
                "disclosedFields": session.disclosedFields,
                "verifierId": session.verifierId ?? "",
                "nonce": session.nonce ?? "",
                "format": "cose"
            ]

            return UnifiedResponse.success(
                command: request.command,
                type: .vp,
                format: .cose,
                data: result,
                metadata: [
                    "sessionId": sessionId,
                    "signedAt": ISO8601DateFormatter().string(from: Date())
                ]
            )

        } catch {
            return UnifiedResponse.error(
                command: request.command,
                type: .internalError,
                message: "Failed to approve preview: \(error.localizedDescription)"
            )
        }
    }

    private func handleSignWithJpki(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(SignWithJpkiParams.self, from: request.params)

            guard let dataToSign = Data(base64URLEncoded: params.data) else {
                return UnifiedResponse.error(
                    command: request.command,
                    type: .invalidRequest,
                    message: "Invalid Base64URL encoded data"
                )
            }

            let signatureType = params.signatureType ?? "auth"
            debugLog("Signing with JPKI (\(signatureType) type)...")

            let manager = SmartCardManager()
            let jpki = JPKIController(manager: manager)

            let signature = try await jpki.computeSignature(
                pin: params.pin,
                data: dataToSign,
                type: signatureType
            )

            let signatureBase64URL = signature.base64URLEncodedString()

            // Get certificate
            let info = try await jpki.readAttributes(pin: params.pin)
            let certificate = signatureType == "auth" ? info.authCert : info.signCert

            let result: [String: String] = [
                "signature": signatureBase64URL,
                "certificate": certificate ?? "",
                "algorithm": "RS256"
            ]

            return UnifiedResponse.success(
                command: request.command,
                type: .signature,
                format: .json,
                data: result,
                metadata: [
                    "signatureType": signatureType,
                    "keyType": "jpki"
                ]
            )

        } catch let error as SignerError {
            return handleSignerError(error, command: request.command)
        } catch {
            return UnifiedResponse.error(
                command: request.command,
                type: .internalError,
                message: "Failed to sign with JPKI: \(error.localizedDescription)"
            )
        }
    }

    // MARK: - Card Reading Helpers

    private func readJPKI(params: ReadCardParams, command: String) async -> UnifiedResponse {
        guard let pin = params.pin else {
            return UnifiedResponse.error(
                command: command,
                type: .invalidRequest,
                message: "PIN is required for JPKI card reading"
            )
        }

        do {
            let manager = SmartCardManager()
            let jpki = JPKIController(manager: manager)

            let info = try await jpki.readAttributes(pin: pin)

            var result: [String: Any] = [
                "name": info.name,
                "address": info.address,
                "birthDate": info.birthDate,
                "gender": info.gender
            ]

            // Include certificates if requested
            if params.includeCertificates == true || params.includeCertificates == nil {
                result["authCert"] = info.authCert ?? ""
                result["signCert"] = info.signCert ?? ""
            }

            // Include My Number if requested
            if params.includeMyNumber == true {
                debugLog("Reading My Number...")
                let myNumber = try await jpki.readMyNumber(pin: pin)
                result["myNumber"] = myNumber
            }

            // Include face photo if requested
            if params.includeFacePhoto == true {
                debugLog("Reading face photo...")
                // First get My Number if not already retrieved
                let myNumber: String
                if let mn = result["myNumber"] as? String {
                    myNumber = mn
                } else {
                    myNumber = try await jpki.readMyNumber(pin: pin)
                }
                let photoData = try await jpki.readFacePhoto(myNumber: myNumber)
                result["facePhoto"] = photoData.base64EncodedString()
            }

            return UnifiedResponse.success(
                command: command,
                type: .cardData,
                format: .json,
                data: result,
                metadata: [
                    "cardType": "jpki",
                    "includedFields": [
                        "basicInfo": true,
                        "myNumber": params.includeMyNumber == true,
                        "facePhoto": params.includeFacePhoto == true,
                        "certificates": params.includeCertificates != false
                    ]
                ]
            )

        } catch let error as SignerError {
            return handleSignerError(error, command: command)
        } catch {
            return UnifiedResponse.error(
                command: command,
                type: .internalError,
                message: "Failed to read JPKI card: \(error.localizedDescription)"
            )
        }
    }

    private func readPassport(params: ReadCardParams, command: String) async -> UnifiedResponse {
        do {
            let manager = SmartCardManager()
            let controller = PassportController(manager: manager)

            try await controller.selectPassportAP()

            if let can = params.can {
                debugLog("Using PACE with CAN")
                try await controller.performPACE(password: can, isCan: true)
            } else if let mrz = params.mrz {
                if params.usePace == true {
                    debugLog("Using PACE with MRZ")
                    try await controller.performPACE(password: mrz, isCan: false)
                } else {
                    debugLog("Using BAC with MRZ")
                    try await controller.performBAC(mrz: mrz)
                }
            } else {
                return UnifiedResponse.error(
                    command: command,
                    type: .invalidRequest,
                    message: "MRZ or CAN is required for passport reading"
                )
            }

            let info = try await controller.readFullPassportInfo()

            // Convert PassportInfo to dictionary
            let encoder = JSONEncoder()
            let data = try encoder.encode(info)
            let dictionary = try JSONSerialization.jsonObject(with: data) as! [String: Any]

            return UnifiedResponse.success(
                command: command,
                type: .cardData,
                format: .json,
                data: dictionary,
                metadata: [
                    "cardType": "passport",
                    "protocolUsed": info.protocolUsed
                ]
            )

        } catch let error as SignerError {
            return handleSignerError(error, command: command)
        } catch {
            return UnifiedResponse.error(
                command: command,
                type: .internalError,
                message: "Failed to read passport: \(error.localizedDescription)"
            )
        }
    }

    private func readDriversLicense(params: ReadCardParams, command: String) async -> UnifiedResponse {
        guard let pin1 = params.pin1 else {
            return UnifiedResponse.error(
                command: command,
                type: .invalidRequest,
                message: "PIN1 is required for driver's license reading"
            )
        }

        do {
            let manager = SmartCardManager()
            let controller = DriversLicenseController(manager: manager)

            let info = try await controller.readData(pin1: pin1, pin2: params.pin2)

            // Convert LicenseInfo to dictionary
            let encoder = JSONEncoder()
            let data = try encoder.encode(info)
            let dictionary = try JSONSerialization.jsonObject(with: data) as! [String: Any]

            return UnifiedResponse.success(
                command: command,
                type: .cardData,
                format: .json,
                data: dictionary,
                metadata: [
                    "cardType": "drivers_license"
                ]
            )

        } catch let error as SignerError {
            return handleSignerError(error, command: command)
        } catch {
            return UnifiedResponse.error(
                command: command,
                type: .internalError,
                message: "Failed to read driver's license: \(error.localizedDescription)"
            )
        }
    }

    private func readResidenceCard(command: String) async -> UnifiedResponse {
        do {
            let manager = SmartCardManager()
            let controller = ResidenceCardController(manager: manager)

            let info = try await controller.readDF2Info()

            // Convert to dictionary
            let encoder = JSONEncoder()
            let data = try encoder.encode(info)
            let dictionary = try JSONSerialization.jsonObject(with: data) as! [String: Any]

            return UnifiedResponse.success(
                command: command,
                type: .cardData,
                format: .json,
                data: dictionary,
                metadata: [
                    "cardType": "residence_card"
                ]
            )

        } catch let error as SignerError {
            return handleSignerError(error, command: command)
        } catch {
            return UnifiedResponse.error(
                command: command,
                type: .internalError,
                message: "Failed to read residence card: \(error.localizedDescription)"
            )
        }
    }

    // MARK: - Error Handling

    private func handleSignerError(_ error: SignerError, command: String) -> UnifiedResponse {
        switch error {
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
                message: error.localizedDescription
            )
        }
    }

    // MARK: - Utilities

    private func decodeParams<T: Codable>(_ type: T.Type, from params: AnyCodable) throws -> T {
        let data = try JSONSerialization.data(withJSONObject: params.value)
        return try JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: - Data Extension for Base64URL

extension Data {
    init?(base64URLEncoded string: String) {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 {
            base64.append("=")
        }
        self.init(base64Encoded: base64)
    }

    func base64URLEncodedString() -> String {
        return self.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
