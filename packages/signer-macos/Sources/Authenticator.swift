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
                publicKey: credentialID.base64EncodedString()
            )
            continuation?.resume(returning: response)
            
        } else if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            guard let signature = credential.signature,
                  let authData = credential.rawAuthenticatorData else {
                continuation?.resume(throwing: SignerError.authenticator("Missing signature or authData"))
                return
            }
            
            let clientDataJSON = credential.rawClientDataJSON
            
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
                publicKey: nil
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