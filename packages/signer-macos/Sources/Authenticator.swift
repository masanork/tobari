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
        
        // Use runtime reflection to construct PRF input and set it on the request.
        // This avoids compilation errors with "refined" Swift types that vary between SDKs.
        if let inputClass = NSClassFromString("ASAuthorizationPublicKeyCredentialPRFAssertionInput"),
           let valuesClass = NSClassFromString("ASAuthorizationPublicKeyCredentialPRFAssertionInputValues") {
            
            // Create ASAuthorizationPublicKeyCredentialPRFAssertionInputValues
            // - (instancetype)initWithSaltInput1:(NSData *)saltInput1 saltInput2:(nullable NSData *)saltInput2;
            let valuesAlloc = (valuesClass as AnyObject).perform(NSSelectorFromString("alloc"))?.takeRetainedValue() as? NSObject
            if let values = valuesAlloc {
                let selector = NSSelectorFromString("initWithSaltInput1:saltInput2:")
                typealias InitFunc = @convention(c) (NSObject, Selector, NSData, NSData?) -> NSObject
                if let method = values.method(for: selector) {
                    let initializer = unsafeBitCast(method, to: InitFunc.self)
                    let initializedValues = initializer(values, selector, salt as NSData, nil)
                    
                    // Create ASAuthorizationPublicKeyCredentialPRFAssertionInput
                    // - (instancetype)initWithInputValues:(nullable ASAuthorizationPublicKeyCredentialPRFAssertionInputValues *)inputValues perCredentialInputValues:(nullable NSDictionary<NSData *, ASAuthorizationPublicKeyCredentialPRFAssertionInputValues *> *)perCredentialInputValues;
                    let inputAlloc = (inputClass as AnyObject).perform(NSSelectorFromString("alloc"))?.takeRetainedValue() as? NSObject
                    if let input = inputAlloc {
                        let inputSelector = NSSelectorFromString("initWithInputValues:perCredentialInputValues:")
                        typealias InputInitFunc = @convention(c) (NSObject, Selector, NSObject?, NSDictionary?) -> NSObject
                        if let inputMethod = input.method(for: inputSelector) {
                            let inputInitializer = unsafeBitCast(inputMethod, to: InputInitFunc.self)
                            let initializedInput = inputInitializer(input, inputSelector, initializedValues, nil)
                            
                            // Set prf on the request
                            if assertionRequest.responds(to: NSSelectorFromString("setAssertionInput:")) {
                                assertionRequest.perform(NSSelectorFromString("setAssertionInput:"), with: initializedInput)
                            } else if assertionRequest.responds(to: NSSelectorFromString("setPrf:")) {
                                assertionRequest.perform(NSSelectorFromString("setPrf:"), with: initializedInput)
                            }
                        }
                    }
                }
            }
        }
        
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
            
            // Extract PRF Output using runtime reflection
            var prfOutput: String? = nil
            if #available(macOS 14.0, *) {
                // credential.assertionOutput -> ASAuthorizationPublicKeyCredentialPRFAssertionOutput
                let outputSelector = NSSelectorFromString("assertionOutput")
                if credential.responds(to: outputSelector) {
                    if let prfOutputObj = credential.perform(outputSelector)?.takeUnretainedValue() as? NSObject {
                        // prfOutputObj.results -> [Data]
                        let resultsSelector = NSSelectorFromString("results")
                        if prfOutputObj.responds(to: resultsSelector) {
                            if let results = prfOutputObj.perform(resultsSelector)?.takeUnretainedValue() as? [Data],
                               let first = results.first {
                                prfOutput = first.base64EncodedString()
                                    .replacingOccurrences(of: "+", with: "-")
                                    .replacingOccurrences(of: "/", with: "_")
                                    .replacingOccurrences(of: "=", with: "")
                            }
                        }
                    }
                }
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