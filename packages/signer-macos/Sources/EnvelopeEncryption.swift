import Foundation
import CryptoKit

class EnvelopeEncryption {
    
    // MARK: - Decryption Entry Point
    
    /// Decrypts an Envelope v2.0 structure.
    /// - Parameters:
    ///   - envelope: The envelope to decrypt.
    ///   - prfOutput: (Optional) The raw PRF output from WebAuthn assertion (32 bytes).
    ///   - prfKid: (Optional) The credential ID associated with the PRF output.
    /// - Returns: The decrypted payload (plaintext).
    func decrypt(envelope: Envelope, prfOutput: Data? = nil, prfKid: String? = nil) throws -> Data {
        // 1. Try PRF recipient if data is provided
        if let prfOutput = prfOutput, let prfKid = prfKid {
            if let recipient = envelope.recipients.compactMap({ r -> WebAuthnPrfRecipient? in
                if case .webAuthnPrf(let val) = r { return val }
                return nil
            }).first(where: { $0.kid == prfKid }) {
                
                return try decryptWithPrf(envelope: envelope, recipient: recipient, prfOutput: prfOutput)
            }
        }
        
        // 2. Try Native HPKE (Device Key)
        // TODO: Implement native key lookup and HPKE decryption
        // let secureEnclave = SecureEnclaveEncryption()
        // ...
        
        throw NSError(domain: "EnvelopeEncryption", code: 1, userInfo: [NSLocalizedDescriptionKey: "No suitable recipient found or key missing"])
    }
    
    // MARK: - PRF Decryption Logic
    
    private func decryptWithPrf(envelope: Envelope, recipient: WebAuthnPrfRecipient, prfOutput: Data) throws -> Data {
        // 1. Derive KEK (Key Encryption Key) from PRF Output
        // KEK = HKDF(ikm=prfOutput, info="tobari-prf-kek-v1")
        let kek = deriveKekFromPrf(prfOutput: prfOutput)
        
        // 2. Unwrap DEK (Document Encryption Key)
        // DEK = AES-GCM-Decrypt(key=KEK, ciphertext=encryptedKey)
        guard let encryptedKey = Data(base64URLEncoded: recipient.encryptedKey),
              let iv = Data(base64URLEncoded: recipient.iv),
              let tag = Data(base64URLEncoded: recipient.tag) else {
            throw NSError(domain: "EnvelopeEncryption", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid Base64URL in recipient"])
        }
        
        let dekData = try aesGcmDecrypt(key: kek, ciphertext: encryptedKey, iv: iv, tag: tag)
        let dek = SymmetricKey(data: dekData)
        
        // 3. Decrypt Payload
        guard let payloadCiphertext = Data(base64URLEncoded: envelope.ciphertext),
              let payloadIv = Data(base64URLEncoded: envelope.iv),
              let payloadTag = Data(base64URLEncoded: envelope.tag) else {
            throw NSError(domain: "EnvelopeEncryption", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid Base64URL in envelope"])
        }
        
        return try aesGcmDecrypt(key: dek, ciphertext: payloadCiphertext, iv: payloadIv, tag: payloadTag)
    }
    
    private func deriveKekFromPrf(prfOutput: Data) -> SymmetricKey {
        let info = "tobari-prf-kek-v1".data(using: .utf8)!
        // Salt is optional for HKDF expand if we only do expansion, 
        // but standard HKDF takes salt for extract. 
        // Our spec says: KEK = HKDF(ikm=prfOutput, info="tobari-prf-kek-v1")
        // Implementation in Rust used: Hkdf::<Sha256>::new(None, prf_output).expand(...)
        
        // CryptoKit's HKDF helper:
        let inputKey = SymmetricKey(data: prfOutput)
        return HKDF<SHA256>.deriveKey(
            inputKeyMaterial: inputKey,
            salt: Data(), // Empty salt matches Rust's None (mostly)
            info: info,
            outputByteCount: 32
        )
    }
    
    private func aesGcmDecrypt(key: SymmetricKey, ciphertext: Data, iv: Data, tag: Data) throws -> Data {
        let sealedBox = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ciphertext, tag: tag)
        return try AES.GCM.open(sealedBox, using: key)
    }
}
