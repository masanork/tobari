use crate::models::CitizenIdentity;
use anyhow::Result;
use ciborium::value::Value;
use serde::{Deserialize, Serialize};

pub mod mso;
pub use mso::MobileSecurityObject;

/// ISO/IEC 18013-5 IssuerSignedItem
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssuerSignedItem {
    #[serde(rename = "digestID")]
    pub digest_id: u64,
    pub random: Vec<u8>,
    #[serde(rename = "elementIdentifier")]
    pub element_identifier: String,
    #[serde(rename = "elementValue")]
    pub element_value: Value,
}

impl IssuerSignedItem {
    pub fn new(id: u64, identifier: &str, value: Value) -> Self {
        use rand::RngCore;
        let mut random = vec![0u8; 16];
        rand::thread_rng().fill_bytes(&mut random);

        Self {
            digest_id: id,
            random,
            element_identifier: identifier.to_string(),
            element_value: value,
        }
    }

    /// Encode the item to CBOR bytes (used for hashing in MSO)
    pub fn to_cbor(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        ciborium::ser::into_writer(self, &mut bytes).unwrap();
        bytes
    }
}

/// SCAC (Self-hosted Crypto Account Ownership Credential) Data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScacData {
    pub wallet_address: String,
    pub blockchain: String,
    pub chain_id: Option<String>,
    pub verification_method: Option<String>,
    pub assurance_level: Option<String>,
    pub issuer_id: Option<String>,
}

/// Convert CitizenIdentity to mDoc Items for a specific namespace
pub fn identity_to_mdoc_items(
    identity: &CitizenIdentity,
    namespace: &str,
) -> Vec<IssuerSignedItem> {
    let mut items = Vec::new();
    let mut id = 0;

    macro_rules! add_item {
        ($key:expr, $val:expr) => {
            if let Some(v) = $val {
                if !v.is_empty() {
                    items.push(IssuerSignedItem::new(id, $key, Value::Text(v.clone())));
                    id += 1;
                }
            }
        };
    }

    match namespace {
        "org.iso.18013.5.1" => {
            add_item!("family_name", Some(&identity.full_name));
            add_item!("given_name", Some(&"".to_string()));
            add_item!("birth_date", Some(&identity.birth_date));
            add_item!("document_number", Some(&identity.identity_number));
            add_item!("issuing_authority", identity.issuing_authority.as_ref());
        }
        "urn:icao:dtc:1" => {
            add_item!("family_name", Some(&identity.full_name));
            add_item!("date_of_birth", Some(&identity.birth_date));
            add_item!("document_number", Some(&identity.identity_number));
        }
        _ => {}
    }

    let _ = id; // Suppress unused assignment warning
    items
}

/// Convert ScacData to mDoc Items for org.jaopp.scac namespace
pub fn scac_to_mdoc_items(data: &ScacData) -> Vec<IssuerSignedItem> {
    let mut items = Vec::new();
    let mut id = 0;

    items.push(IssuerSignedItem::new(
        id,
        "wallet_address",
        Value::Text(data.wallet_address.clone()),
    ));
    id += 1;

    items.push(IssuerSignedItem::new(
        id,
        "blockchain",
        Value::Text(data.blockchain.clone()),
    ));
    id += 1;

    if let Some(v) = &data.chain_id {
        items.push(IssuerSignedItem::new(id, "chain_id", Value::Text(v.clone())));
        id += 1;
    }
    if let Some(v) = &data.verification_method {
        items.push(IssuerSignedItem::new(
            id,
            "verification_method",
            Value::Text(v.clone()),
        ));
        id += 1;
    }
    if let Some(v) = &data.assurance_level {
        items.push(IssuerSignedItem::new(
            id,
            "assurance_level",
            Value::Text(v.clone()),
        ));
        id += 1;
    }
    if let Some(v) = &data.issuer_id {
        items.push(IssuerSignedItem::new(
            id,
            "issuer_id",
            Value::Text(v.clone()),
        ));
        // id += 1;
    }

    items
}

/// Helper to generate a SCAC mDoc DeviceResponse
pub fn generate_scac_mdoc(data: &ScacData) -> Result<Vec<u8>> {
    let namespace = "org.jaopp.scac";
    let doc_type = "org.jaopp.scac"; // Using namespace as docType for SCAC

    let items = scac_to_mdoc_items(data);
    let mut mso = MobileSecurityObject::new(doc_type);
    mso.add_items(namespace, &items);

    let mso_cbor = mso.to_cbor();

    // Create COSE Sign1 (Mock for now)
    use coset::{iana, CoseSign1Builder, HeaderBuilder};

    let protected = HeaderBuilder::new()
        .algorithm(iana::Algorithm::ES256)
        .build();

    let signer = CoseSign1Builder::new()
        .protected(protected)
        .payload(mso_cbor)
        .build();

    // Use coset's native serialization
    use coset::CborSerializable;
    let issuer_auth_bytes = signer
        .to_vec()
        .map_err(|e| anyhow::anyhow!("COSE serialization error: {:?}", e))?;

    // Encode Items as tagged bytes for IssuerSigned
    let mut name_spaces = std::collections::HashMap::new();
    let mut encoded_items = Vec::new();
    for item in items {
        encoded_items.push(Value::Bytes(item.to_cbor()));
    }
    name_spaces.insert(namespace.to_string(), Value::Array(encoded_items));

    let issuer_signed = Value::Map(vec![
        (
            Value::Text("nameSpaces".to_string()),
            Value::Map(vec![(
                Value::Text(namespace.to_string()),
                name_spaces.get(namespace).unwrap().clone(),
            )]),
        ),
        (
            Value::Text("issuerAuth".to_string()),
            Value::Bytes(issuer_auth_bytes),
        ),
    ]);

    let document = Value::Map(vec![
        (
            Value::Text("docType".to_string()),
            Value::Text(doc_type.to_string()),
        ),
        (Value::Text("issuerSigned".to_string()), issuer_signed),
    ]);

    let response = Value::Map(vec![
        (
            Value::Text("version".to_string()),
            Value::Text("1.0".to_string()),
        ),
        (
            Value::Text("documents".to_string()),
            Value::Array(vec![document]),
        ),
    ]);

    let mut mdoc_bytes = Vec::new();
    ciborium::ser::into_writer(&response, &mut mdoc_bytes)?;
    Ok(mdoc_bytes)
}

/// Helper to generate a full mDoc DeviceResponse (Simplified)
pub fn generate_mdoc(identity: &CitizenIdentity, doc_type: &str) -> Result<Vec<u8>> {
    let namespace = match doc_type {
        "org.iso.18013.5.1" => "org.iso.18013.5.1",
        "urn:icao:dtc:1" => "urn:icao:dtc:1",
        _ => "org.iso.18013.5.1",
    };

    let items = identity_to_mdoc_items(identity, namespace);
    let mut mso = MobileSecurityObject::new(doc_type);
    mso.add_items(namespace, &items);

    let mso_cbor = mso.to_cbor();

    // Create COSE Sign1 (Mock for now)
    use coset::{iana, CoseSign1Builder, HeaderBuilder};

    let protected = HeaderBuilder::new()
        .algorithm(iana::Algorithm::ES256)
        .build();

    let signer = CoseSign1Builder::new()
        .protected(protected)
        .payload(mso_cbor)
        .build();

    // Use coset's native serialization
    use coset::CborSerializable;
    let issuer_auth_bytes = signer
        .to_vec()
        .map_err(|e| anyhow::anyhow!("COSE serialization error: {:?}", e))?;

    // Encode Items as tagged bytes for IssuerSigned
    let mut name_spaces = std::collections::HashMap::new();
    let mut encoded_items = Vec::new();
    for item in items {
        encoded_items.push(Value::Bytes(item.to_cbor()));
    }
    name_spaces.insert(namespace.to_string(), Value::Array(encoded_items));

    let issuer_signed = Value::Map(vec![
        (
            Value::Text("nameSpaces".to_string()),
            Value::Map(vec![(
                Value::Text(namespace.to_string()),
                name_spaces.get(namespace).unwrap().clone(),
            )]),
        ),
        (
            Value::Text("issuerAuth".to_string()),
            Value::Bytes(issuer_auth_bytes),
        ),
    ]);

    let document = Value::Map(vec![
        (
            Value::Text("docType".to_string()),
            Value::Text(doc_type.to_string()),
        ),
        (Value::Text("issuerSigned".to_string()), issuer_signed),
    ]);

    let response = Value::Map(vec![
        (
            Value::Text("version".to_string()),
            Value::Text("1.0".to_string()),
        ),
        (
            Value::Text("documents".to_string()),
            Value::Array(vec![document]),
        ),
    ]);

    let mut mdoc_bytes = Vec::new();
    ciborium::ser::into_writer(&response, &mut mdoc_bytes)?;
    Ok(mdoc_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_mdoc_basic() {
        let identity = CitizenIdentity {
            full_name: "Taro Yamada".to_string(),
            birth_date: "1990-01-01".to_string(),
            identity_number: "123456789012".to_string(),
            card_type: "MyNumberCard".to_string(),
            ..Default::default()
        };

        let res = generate_mdoc(&identity, "org.iso.18013.5.1");
        assert!(res.is_ok());
        let mdoc = res.unwrap();
        assert!(!mdoc.is_empty());

        // Basic CBOR check
        let val: Value = ciborium::de::from_reader(&mdoc[..]).unwrap();
        if let Value::Map(map) = val {
            let version = map
                .iter()
                .find(|(k, _)| k.as_text() == Some("version"))
                .unwrap()
                .1
                .as_text();
            assert_eq!(version, Some("1.0"));
        }
    }

    #[test]
    fn test_generate_scac_mdoc() {
        let data = ScacData {
            wallet_address: "0x1234567890abcdef1234567890abcdef12345678".to_string(),
            blockchain: "Ethereum".to_string(),
            chain_id: Some("1".to_string()),
            verification_method: Some("jpki".to_string()),
            assurance_level: Some("high".to_string()),
            issuer_id: None,
        };

        let res = generate_scac_mdoc(&data);
        assert!(res.is_ok());
        let mdoc = res.unwrap();
        assert!(!mdoc.is_empty());

        // Basic CBOR check
        let val: Value = ciborium::de::from_reader(&mdoc[..]).unwrap();
        if let Value::Map(map) = val {
            let version = map
                .iter()
                .find(|(k, _)| k.as_text() == Some("version"))
                .unwrap()
                .1
                .as_text();
            assert_eq!(version, Some("1.0"));
        }
    }
}
