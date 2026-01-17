use tauri::{command, AppHandle};
use crate::models::{SignerError, BbsKeyPair, UnifiedRequest, UnifiedResponse, RegisterDeviceParams, SignDataParams, ResponseStatus, PreviewInfo};
use crate::commands::card::{handle_read_card as card_handle_read_card};
use crate::utils::{get_tobari_home, inspect_cbor_bytes, cbor_to_json, unwrap_cbor};
use crate::keys::{save_key, StoredKey};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json;
use uuid;

#[command]
pub fn bbs_generate_key() -> Result<BbsKeyPair, SignerError> {
    use bbs::prelude::*;
    let (pk, sk) = Issuer::new_keys(1).map_err(|e| SignerError::Internal(format!("{:?}", e)))?;
    let sk_json = serde_json::to_value(&sk).map_err(|e| SignerError::Serialization(e.to_string()))?;
    let pk_json = serde_json::to_value(&pk).map_err(|e| SignerError::Serialization(e.to_string()))?;

    Ok(BbsKeyPair {
        secret_key: sk_json.to_string(),
        public_key: pk_json.to_string(),
    })
}

#[command]
pub async fn perform_bbs_proof(
    app: AppHandle,
    public_key_json: String,
    signature_json: String,
    messages: Vec<String>,
    revealed_indices: Vec<usize>,
    nonce: String,
) -> Result<(), SignerError> {
    let proof_json = bbs_derive_proof(public_key_json, signature_json, messages, revealed_indices, nonce)?;
    let response = serde_json::json!({
        "signature": proof_json,
        "type": "BBS+ Proof",
        "protocol": "ZKP"
    });
    println!("{}", serde_json::to_string(&response).map_err(|e| SignerError::Serialization(e.to_string()))?);
    app.exit(0);
    Ok(())
}

pub fn bbs_derive_proof(
    public_key_json: String,
    signature_json: String,
    messages: Vec<String>,
    revealed_indices: Vec<usize>,
    nonce: String,
) -> Result<String, SignerError> {
    use bbs::prelude::*;
    use std::collections::BTreeSet;

    let pk: PublicKey = serde_json::from_str(&public_key_json).map_err(|e| SignerError::Serialization(e.to_string()))?;
    let signature: Signature = serde_json::from_str(&signature_json).map_err(|e| SignerError::Serialization(e.to_string()))?;
    
    let mut proof_messages = Vec::new();
    let mut revealed_indices_set = BTreeSet::new();
    
    for (i, msg) in messages.iter().enumerate() {
        let sig_msg = SignatureMessage::hash(msg.as_bytes());
        if revealed_indices.contains(&i) {
            proof_messages.push(ProofMessage::Revealed(sig_msg));
            revealed_indices_set.insert(i);
        } else {
            proof_messages.push(ProofMessage::Hidden(HiddenMessage::ProofSpecificBlinding(sig_msg)));
        }
    }

    let request = ProofRequest {
        revealed_messages: revealed_indices_set,
        verification_key: pk,
    };

    let pok_context = Prover::commit_signature_pok(&request, &proof_messages, &signature)
        .map_err(|e| SignerError::Internal(format!("PoK commit error: {:?}", e)))?;

    let nonce_val = ProofNonce::hash(nonce.as_bytes());
    let challenge_hash = Prover::create_challenge_hash(&[pok_context.clone()], None, &nonce_val)
        .map_err(|e| SignerError::Internal(format!("Challenge hash error: {:?}", e)))?;

    let proof = Prover::generate_signature_pok(pok_context, &challenge_hash)
        .map_err(|e| SignerError::Internal(format!("Proof generation error: {:?}", e)))?;

    serde_json::to_string(&proof).map_err(|e| SignerError::Serialization(e.to_string()))
}

pub async fn handle_unified_request(request: &UnifiedRequest) -> UnifiedResponse {
    match request.command.as_str() {
        "inspect_document" => handle_inspect_document(request).await,
        "read_card" => card_handle_read_card(request).await,
        "register_device" => handle_register_device(request).await,
        "sign_with_bbs" => handle_bbs_sign(request).await,
        "bbs_generate_key" => handle_bbs_generate_key_unified(request).await,
        "sign_data" => handle_sign_data(request).await,
        "sign_presentation" => handle_sign_presentation(request).await,
        _ => UnifiedResponse::error(
            &request.command,
            "UnsupportedCommand",
            &format!("Command '{}' is not supported in unified mode", request.command),
        ),
    }
}

pub async fn handle_inspect_document(request: &UnifiedRequest) -> UnifiedResponse {
    // Ported from lib.rs - logic for InspectDocumentParams
    let params: crate::models::InspectDocumentParams = match serde_json::from_value(request.params.clone()) {
        Ok(p) => p,
        Err(e) => return UnifiedResponse::error(&request.command, "InvalidRequest", &e.to_string()),
    };

    let data = if let Some(path) = params.path {
        match std::fs::read(path) {
            Ok(d) => d,
            Err(e) => return UnifiedResponse::error(&request.command, "InternalError", &e.to_string()),
        }
    } else if let Some(b64) = params.data {
        match URL_SAFE_NO_PAD.decode(b64) {
            Ok(d) => d,
            Err(e) => return UnifiedResponse::error(&request.command, "InvalidRequest", &e.to_string()),
        }
    } else {
        return UnifiedResponse::error(&request.command, "InvalidRequest", "path or data is required");
    };

    if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&data) {
        if json.get("tobari_enc") == Some(&serde_json::Value::Bool(true)) {
            return UnifiedResponse::success(
                &request.command,
                "cardData",
                "json",
                serde_json::json!({ "encrypted": true, "type": "tobari_ecies" }),
                Some(serde_json::json!({ "message": "Document is encrypted." })),
            );
        }
    }

    let root: Result<ciborium::value::Value, _> = ciborium::from_reader(data.as_slice());
    let doc = match root {
        Ok(val) => {
            let unwrapped = unwrap_cbor(val);
            if let Some(arr) = unwrapped.as_array() {
                if arr.len() == 4 {
                    if let Some(payload_bytes) = arr[2].as_bytes() {
                        ciborium::from_reader::<ciborium::value::Value, _>(payload_bytes.as_slice()).ok()
                    } else { Some(unwrapped) }
                } else { Some(unwrapped) }
            } else { Some(unwrapped) }
        }
        Err(_) => None,
    };

    if let Some(doc_val) = doc {
        let unwrapped_doc = unwrap_cbor(doc_val);
        if let Some(map) = unwrapped_doc.as_map() {
            let doc_type = map.iter().find(|(k, _)| k.as_text() == Some("docType")).and_then(|(_, v)| v.as_text()).unwrap_or("Unknown");
            let mut fields = serde_json::Map::new();
            
            let ns_map = map.iter().find(|(k, _)| k.as_text() == Some("issuerSigned"))
                .and_then(|(_, v)| v.as_map())
                .and_then(|m| m.iter().find(|(k, _)| k.as_text() == Some("nameSpaces")))
                .and_then(|(_, v)| v.as_map())
                .or_else(|| map.iter().find(|(k, _)| k.as_text() == Some("nameSpaces")).and_then(|(_, v)| v.as_map()));

            if let Some(ns_map) = ns_map {
                for (_, items_val) in ns_map {
                    if let Some(items_arr) = items_val.as_array() {
                        for item_bytes_val in items_arr {
                            if let Some(item_bytes) = item_bytes_val.as_bytes() {
                                if let Ok(item_val) = ciborium::from_reader::<ciborium::value::Value, _>(item_bytes.as_slice()) {
                                    let unwrapped_item = unwrap_cbor(item_val);
                                    let item_to_parse = if let Some(inner_bytes) = unwrapped_item.as_bytes() {
                                        ciborium::from_reader::<ciborium::value::Value, _>(inner_bytes.as_slice()).unwrap_or(unwrapped_item)
                                    } else { unwrapped_item };

                                    if let Some(arr) = item_to_parse.as_array() {
                                        if arr.len() >= 4 {
                                            if let Some(k) = arr[2].as_text() {
                                                fields.insert(k.to_string(), cbor_to_json(arr[3].clone()));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if fields.is_empty() {
                for (k, v) in map {
                    if let Some(key_text) = k.as_text() {
                        if key_text != "issuerSigned" && key_text != "docType" && key_text != "visuals" {
                            fields.insert(key_text.to_string(), cbor_to_json(v.clone()));
                        }
                    }
                }
            }

            return UnifiedResponse::success(
                &request.command, "cardData", "json",
                serde_json::json!({ "docType": doc_type, "fields": fields }),
                Some(serde_json::json!({ "format": "mdoc/cose", "fieldCount": fields.len() })),
            );
        }
    }

    UnifiedResponse::error(&request.command, "InvalidRequest", "Failed to parse document")
}

pub async fn handle_register_device(request: &UnifiedRequest) -> UnifiedResponse {
    let _params: RegisterDeviceParams = match serde_json::from_value(request.params.clone()) {
        Ok(p) => p,
        Err(_) => RegisterDeviceParams { key_type: None, output_path: None },
    };
    let result = serde_json::json!({
        "signingPublicKey": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
        "platform": std::env::consts::OS
    });
    UnifiedResponse::success(&request.command, "key", "json", result, None)
}

pub async fn handle_bbs_sign(request: &UnifiedRequest) -> UnifiedResponse {
    let params: crate::models::SignBbsParams = match serde_json::from_value(request.params.clone()) {
        Ok(p) => p,
        Err(e) => return UnifiedResponse::error(&request.command, "InvalidRequest", &e.to_string()),
    };

    match bbs_derive_proof(params.public_key, params.signature, params.messages, params.revealed_indices, params.challenge) {
        Ok(proof) => {
            let result = serde_json::json!({ "signature": proof, "type": "BBS+ Proof", "protocol": "ZKP" });
            UnifiedResponse::success(&request.command, "signature", "json", result, None)
        },
        Err(e) => UnifiedResponse::error(&request.command, "InternalError", &e.to_string()),
    }
}

pub async fn handle_bbs_generate_key_unified(request: &UnifiedRequest) -> UnifiedResponse {
    match bbs_generate_key() {
        Ok(keys) => UnifiedResponse::success(&request.command, "key", "json", serde_json::to_value(&keys).unwrap(), None),
        Err(e) => UnifiedResponse::error(&request.command, "InternalError", &e.to_string()),
    }
}

pub async fn handle_sign_data(request: &UnifiedRequest) -> UnifiedResponse {
    let result = serde_json::json!({ "signature": "...", "publicKey": "..." });
    UnifiedResponse::success(&request.command, "signature", "json", result, None)
}

pub async fn handle_sign_presentation(request: &UnifiedRequest) -> UnifiedResponse {
    if request.preview == Some(true) {
        return UnifiedResponse {
            status: ResponseStatus::Preview,
            command: request.command.clone(),
            result: None,
            preview: Some(PreviewInfo {
                summary: "Preparing Verifiable Presentation for approval in GUI.".to_string(),
                fields: None,
                requires_approval: true,
                session_id: Some(uuid::Uuid::new_v4().to_string()),
            }),
            error: None,
        };
    }
    UnifiedResponse::error(&request.command, "InternalError", "Headless sign_presentation not implemented.")
}
