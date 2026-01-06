use p256::ecdsa::{SigningKey, Signature, VerifyingKey, signature::Signer};
use p256::ecdsa::signature::Verifier;
use rand_core::OsRng;
use anyhow::{Result, anyhow};

pub mod bac;
pub mod pace;
pub mod sm;

/// FIDO-like KeyPair wrapper (P-256)
pub struct FidoKeyPair {
    signing_key: SigningKey,
}

impl FidoKeyPair {
    /// Generate a new random key pair (Simulating FIDO registration)
    pub fn generate() -> Self {
        let signing_key = SigningKey::random(&mut OsRng);
        Self { signing_key }
    }

    /// Sign a message (Simulating FIDO assertion)
    pub fn sign(&self, message: &[u8]) -> Vec<u8> {
        let signature: Signature = self.signing_key.sign(message);
        signature.to_vec()
    }

    /// Get public key as bytes (SEC1 encoded)
    pub fn public_key_bytes(&self) -> Vec<u8> {
        self.signing_key.verifying_key().to_encoded_point(false).as_bytes().to_vec()
    }
}

/// Verify a signature
pub fn verify_signature(pub_key_bytes: &[u8], message: &[u8], signature_bytes: &[u8]) -> Result<()> {
    let verifying_key = VerifyingKey::from_sec1_bytes(pub_key_bytes)
        .map_err(|e| anyhow!("Invalid public key: {}", e))?;
    
    // Try parsing as fixed-width (P-256: 64 bytes)
    // If we wanted DER, we'd use Signature::from_der
    let signature = Signature::try_from(signature_bytes)
        .map_err(|_| anyhow!("Invalid signature format (expected fixed-width)"))?;

    verifying_key.verify(message, &signature)
        .map_err(|e| anyhow!("Signature verification failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sign_verify_roundtrip() {
        let keypair = FidoKeyPair::generate();
        let message = b"Hello Folio";
        let signature = keypair.sign(message);
        let pub_key = keypair.public_key_bytes();

        let res = verify_signature(&pub_key, message, &signature);
        assert!(res.is_ok());
    }

    #[test]
    fn test_verify_fail_bad_message() {
        let keypair = FidoKeyPair::generate();
        let message = b"Hello";
        let signature = keypair.sign(message);
        let pub_key = keypair.public_key_bytes();

        let res = verify_signature(&pub_key, b"World", &signature);
        assert!(res.is_err());
    }

    #[test]
    fn test_verify_fail_bad_signature() {
        let keypair = FidoKeyPair::generate();
        let message = b"Hello";
        let mut signature = keypair.sign(message);
        let pub_key = keypair.public_key_bytes();

        // Tamper signature
        if let Some(last) = signature.last_mut() {
            *last = last.wrapping_add(1);
        }

        let res = verify_signature(&pub_key, message, &signature);
        assert!(res.is_err());
    }
}
