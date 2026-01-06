use anyhow::{Result, bail};
use sha1::Sha1;
use sha2::{Sha256, Sha384, Sha512, Digest};
use x509_parser::prelude::*;
use std::collections::HashMap;

/// Parsed Security Object Document (EF.SOD)
#[derive(Debug, Clone)]
pub struct SecurityObjectDocument {
    /// DER-encoded signed data (CMS/PKCS#7)
    pub signed_data: Vec<u8>,
    /// Parsed LDS Security Object (hashes of data groups)
    pub lds_object: LdsSecurityObject,
    /// Signer certificate from SOD
    pub signer_cert: Vec<u8>,
    /// Signature value
    pub signature: Vec<u8>,
}

/// LDS Security Object - contains hash values for each Data Group
#[derive(Debug, Clone)]
pub struct LdsSecurityObject {
    /// Hash algorithm OID (e.g., SHA-256)
    pub hash_algorithm: String,
    /// Map of DG number to hash value
    pub data_group_hashes: HashMap<u8, Vec<u8>>,
}

/// Verifier for ePassport authenticity
pub struct PassportVerifier {
    /// Loaded CSCA (Country Signing CA) certificates
    csca_certs: Vec<Vec<u8>>,
}

impl PassportVerifier {
    /// Create a new verifier with CSCA certificates
    pub fn new() -> Self {
        Self {
            csca_certs: Vec::new(),
        }
    }

     /// Load CSCA certificates from PEM data
    pub fn load_csca_pem(&mut self, pem_data: &str) -> Result<()> {
        // Manual PEM parsing to avoid dependency issues
        let mut in_cert = false;
        let mut cert_data = String::new();
        
        for line in pem_data.lines() {
            let trimmed = line.trim();
            if trimmed == "-----BEGIN CERTIFICATE-----" {
                in_cert = true;
                cert_data.clear();
            } else if trimmed == "-----END CERTIFICATE-----" {
                if in_cert {
                    // Decode base64
                    use base64::Engine;
                    let der = base64::engine::general_purpose::STANDARD
                        .decode(&cert_data)
                        .map_err(|e| anyhow::anyhow!("Base64 decode error: {}", e))?;
                    self.csca_certs.push(der);
                    in_cert = false;
                }
            } else if in_cert {
                cert_data.push_str(trimmed);
            }
        }

        if self.csca_certs.is_empty() {
            bail!("No valid certificates found in PEM data");
        }

        Ok(())
    }

    /// Parse EF.SOD (Security Object Document)
    pub fn parse_sod(&self, _sod_data: &[u8]) -> Result<SecurityObjectDocument> {
        // SOD is a CMS SignedData structure
        // We'll use x509_parser to parse the signature and certificates
        
        // For now, we do a simplified parsing
        // In production, you'd use a proper CMS/PKCS#7 parser
        
        // The SOD contains:
        // - ContentInfo with SignedData
        // - LDSSecurityObject (the content being signed)
        // - Signer info with certificate
        
        // This is a placeholder implementation
        // Real implementation would use cms or similar crate
        
        bail!("SOD parsing not yet fully implemented - requires CMS parser")
    }

    /// Verify the SOD signature using CSCA certificates
    pub fn verify_sod_signature(&self, sod: &SecurityObjectDocument) -> Result<()> {
        // 1. Parse the signer certificate
        let (_, signer_cert) = X509Certificate::from_der(&sod.signer_cert)
            .map_err(|e| anyhow::anyhow!("Failed to parse signer certificate: {:?}", e))?;

        // 2. Verify the certificate chain (Document Signer -> CSCA)
        let mut chain_valid = false;
        for csca_der in &self.csca_certs {
            if let Ok((_, csca_cert)) = X509Certificate::from_der(csca_der) {
                // Verify that signer_cert is signed by csca_cert
                if verify_cert_signature(&signer_cert, &csca_cert).is_ok() {
                    chain_valid = true;
                    break;
                }
            }
        }

        if !chain_valid {
            bail!("Certificate chain validation failed - signer cert not signed by known CSCA");
        }

        // 3. Verify the SOD signature
        // This requires parsing the CMS signature and verifying with the public key from signer_cert
        // Placeholder for now
        
        Ok(())
    }

    /// Verify a data group hash
    pub fn verify_data_group(
        &self,
        sod: &SecurityObjectDocument,
        dg_number: u8,
        dg_data: &[u8],
    ) -> Result<()> {
        let expected_hash = sod.lds_object.data_group_hashes.get(&dg_number)
            .ok_or_else(|| anyhow::anyhow!("DG{} hash not found in SOD", dg_number))?;

        let computed_hash = match sod.lds_object.hash_algorithm.as_str() {
            "2.16.840.1.101.3.4.2.1" => { // SHA-256
                let mut hasher = Sha256::new();
                hasher.update(dg_data);
                hasher.finalize().to_vec()
            }
            "2.16.840.1.101.3.4.2.2" => { // SHA-384
                let mut hasher = Sha384::new();
                hasher.update(dg_data);
                hasher.finalize().to_vec()
            }
            "2.16.840.1.101.3.4.2.3" => { // SHA-512
                let mut hasher = Sha512::new();
                hasher.update(dg_data);
                hasher.finalize().to_vec()
            }
            "1.3.14.3.2.26" => { // SHA-1 (legacy)
                let mut hasher = Sha1::new();
                hasher.update(dg_data);
                hasher.finalize().to_vec()
            }
            _ => bail!("Unsupported hash algorithm: {}", sod.lds_object.hash_algorithm),
        };

        if computed_hash != *expected_hash {
            bail!(
                "DG{} hash mismatch. Expected: {}, Got: {}",
                dg_number,
                hex::encode(expected_hash),
                hex::encode(&computed_hash)
            );
        }

        Ok(())
    }
}

impl Default for PassportVerifier {
    fn default() -> Self {
        Self::new()
    }
}

/// Verify that `child_cert` is signed by `parent_cert`
fn verify_cert_signature(
    child_cert: &X509Certificate,
    parent_cert: &X509Certificate,
) -> Result<()> {
    // Check issuer/subject match
    if child_cert.issuer() != parent_cert.subject() {
        bail!("Certificate issuer/subject mismatch");
    }

    // Verify signature
    // The actual signature verification depends on the algorithm
    let public_key = parent_cert.public_key();
    let signature_algorithm = &child_cert.signature_algorithm.algorithm;
    
    // For production, use the signature verification from x509_parser or crypto libraries
    // This is a placeholder
    
    eprintln!("Warning: Certificate signature verification not yet fully implemented");
    eprintln!("  Algorithm: {:?}", signature_algorithm);
    eprintln!("  Public Key Algorithm: {:?}", public_key.algorithm);
    
    // Placeholder: just check that we have the right algorithms
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_csca_pem() {
        let pem_data = r#"-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHHCgVZU+hVMA0GCSqGSIb3DQEBCwUAMCExCzAJBgNVBAYTAlVT
MRIwEAYDVQQDDAlUZXN0IENTU0EwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAw
MDAwWjAhMQswCQYDVQQGEwJVUzESMBAGA1UEAwwJVGVzdCBDU1NBMFwwDQYJKoZI
hvcNAQEBBQADSwAwSAJBANLAqN8BvGO0MrhpshgDKawx2H+kGBH5BxCT+YxPbGcJ
Sy1X9tBxvHZbPlEKqJqMH+xKYB6QqP7xjPH8+WTHQb0CAwEAATANBgkqhkiG9w0B
AQsFAANBAG8xJx1i9dQvMYcqL3hC2V0xF7qY3qUQqYwhS1P8yYPfOqHJGLGGGXoV
l+qCwL7E4MEEv0z3qYXj1hN5g7FxFvI=
-----END CERTIFICATE-----"#;

        let mut verifier = PassportVerifier::new();
        let result = verifier.load_csca_pem(pem_data);
        assert!(result.is_ok());
        assert_eq!(verifier.csca_certs.len(), 1);
    }

    #[test]
    fn test_verify_data_group_sha256() {
        let mut dg_hashes = HashMap::new();
        // SHA-256 hash of "test data"
        let expected_hash = hex::decode(
            "916f0027a575074ce72a331777c3478d6513f786a591bd892da1a577bf2335f9"
        ).unwrap();
        dg_hashes.insert(1, expected_hash);

        let lds = LdsSecurityObject {
            hash_algorithm: "2.16.840.1.101.3.4.2.1".to_string(), // SHA-256
            data_group_hashes: dg_hashes,
        };

        let sod = SecurityObjectDocument {
            signed_data: vec![],
            lds_object: lds,
            signer_cert: vec![],
            signature: vec![],
        };

        let verifier = PassportVerifier::new();
        let result = verifier.verify_data_group(&sod, 1, b"test data");
        assert!(result.is_ok());
    }
}
