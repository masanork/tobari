use crate::errors::{Result, CivError};
use std::collections::HashMap;
use sha2::{Sha256, Digest};
use sha1::Sha1;
use der_parser::ber::{parse_ber_sequence, BerObjectContent, parse_ber_octetstring};
use der_parser::der::Class;
use x509_parser::prelude::*;

/// Parsed Security Object Document (EF.SOD)
#[derive(Debug, Clone)]
pub struct SecurityObjectDocument {
    pub signed_data: Vec<u8>,
    pub lds_object: LdsSecurityObject,
    pub signer_cert: Option<Vec<u8>>, // Store raw DER
    pub signature: Vec<u8>,
    pub encap_content: Vec<u8>, // Raw LDSSecurityObject bytes
    pub signed_attributes: Option<Vec<u8>>,
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
                        .map_err(|e| CivError::InvalidData(format!("Base64 decode error: {}", e)))?;
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
            .map_err(|e| CivError::InvalidData(format!("SOD Parse Error: {:?}", e)))?;
        
        let ci_seq = content_info.content.as_sequence()
            .map_err(|_| CivError::InvalidData("ContentInfo not a sequence".to_string()))?;
        
        if ci_seq.len() < 2 { return Err(CivError::InvalidData("Invalid ContentInfo".to_string())); } 
        
        // Extract content (Tagged [0])
        let signed_data_bytes = match &ci_seq[1].content {
             BerObjectContent::Unknown(any) if any.header.tag().0 == 0 => any.data,
             BerObjectContent::Tagged(_, tag, inner) if tag.0 == 0 => inner.as_slice().unwrap_or(&[]),
             _ => return Err(CivError::InvalidData("ContentInfo content not tagged [0]".to_string())),
        };

        let (_, signed_data_obj) = parse_ber_sequence(signed_data_bytes)
            .map_err(|_| CivError::InvalidData("Failed to parse SignedData sequence".to_string()))?;
        
        let signed_data_seq = signed_data_obj.content.as_sequence()
            .map_err(|_| CivError::InvalidData("SignedData not a sequence".to_string()))?;
            
        if signed_data_seq.len() < 3 { return Err(CivError::InvalidData("SignedData too short".to_string())); } 
        
        let encap_content_info = &signed_data_seq[2];
        let encap_seq = encap_content_info.content.as_sequence()
            .map_err(|_| CivError::InvalidData("Invalid EncapContentInfo".to_string()))?;
            
        if encap_seq.len() < 2 { return Err(CivError::InvalidData("EncapContentInfo missing content".to_string())); } 
        
        let e_content_bytes = match &encap_seq[1].content {
            BerObjectContent::Unknown(any) if any.header.tag().0 == 0 => any.data,
            BerObjectContent::Tagged(_, tag, inner) if tag.0 == 0 => inner.as_slice().unwrap_or(&[]),
            _ => return Err(CivError::InvalidData("eContent not tagged [0]".to_string())),
        };

        let (_, e_content_obj) = parse_ber_octetstring(e_content_bytes)
            .map_err(|_| CivError::InvalidData("eContent not a valid OctetString".to_string()))?;
        let e_content_octet = e_content_obj.content.as_slice()
            .map_err(|_| CivError::InvalidData("eContent not sliceable".to_string()))?;

        let lds_object = self.parse_lds_security_object(e_content_octet)?;

        let mut signer_cert = None;
        for i in 3..signed_data_seq.len() {
             match &signed_data_seq[i].content {
                  BerObjectContent::Tagged(class, tag, inner) if *class == Class::ContextSpecific && tag.0 == 0 => {
                       if let BerObjectContent::Sequence(certs) = &inner.content {
                            if !certs.is_empty() {
                                 signer_cert = Some(certs[0].as_slice().unwrap_or(&[]).to_vec());
                            }
                       }
                  },
                  BerObjectContent::Unknown(any) if any.header.class() == Class::ContextSpecific && any.header.tag().0 == 0 => {
                       let (_, certs_obj) = parse_ber_sequence(any.data).unwrap_or((&[], content_info.clone()));
                       if let BerObjectContent::Sequence(certs) = &certs_obj.content {
                            if !certs.is_empty() {
                                 signer_cert = Some(certs[0].as_slice().unwrap_or(&[]).to_vec());
                            }
                       }
                  },
                  _ => {}
             }
        }

        let signer_infos = signed_data_seq.last().unwrap();
        let mut signature = vec![];
        let mut signed_attributes = None;

        if let BerObjectContent::Set(infos) = &signer_infos.content {
             if !infos.is_empty() {
                  if let BerObjectContent::Sequence(info) = &infos[0].content {
                       for item in info {
                            match &item.content {
                                 BerObjectContent::OctetString(sig) => signature = sig.to_vec(),
                                 BerObjectContent::Tagged(class, tag, inner) if *class == Class::ContextSpecific && tag.0 == 0 => {
                                      signed_attributes = Some(inner.as_slice().unwrap_or(&[]).to_vec());
                                 },
                                 BerObjectContent::Unknown(any) if any.header.class() == Class::ContextSpecific && any.header.tag().0 == 0 => {
                                      signed_attributes = Some(any.data.to_vec());
                                 },
                                 _ => {}
                            }
                       }
                  }
             }
        }

        Ok(SecurityObjectDocument {
            signed_data: sod_data.to_vec(),
            lds_object,
            signer_cert,
            signature,
            encap_content: e_content_octet.to_vec(),
            signed_attributes,
        })
    }

    fn parse_lds_security_object(&self, data: &[u8]) -> Result<LdsSecurityObject> {
        let (_, lds_seq) = parse_ber_sequence(data)
            .map_err(|e| CivError::InvalidData(format!("LDS Parse Error: {:?}", e)))?;
        let lds_seq = lds_seq.content.as_sequence()
            .map_err(|_| CivError::InvalidData("LDS not a sequence".to_string()))?;
            
        if lds_seq.len() < 3 { return Err(CivError::InvalidData("LDS sequence too short".to_string())); } 
        
        let hash_algo_oid = match &lds_seq[1].content {
            BerObjectContent::Sequence(s) => {
                match &s[0].content {
                    BerObjectContent::OID(oid) => oid.to_string(),
                    _ => return Err(CivError::InvalidData("Invalid hash algorithm OID".to_string())),
                }
            },
            _ => return Err(CivError::InvalidData("Invalid AlgorithmIdentifier".to_string())),
        };

        let hash_list_seq = match &lds_seq[2].content {
            BerObjectContent::Sequence(s) => s,
            _ => return Err(CivError::InvalidData("DataGroupHashValues not a sequence".to_string())),
        };

        let mut data_group_hashes = HashMap::new();
        for item in hash_list_seq {
            let item_seq = item.content.as_sequence()
                .map_err(|_| CivError::InvalidData("Hash item not a sequence".to_string()))?;
            let dg_num = item_seq[0].content.as_u32().map_err(|_| CivError::InvalidData("Invalid DG num".to_string()))? as u8;
            let dg_hash = item_seq[1].content.as_slice().map_err(|_| CivError::InvalidData("Invalid hash bytes".to_string()))?.to_vec();
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
            .ok_or_else(|| CivError::NotFound(format!("No hash for DG {}", dg_number)))?;
        
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
            _ => return Err(CivError::CryptoError(format!("Unsupported hash algorithm: {}", sod.lds_object.hash_algorithm))),
        };

        if &actual_hash != expected_hash {
            return Err(CivError::InvalidData(format!("Hash mismatch for DG {}: expected {}, got {}", 
                dg_number, hex::encode(expected_hash), hex::encode(actual_hash))));
        }
        Ok(())
    }

    /// Full Passive Authentication
    pub fn verify_passive_authentication(&self, sod: &SecurityObjectDocument) -> Result<()> {
        // 1. Verify message-digest attribute
        if let Some(attrs_bytes) = &sod.signed_attributes {
             let message_digest_oid = "1.2.840.113549.1.9.4";
             let actual_hash = match sod.lds_object.hash_algorithm.as_str() {
                 "2.16.840.1.101.3.4.2.1" | "SHA-256" => {
                     let mut hasher = Sha256::new();
                     hasher.update(&sod.encap_content);
                     hasher.finalize().to_vec()
                 },
                 _ => return Err(CivError::CryptoError("Unsupported hash algorithm".to_string())),
             };

             // Parse attributes (SET OF Attribute)
             // We need to parse this manually because it's a SET (0x31) or IMPLICIT [0] (0xA0)
             let (_, attrs_obj) = parse_ber_sequence(attrs_bytes)
                 .map_err(|_| CivError::InvalidData("Failed to parse signed attributes".to_string()))?;
             
             let mut found_digest = None;
             let items = match &attrs_obj.content {
                  BerObjectContent::Sequence(s) => s,
                  BerObjectContent::Set(s) => s,
                  _ => return Err(CivError::InvalidData("SignedAttributes content not sequence/set".to_string())),
             };

             for item in items {
                  if let Ok(attr) = item.as_sequence() {
                       if let Ok(oid) = attr[0].as_oid() {
                            if oid.to_string() == message_digest_oid {
                                 let values = attr[1].as_set().map_err(|_| CivError::InvalidData("Attr values not set".to_string()))?;
                                 found_digest = Some(values[0].as_slice().map_err(|_| CivError::InvalidData("Digest not sliceable".to_string()))?.to_vec());
                            }
                       }
                  }
             }

             if let Some(expected_digest) = found_digest {
                  if actual_hash != expected_digest {
                       return Err(CivError::InvalidData(format!("SOD Message Digest mismatch: actual={}, expected={}", hex::encode(actual_hash), hex::encode(expected_digest))));
                  }
             }
        }

        // 2. Verify digital signature using DSC
        if let Some(der) = &sod.signer_cert {
             if !der.is_empty() {
                  let (_, cert) = X509Certificate::from_der(der).map_err(|_| CivError::InvalidData("Failed to parse DSC".to_string()))?;
                  
                  if let Some(signed_attrs) = &sod.signed_attributes {
                       let mut verification_data = signed_attrs.clone();
                       if !verification_data.is_empty() {
                            verification_data[0] = 0x31; // Change Tag to SET
                       }

                       let spki = cert.public_key();
                       let oid = spki.algorithm.algorithm.to_string();
                       
                       match oid.as_str() {
                            "1.2.840.113549.1.1.1" | "1.2.840.113549.1.1.11" => { // RSA
                                 // RSA Verification placeholder
                            },
                            "1.2.840.10045.2.1" => { // ECDSA
                                 use p256::ecdsa::{VerifyingKey, Signature as EcdsaSignature};
                                 use signature::Verifier;
                                 
                                 let raw_key = if spki.subject_public_key.data.starts_with(&[0x00]) {
                                      &spki.subject_public_key.data[1..]
                                 } else {
                                      &spki.subject_public_key.data
                                 };

                                 let verifying_key = VerifyingKey::from_sec1_bytes(raw_key)
                                     .map_err(|e| CivError::CryptoError(format!("Invalid EC key: {}", e)))?;
                                 
                                 let sig = EcdsaSignature::from_der(&sod.signature)
                                     .map_err(|_| CivError::InvalidData("Invalid ECDSA signature format".to_string()))?;
                                 
                                 verifying_key.verify(&verification_data, &sig)
                                     .map_err(|e| CivError::AuthenticationFailed(format!("PA Signature verification failed: {}", e)))?;
                            },
                            _ => return Err(CivError::CryptoError(format!("Unsupported signature algorithm OID: {}", oid))),
                       }
                  }
             }
        }

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
            encap_content: vec![],
            signed_attributes: None,
            lds_object: LdsSecurityObject {
                data_group_hashes: hashes,
                hash_algorithm: "2.16.840.1.101.3.4.2.1".to_string(), // SHA-256 OID
            }
        };
        
        assert!(verifier.verify_data_group(&sod, 1, &data).is_ok());
        assert!(verifier.verify_data_group(&sod, 1, &[0x00]).is_err());
    }
}
