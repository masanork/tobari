import Foundation

class PresentationHandler: CommandHandler {
    func handle(request: UnifiedRequest) async -> UnifiedResponse {
        switch request.command {
        case "sign_presentation":
            return await handleSignPresentation(request)
        case "approve_preview":
            return await handleApprovePreview(request)
        case "inspect_document":
            return await handleInspectDocument(request)
        default:
            return UnifiedResponse.error(command: request.command, type: .unsupportedCommand, message: "Unsupported presentation command")
        }
    }

    private func handleSignPresentation(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(SignPresentationParams.self, from: request.params)
            let documentData: Data
            if let docPath = params.documentPath {
                documentData = try Data(contentsOf: URL(fileURLWithPath: docPath))
            } else if let docDataB64 = params.documentData {
                guard let data = Data(base64URLEncoded: docDataB64) else {
                    return UnifiedResponse.error(command: request.command, type: .invalidRequest, message: "Invalid document data")
                }
                documentData = data
            } else {
                return UnifiedResponse.error(command: request.command, type: .invalidRequest, message: "documentPath or documentData is required")
            }

            let mdoc = try CoseParser.parseMdoc(data: documentData)
            let disclosedFields = params.disclosureFields ?? mdoc.getAllFields()

            if request.preview == true {
                let previewFields = mdoc.getAllFields().map { field in
                    PreviewInfo.PreviewField(name: mdoc.getFieldDisplayName(field), value: disclosedFields.contains(field) ? mdoc.getFieldValue(field) : "***", disclosed: disclosedFields.contains(field))
                }
                let sessionId = UUID().uuidString
                PreviewSession.store(sessionId: sessionId, documentData: documentData, mdoc: mdoc, disclosedFields: disclosedFields, verifierId: params.verifierId, nonce: params.nonce, responseUri: params.responseUri)
                return UnifiedResponse.preview(command: request.command, summary: "Sign Verifiable Presentation for \(mdoc.docType)", fields: previewFields, sessionId: sessionId)
            }

            return UnifiedResponse.error(command: request.command, type: .internalError, message: "Execution not implemented. Use preview mode.")
        } catch {
            return handleSignerError(error, command: request.command)
        }
    }

    private func handleApprovePreview(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            guard let paramsDict = request.params.value as? [String: Any], let sessionId = paramsDict["sessionId"] as? String else {
                return UnifiedResponse.error(command: request.command, type: .invalidRequest, message: "sessionId is required")
            }
            guard let session = PreviewSession.retrieve(sessionId: sessionId) else {
                return UnifiedResponse.error(command: request.command, type: .invalidRequest, message: "Session not found")
            }

            let authenticated = await SecurityUtils.authenticateUser(reason: "Sign Verifiable Presentation")
            guard authenticated else {
                return UnifiedResponse.error(command: request.command, type: .userCancelled, message: "User cancelled")
            }

            let signer = SecureEnclaveSigner()
            let challenge = session.disclosedFields.joined(separator: ",").data(using: .utf8)!
            let (signature, publicKey) = try signer.sign(challenge: challenge)

            return UnifiedResponse.success(
                command: request.command,
                type: .vp,
                format: .cose,
                data: ["signature": signature, "publicKey": publicKey, "docType": session.mdoc.docType, "disclosedFields": session.disclosedFields, "nonce": session.nonce ?? ""]
            )
        } catch {
            return handleSignerError(error, command: request.command)
        }
    }

    private func handleInspectDocument(_ request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(InspectDocumentParams.self, from: request.params)
            let documentData: Data
            if let path = params.path {
                documentData = try Data(contentsOf: URL(fileURLWithPath: path))
            } else if let b64 = params.data {
                guard let data = Data(base64URLEncoded: b64) else {
                    return UnifiedResponse.error(command: request.command, type: .invalidRequest, message: "Invalid Base64URL data")
                }
                documentData = data
            } else {
                return UnifiedResponse.error(command: request.command, type: .invalidRequest, message: "path or data is required")
            }

            if let json = try? JSONSerialization.jsonObject(with: documentData) as? [String: Any], json["tobari_enc"] as? Bool == true {
                return UnifiedResponse.success(command: request.command, type: .cardData, format: .json, data: ["encrypted": true, "type": "tobari_ecies"])
            }

            let mdoc = try CoseParser.parseMdoc(data: documentData)
            var fields: [String: String] = [:]
            for field in mdoc.getAllFields() { fields[field] = mdoc.getFieldValue(field) }
            return UnifiedResponse.success(command: request.command, type: .cardData, format: .json, data: ["docType": mdoc.docType, "fields": fields])
        } catch {
            return handleSignerError(error, command: request.command)
        }
    }
}
