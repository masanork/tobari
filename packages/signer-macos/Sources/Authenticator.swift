import Foundation
import AuthenticationServices
import AppKit

@available(macOS 12.0, *)
class Authenticator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<SignResponse, Error>?

    func register(rpID: String, challenge: Data, userName: String = "tobari-user") async throws -> SignResponse {
        let platformProvider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        
        let registrationRequest = platformProvider.createCredentialRegistrationRequest(challenge: challenge, name: userName, userID: Data(userName.utf8))
        
        let authController = ASAuthorizationController(authorizationRequests: [registrationRequest])
        authController.delegate = self
        authController.presentationContextProvider = self
        
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            authController.performRequests()
        }
    }

    func sign(rpID: String, challenge: Data) async throws -> SignResponse {
        let platformProvider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        
        let assertionRequest = platformProvider.createCredentialAssertionRequest(challenge: challenge)
        
        let authController = ASAuthorizationController(authorizationRequests: [assertionRequest])
        authController.delegate = self
        authController.presentationContextProvider = self
        
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            authController.performRequests()
        }
    }
    
    func signWithPrf(rpID: String, challenge: Data, salt: Data, credentialID: Data? = nil) async throws -> SignResponse {
        guard #available(macOS 14.0, *) else {
            throw SignerError.authenticator("PRF requires macOS 14.0+")
        }
        
        let platformProvider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let assertionRequest = platformProvider.createCredentialAssertionRequest(challenge: challenge)
        
        // Attach PRF Input
        // Note: We use dynamic check or try/catch if the init fails at compile time in some envs
        // But here we assume it compiles. If not, we commented out for now to pass 'make dev' check 
        // until we are in a proper Xcode env.
        /* 
        let prfInput = ASAuthorizationPublicKeyCredentialPRFAssertionInput(
            inputValues: [salt], 
            inputIDs: credentialID != nil ? [credentialID!] : []
        )
        if let prfRequest = assertionRequest as? ASAuthorizationPublicKeyCredentialPRFAssertionInputProviding {
            prfRequest.assertionInput = prfInput
        }
        */
        // TEMPORARY: Throw error until we can confirm init signature
        throw SignerError.authenticator("PRF not fully supported in this build environment")
        
        /*
        let authController = ASAuthorizationController(authorizationRequests: [assertionRequest])
        authController.delegate = self
        authController.presentationContextProvider = self
        
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            authController.performRequests()
        }
        */
    }

    // MARK: - ASAuthorizationControllerDelegate

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
            let attestation = credential.rawAttestationObject
            let clientDataJSON = credential.rawClientDataJSON
            let credentialID = credential.credentialID
            
            let response = SignResponse(
                signature: "",
                authData: attestation?.base64EncodedString()
                    .replacingOccurrences(of: "+", with: "-")
                    .replacingOccurrences(of: "/", with: "_")
                    .replacingOccurrences(of: "=", with: ""),
                clientDataJSON: String(data: clientDataJSON, encoding: .utf8),
                publicKey: credentialID.base64EncodedString(),
                prf: nil
            )
            continuation?.resume(returning: response)
            
        } else if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            guard let signature = credential.signature,
                  let authData = credential.rawAuthenticatorData else {
                continuation?.resume(throwing: SignerError.authenticator("Missing signature or authData"))
                return
            }
            
            let clientDataJSON = credential.rawClientDataJSON
            
            // Extract PRF Output
            var prfOutput: String? = nil
            if #available(macOS 14.0, *) {
                // Use runtime check to avoid compile error if protocol missing
                // if let prfCredential = credential as? ASAuthorizationPublicKeyCredentialPRFAssertionOutputProviding,
                //    let prfResult = prfCredential.assertionOutput as? ASAuthorizationPublicKeyCredentialPRFAssertionOutput,
                //    let first = prfResult.results.first {
                //     prfOutput = first.base64EncodedString()
                //         .replacingOccurrences(of: "+", with: "-")
                //         .replacingOccurrences(of: "/", with: "_")
                //         .replacingOccurrences(of: "=", with: "")
                // }
            }
            
            let response = SignResponse(
                signature: signature.base64EncodedString()
                    .replacingOccurrences(of: "+", with: "-")
                    .replacingOccurrences(of: "/", with: "_")
                    .replacingOccurrences(of: "=", with: ""),
                authData: authData.base64EncodedString()
                    .replacingOccurrences(of: "+", with: "-")
                    .replacingOccurrences(of: "/", with: "_")
                    .replacingOccurrences(of: "=", with: ""),
                clientDataJSON: String(data: clientDataJSON, encoding: .utf8),
                publicKey: nil,
                prf: prfOutput
            )
            continuation?.resume(returning: response)
        } else {
            continuation?.resume(throwing: SignerError.authenticator("Unsupported credential type"))
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(throwing: SignerError.authenticator(error.localizedDescription))
    }

    // MARK: - ASAuthorizationControllerPresentationContextProviding

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // Create a hidden window for the Passkey prompt
        let window = NSWindow(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
        return window
    }
}