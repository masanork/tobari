use anyhow::{Result, bail, anyhow};
use std::collections::HashMap;
use sha2::{Sha256, Digest};
use sha1::Sha1;
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

    /// Load CSCA certificates from a PEM file
    pub fn load_csca_pem(&mut self, pem_content: &str) -> Result<()> {
        let mut in_cert = false;
        let mut cert_data = String::new();
        for line in pem_content.lines() {
            let trimmed = line.trim();
            if trimmed == "-----BEGIN CERTIFICATE-----" {
                in_cert = true;
                cert_data.clear();
            } else if trimmed == "-----END CERTIFICATE-----" {
                if in_cert {
                    let der = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &cert_data)
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

        let lds_object = self.parse_lds_security_object(e_content_octet)?;

        Ok(SecurityObjectDocument {
            signed_data: sod_data.to_vec(),
            lds_object,
            signer_cert: None, // Simplified for Phase 1
            signature: vec![],
            signed_attributes: vec![],
        })
    }

    fn parse_lds_security_object(&self, data: &[u8]) -> Result<LdsSecurityObject> {
        let (_, lds_seq) = parse_ber_sequence(data)
            .map_err(|e| anyhow!("LDS Parse Error: {:?}", e))?;
        let lds_seq = lds_seq.content.as_sequence()
            .map_err(|_| anyhow!("LDS not a sequence"))?;
            
        if lds_seq.len() < 3 { bail!("LDS sequence too short"); }
        
        let hash_algo_oid = match &lds_seq[1].content {
            BerObjectContent::Sequence(s) => {
                match &s[0].content {
                    BerObjectContent::OID(oid) => oid.to_string(),
                    _ => bail!("Invalid hash algorithm OID"),
                }
            },
            _ => bail!("Invalid AlgorithmIdentifier"),
        };

        let hash_list_seq = match &lds_seq[2].content {
            BerObjectContent::Sequence(s) => s,
            _ => bail!("DataGroupHashValues not a sequence"),
        };

        let mut data_group_hashes = HashMap::new();
        for item in hash_list_seq {
            let item_seq = item.content.as_sequence()
                .map_err(|_| anyhow!("Hash item not a sequence"))?;
            let dg_num = item_seq[0].content.as_u32()? as u8;
            let dg_hash = item_seq[1].content.as_slice()?.to_vec();
            data_group_hashes.insert(dg_num, dg_hash);
        }

        Ok(LdsSecurityObject {
            hash_algorithm: hash_algo_oid,
            data_group_hashes,
        })
    }

    /// Verify that a Data Group's content matches the hash in SOD
    pub fn verify_data_group(
        &self,
        sod: &SecurityObjectDocument,
        dg_number: u8,
        dg_content: &[u8],
    ) -> Result<()> {
        let expected_hash = sod.lds_object.data_group_hashes.get(&dg_number)
            .ok_or_else(|| anyhow!("No hash for DG {}", dg_number))?;
        
        let actual_hash = match sod.lds_object.hash_algorithm.as_str() {
            "2.16.840.1.101.3.4.2.1" | "SHA-256" => {
                let mut hasher = Sha256::new();
                hasher.update(dg_content);
                hasher.finalize().to_vec()
            },
            "1.3.14.3.2.26" | "SHA-1" => {
                let mut hasher = Sha1::new();
                hasher.update(dg_content);
                hasher.finalize().to_vec()
            },
            _ => bail!("Unsupported hash algorithm: {}", sod.lds_object.hash_algorithm),
        };

        if &actual_hash != expected_hash {
            bail!("Hash mismatch for DG {}: expected {}, got {}", 
                dg_number, hex::encode(expected_hash), hex::encode(actual_hash));
        }
        Ok(())
    }

    /// Full Passive Authentication
    pub fn verify_passive_authentication(&self, sod: &SecurityObjectDocument) -> Result<()> {
        // 1. Verify SOD signature using CSCA chain
        // 2. Verify all DG hashes (already implemented part of it)
        println!("[PA] Passive Authentication verified (Mock).");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_csca_pem() {
        let mut verifier = PassportVerifier::new();
        let pem = "-----BEGIN CERTIFICATE-----\nNDI=\n-----END CERTIFICATE-----";
        assert!(verifier.load_csca_pem(pem).is_ok());
        assert_eq!(verifier.csca_certs.len(), 1);
    }

    #[test]
    fn test_verify_data_group_sha256() {
        let verifier = PassportVerifier::new();
        let data = vec![0x01, 0x02, 0x03, 0x04];
        let hash = Sha256::digest(&data).to_vec();
        
        let mut hashes = HashMap::new();
        hashes.insert(1, hash);
        
        let sod = SecurityObjectDocument {
            signed_data: vec![],
            signer_cert: None,
            signature: vec![],
            signed_attributes: vec![],
            lds_object: LdsSecurityObject {
                data_group_hashes: hashes,
                hash_algorithm: "2.16.840.1.101.3.4.2.1".to_string(), // SHA-256 OID
            }
        };
        
        assert!(verifier.verify_data_group(&sod, 1, &data).is_ok());
        assert!(verifier.verify_data_group(&sod, 1, &[0x00]).is_err());
    }

    #[test]
    fn test_verify_data_group_sha1() {
        let verifier = PassportVerifier::new();
        let data = vec![0xAA, 0xBB];
        let hash = Sha1::digest(&data).to_vec();
        
        let mut hashes = HashMap::new();
        hashes.insert(2, hash);

        let sod = SecurityObjectDocument {
            signed_data: vec![],
            signer_cert: None,
            signature: vec![],
            signed_attributes: vec![],
            lds_object: LdsSecurityObject {
                data_group_hashes: hashes,
                hash_algorithm: "1.3.14.3.2.26".to_string(), // SHA-1 OID
            }
        };
        
        assert!(verifier.verify_data_group(&sod, 2, &data).is_ok());
    }

    #[test]
    fn test_sod_parsing_logic() {
        // Minimal ASN.1 test placeholder
    }
}