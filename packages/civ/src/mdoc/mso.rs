use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValidityInfo {
    pub signed: String, // ISO 8601 tdate
    #[serde(rename = "validFrom")]
    pub valid_from: String,
    #[serde(rename = "validUntil")]
    pub valid_until: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MobileSecurityObject {
    pub version: String,
    #[serde(rename = "digestAlgorithm")]
    pub digest_algorithm: String,
    #[serde(rename = "valueDigests")]
    pub value_digests: HashMap<String, HashMap<u64, Vec<u8>>>,
    #[serde(rename = "docType")]
    pub doc_type: String,
    #[serde(rename = "validityInfo")]
    pub validity_info: ValidityInfo,
}

impl MobileSecurityObject {
    pub fn new(doc_type: &str) -> Self {
        Self {
            version: "1.0".to_string(),
            digest_algorithm: "SHA-256".to_string(),
            value_digests: HashMap::new(),
            doc_type: doc_type.to_string(),
            validity_info: ValidityInfo {
                signed: "2026-01-10T00:00:00Z".to_string(),
                valid_from: "2026-01-10T00:00:00Z".to_string(),
                valid_until: "2031-01-10T00:00:00Z".to_string(),
            },
        }
    }

    /// Add items to digests for a specific namespace
    pub fn add_items(&mut self, namespace: &str, items: &[super::IssuerSignedItem]) {
        let mut digests = HashMap::new();
        for item in items {
            let item_bytes = item.to_cbor();
            let hash = Sha256::digest(&item_bytes).to_vec();
            digests.insert(item_id_to_u64(item.digest_id), hash);
        }
        self.value_digests.insert(namespace.to_string(), digests);
    }

    pub fn to_cbor(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        ciborium::ser::into_writer(self, &mut bytes).unwrap();
        bytes
    }
}

// Helper to handle serialization of u64 keys in CBOR maps
fn item_id_to_u64(id: u64) -> u64 {
    id
}
