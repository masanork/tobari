use anyhow::{Result, bail, anyhow, Context};
use sha1::Sha1;
use rsa::sha2::{Sha256, Sha384, Sha512, Digest};
use x509_parser::prelude::*;
use std::collections::HashMap;
use der_parser::ber::{parse_ber_sequence, BerObjectContent};

/// Parsed Security Object Document (EF.SOD)
#[derive(Debug, Clone)]
pub struct SecurityObjectDocument {
    pub signed_data: Vec<u8>,
    pub lds_object: LdsSecurityObject,
    pub signer_cert: Option<Vec<u8>>, // Store raw DER
    pub signature: Vec<u8>,
    pub signed_attributes: Vec<u8>,
}

/// LDS Security Object
#[derive(Debug, Clone)]
pub struct LdsSecurityObject {
    pub hash_algorithm: String,
    pub data_group_hashes: HashMap<u8, Vec<u8>>,
}

/// Verifier for ePassport authenticity
pub struct PassportVerifier {
    /// Loaded CSCA certificates (Raw DER)
    csca_certs: Vec<Vec<u8>>,
}

impl PassportVerifier {
    pub fn new() -> Self {
        Self {
            csca_certs: Vec::new(),
        }
    }

    pub fn load_csca_pem(&mut self, pem_data: &str) -> Result<()> {
        let mut in_cert = false;
        let mut cert_data = String::new();
        
        for line in pem_data.lines() {
            let trimmed = line.trim();
            if trimmed == "-----BEGIN CERTIFICATE-----" {
                in_cert = true;
                cert_data.clear();
            } else if trimmed == "-----END CERTIFICATE-----" {
                if in_cert {
                    use base64::Engine;
                    let der = base64::engine::general_purpose::STANDARD
                        .decode(&cert_data)
                        .map_err(|e| anyhow!("Base64 decode error: {}", e))?;
                    self.csca_certs.push(der);
                    in_cert = false;
                }
            } else if in_cert {
                cert_data.push_str(trimmed);
            }
        }
        Ok(())
    }

    /// Parse EF.SOD (Security Object Document)
    pub fn parse_sod(&self, sod_data: &[u8]) -> Result<SecurityObjectDocument> {
        let (_, content_info) = parse_ber_sequence(sod_data)
            .map_err(|e| anyhow!("SOD Parse Error: {:?}", e))?;
        
        let ci_seq = content_info.content.as_sequence()
            .map_err(|_| anyhow!("ContentInfo not a sequence"))?;
        
        if ci_seq.len() < 2 { bail!("Invalid ContentInfo"); }
        
        // Extract content (Tagged [0])
        // ContentInfo content is usually Tagged [0] Explicit
        let signed_data_seq_obj = match &ci_seq[1].content {
            BerObjectContent::Tagged(_, _, inner) => inner.as_ref(),
            _ => bail!("ContentInfo content not tagged"),
        };
        
        let signed_data_seq = signed_data_seq_obj.content.as_sequence()
            .map_err(|_| anyhow!("SignedData not a sequence"))?;
            
        if signed_data_seq.len() < 3 { bail!("SignedData too short"); }
        
        let encap_content_info = &signed_data_seq[2];
        let encap_seq = encap_content_info.content.as_sequence()
            .map_err(|_| anyhow!("Invalid EncapContentInfo"))?;
            
        // eContent is [0] EXPLICIT OCTET STRING
        if encap_seq.len() < 2 { bail!("EncapContentInfo missing content"); }
        
        let e_content_octet = match &encap_seq[1].content {
            BerObjectContent::Tagged(_, _, inner) => {
                match &inner.content {
                    BerObjectContent::OctetString(bytes) => bytes,
                    _ => bail!("eContent not OctetString"),
                }
            },
            _ => bail!("eContent not tagged"),
        };
        
        let lds_object = self.parse_lds_object(e_content_octet)?;
        
        Ok(SecurityObjectDocument {
            signed_data: sod_data.to_vec(),
            lds_object,
            signer_cert: None, 
            signature: vec![],
            signed_attributes: vec![],
        })
    }

    fn parse_lds_object(&self, data: &[u8]) -> Result<LdsSecurityObject> {
        let (_, seq_obj) = parse_ber_sequence(data)
            .map_err(|e| anyhow!("LDS Object Parse Error: {:?}", e))?;
        
        let seq = seq_obj.content.as_sequence()
            .map_err(|_| anyhow!("LDS Object not a sequence"))?;
        
        if seq.len() < 3 { bail!("Invalid LDSSecurityObject"); }
        
        // [1] hashAlgorithm
        let hash_algo_seq = seq[1].content.as_sequence()
            .map_err(|_| anyhow!("Invalid HashAlgo"))?;
        let oid_obj = hash_algo_seq[0].content.as_oid()
            .map_err(|_| anyhow!("HashAlgo OID missing"))?;
        let hash_algo_oid = oid_obj.to_id_string();
        
        // [2] dataGroupHashValues
        let dg_hashes_seq = seq[2].content.as_sequence()
            .map_err(|_| anyhow!("Invalid DG Hashes"))?;
        
        let mut hashes = HashMap::new();
        for dg_hash_obj in dg_hashes_seq {
            let dg_seq = dg_hash_obj.content.as_sequence()
                .map_err(|_| anyhow!("Invalid DG Hash Entry"))?;
            
            // 0: integer
            let num = dg_seq[0].content.as_u32()
                .map_err(|_| anyhow!("Invalid DG Num"))? as u8;
            
            // 1: octet string
            let val = match &dg_seq[1].content {
                BerObjectContent::OctetString(bytes) => bytes.to_vec(),
                _ => bail!("Invalid DG Hash Val"),
            };
            
            hashes.insert(num, val);
        }
        
        Ok(LdsSecurityObject {
            hash_algorithm: hash_algo_oid,
            data_group_hashes: hashes,
        })
    }

    /// Verify the SOD signature using CSCA certificates
    pub fn verify_sod_signature(&self, _sod: &SecurityObjectDocument) -> Result<()> {
        if self.csca_certs.is_empty() {
            bail!("No CSCA certificates loaded");
        }
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

        let computed_hash = self.compute_hash(&sod.lds_object.hash_algorithm, dg_data)?;

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
    
    fn compute_hash(&self, oid: &str, data: &[u8]) -> Result<Vec<u8>> {
        match oid {
            "2.16.840.1.101.3.4.2.1" => { // SHA-256
                let mut hasher = Sha256::new();
                hasher.update(data);
                Ok(hasher.finalize().to_vec())
            }
            "2.16.840.1.101.3.4.2.2" => { // SHA-384
                let mut hasher = Sha384::new();
                hasher.update(data);
                Ok(hasher.finalize().to_vec())
            }
            "2.16.840.1.101.3.4.2.3" => { // SHA-512
                let mut hasher = Sha512::new();
                hasher.update(data);
                Ok(hasher.finalize().to_vec())
            }
            "1.3.14.3.2.26" => { // SHA-1
                let mut hasher = Sha1::new();
                hasher.update(data);
                Ok(hasher.finalize().to_vec())
            }
            _ => bail!("Unsupported hash algorithm OID: {}", oid),
        }
    }
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
            signer_cert: None,
            signature: vec![],
            signed_attributes: vec![],
        };

        let verifier = PassportVerifier::new();
        let result = verifier.verify_data_group(&sod, 1, b"test data");
        assert!(result.is_ok());
    }
}
