use anyhow::{anyhow, bail, Result};
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{signature::Signer, Signature, SigningKey, VerifyingKey};
use rand_core::OsRng;
use rsa::pkcs1::DecodeRsaPublicKey;
use rsa::{Pkcs1v15Sign, RsaPublicKey};
use sha2::{Digest, Sha256};
use x509_parser::prelude::*;

pub mod bac;
pub mod envelope;
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
        self.signing_key
            .verifying_key()
            .to_encoded_point(false)
            .as_bytes()
            .to_vec()
    }
}

/// Verify a signature using a raw P-256 public key
pub fn verify_signature(
    pub_key_bytes: &[u8],
    message: &[u8],
    signature_bytes: &[u8],
) -> Result<()> {
    let verifying_key = VerifyingKey::from_sec1_bytes(pub_key_bytes)
        .map_err(|e| anyhow!("Invalid public key: {}", e))?;

    // Try parsing as fixed-width (P-256: 64 bytes)
    // If we wanted DER, we'd use Signature::from_der
    let signature = Signature::try_from(signature_bytes)
        .map_err(|_| anyhow!("Invalid signature format (expected fixed-width)"))?;

    verifying_key
        .verify(message, &signature)
        .map_err(|e| anyhow!("Signature verification failed: {}", e))
}

/// Verify a signature using an X.509 Certificate (DER encoded)
/// Supports RSA (PKCS#1 v1.5 with SHA-256) and ECC (P-256)
pub fn verify_x509_signature(
    cert_der: &[u8],
    message: &[u8],
    signature_bytes: &[u8],
) -> Result<()> {
    let (_, cert) = X509Certificate::from_der(cert_der)
        .map_err(|e| anyhow!("Failed to parse X.509 certificate: {}", e))?;

    let spki = cert.public_key();
    let oid = &spki.algorithm.algorithm;

    // Helper to check OID
    let check_oid = |oid: &x509_parser::der_parser::oid::Oid, expected: &[u64]| -> bool {
        oid.iter()
            .map(|iter| iter.eq(expected.iter().cloned()))
            .unwrap_or(false)
    };

    if check_oid(oid, &[1, 2, 840, 113549, 1, 1, 1]) {
        // RSA Encryption (1.2.840.113549.1.1.1)
        let pub_key = RsaPublicKey::from_pkcs1_der(&spki.subject_public_key.data)
            .map_err(|e| anyhow!("Failed to parse RSA public key: {}", e))?;

        let mut hasher = Sha256::new();
        hasher.update(message);
        let hashed = hasher.finalize();

        pub_key
            .verify(Pkcs1v15Sign::new::<Sha256>(), &hashed, signature_bytes)
            .map_err(|e| anyhow!("RSA Verification failed: {}", e))
    } else if check_oid(oid, &[1, 2, 840, 10045, 2, 1]) {
        // EC Public Key (1.2.840.10045.2.1)
        // Usually P-256 (1.2.840.10045.3.1.7) is in parameters
        let params = spki
            .algorithm
            .parameters
            .as_ref()
            .ok_or_else(|| anyhow!("Missing EC parameters"))?;

        // Check if curve is P-256 (prime256v1)
        // OID: 1.2.840.10045.3.1.7
        let p256_oid =
            x509_parser::der_parser::oid::Oid::from(&[1, 2, 840, 10045, 3, 1, 7]).unwrap();

        // Simple check on parameters (assuming it's just the OID)
        let params_oid = params
            .as_oid()
            .map_err(|_| anyhow!("Unsupported EC parameters (expected OID)"))?;

        if params_oid == p256_oid {
            let verifying_key = VerifyingKey::from_sec1_bytes(&spki.subject_public_key.data)
                .map_err(|e| anyhow!("Invalid P-256 public key: {}", e))?;

            // PIV signatures are often raw (r|s), but sometimes DER.
            // Usually PIV returns raw 64 bytes for P-256.
            // Try fixed first, then DER.
            if let Ok(sig) = Signature::try_from(signature_bytes) {
                return verifying_key
                    .verify(message, &sig)
                    .map_err(|e| anyhow!("ECC Verification failed (Fixed): {}", e));
            }

            let sig = Signature::from_der(signature_bytes)
                .map_err(|e| anyhow!("Invalid ECC signature format: {}", e))?;

            verifying_key
                .verify(message, &sig)
                .map_err(|e| anyhow!("ECC Verification failed (DER): {}", e))
        } else {
            bail!("Unsupported EC Curve: {}", params_oid);
        }
    } else {
        bail!("Unsupported Algorithm OID: {}", oid);
    }
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
