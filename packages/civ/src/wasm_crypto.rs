use crate::crypto::envelope::Envelope;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
pub struct CreateEnvelopeResult {
    pub envelope: String, // JSON string
    pub dek: Vec<u8>,
}

#[wasm_bindgen]
pub fn create_envelope(payload: &[u8]) -> Result<JsValue, JsValue> {
    let (envelope, dek) = Envelope::new(payload)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let result = CreateEnvelopeResult {
        envelope: serde_json::to_string(&envelope)
            .map_err(|e| JsValue::from_str(&e.to_string()))?,
        dek,
    };

    serde_wasm_bindgen::to_value(&result)
        .map_err(|_| JsValue::from_str("Serialization failed"))
}

#[wasm_bindgen]
pub fn add_prf_recipient(
    envelope_json: &str,
    dek: &[u8],
    kid: &str,
    salt: &[u8],
    prf_output: &[u8],
) -> Result<String, JsValue> {
    let mut envelope: Envelope = serde_json::from_str(envelope_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid envelope JSON: {}", e)))?;

    envelope
        .add_prf_recipient_with_salt(dek, kid.to_string(), salt, prf_output)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    serde_json::to_string(&envelope)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn decrypt_envelope_with_prf(
    envelope_json: &str,
    kid: &str,
    prf_output: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let envelope: Envelope = serde_json::from_str(envelope_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid envelope JSON: {}", e)))?;

    envelope
        .decrypt_with_prf(kid, prf_output)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
