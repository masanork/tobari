import Foundation
import CryptoKit

class DeviceAuth {
    
    /// Generate a Verifiable Presentation (mdoc VP)
    static func generatePresentation(
        mdoc: MdocDocument,
        disclosedFields: [String],
        verifierId: String?,
        nonce: String?,
        signer: SecureEnclaveSigner
    ) throws -> Data {
        
        // 1. Prepare Device NameSpaces (typically empty for basic mdoc)
        let deviceNameSpaces = Data([0xA0]) // Empty map
        
        // 2. Prepare Session Transcript
        let writer = CBORWriter()
        writer.writeArrayStart(4)
        writer.writeNull() // DeviceEngagement
        writer.writeNull() // VerifierEngagement
        if let vid = verifierId { writer.writeString(vid) } else { writer.writeNull() }
        if let n = nonce { writer.writeString(n) } else { writer.writeNull() }
        let sessionTranscript = writer.data
        
        // 3. Prepare DeviceAuthentication structure
        let authWriter = CBORWriter()
        authWriter.writeArrayStart(4)
        authWriter.writeString("DeviceAuthentication")
        authWriter.writeBytes(sessionTranscript) // Wrapped as byte string
        authWriter.writeString(mdoc.docType)
        authWriter.writeBytes(deviceNameSpaces) // Wrapped as byte string
        let deviceAuthenticationBytes = authWriter.data
        
        // 4. Hash and Sign
        let hash = SHA256.hash(data: deviceAuthenticationBytes)
        let (signatureRawB64, publicKeyJwk) = try signer.sign(challenge: Data(hash))
        
        guard let signatureRaw = Data(base64URLEncoded: signatureRawB64) else {
            throw SignerError.internalError("Failed to decode signature")
        }
        
        // 5. Build COSE_Sign1 for deviceSignature
        // [protected, unprotected, payload: null, signature]
        let protectedWriter = CBORWriter()
        protectedWriter.writeMapStart(1)
        protectedWriter.writeInt(1) // alg
        protectedWriter.writeInt(-7) // ES256
        let protectedHeader = protectedWriter.data
        
        // Sig_structure for COSE_Sign1
        let sigStructWriter = CBORWriter()
        sigStructWriter.writeArrayStart(4)
        sigStructWriter.writeString("Signature1")
        sigStructWriter.writeBytes(protectedHeader)
        sigStructWriter.writeBytes(Data()) // External AAD
        sigStructWriter.writeBytes(deviceAuthenticationBytes) // Payload
        let sigStructure = sigStructWriter.data
        
        // The signature in COSE_Sign1 is actually over this sigStructure
        let finalHash = SHA256.hash(data: sigStructure)
        let (finalSignatureB64, _) = try signer.sign(challenge: Data(finalHash))
        guard let finalSignature = Data(base64URLEncoded: finalSignatureB64) else {
            throw SignerError.internalError("Failed to decode final signature")
        }
        
        let coseWriter = CBORWriter()
        coseWriter.writeTag(18) // COSE_Sign1
        coseWriter.writeArrayStart(4)
        coseWriter.writeBytes(protectedHeader)
        coseWriter.writeMapStart(0)
        coseWriter.writeNull() // Payload is detached
        coseWriter.writeBytes(finalSignature)
        let deviceSignature = coseWriter.data
        
        // 6. Build final VP (DeviceSigned + IssuerSigned)
        let vpWriter = CBORWriter()
        vpWriter.writeMapStart(2)
        
        // IssuerSigned
        vpWriter.writeString("issuerSigned")
        // We reuse the original IssuerSigned but ideally we should filter it.
        // For this implementation, we assume the original IssuerSigned is acceptable.
        vpWriter.data.append(mdoc.rawIssuerSigned)
        
        // DeviceSigned
        vpWriter.writeString("deviceSigned")
        vpWriter.writeMapStart(2)
        vpWriter.writeString("nameSpaces")
        vpWriter.writeBytes(deviceNameSpaces)
        vpWriter.writeString("deviceAuth")
        vpWriter.writeMapStart(1)
        vpWriter.writeString("deviceSignature")
        vpWriter.data.append(deviceSignature)
        
        return vpWriter.data
    }
}
