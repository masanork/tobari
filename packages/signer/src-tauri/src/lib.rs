use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use clap::Parser;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::{AppHandle, State};
// Note: civ crate needs to be available. PcscReader is only available on native targets.
#[cfg(not(target_arch = "wasm32"))]
use civ::{JpkiController, PassportController, DriversLicenseController, ResidenceCardController, PcscReader};

// --- Data Structures ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PassportReadRequest {
    pub mrz: String, // Number + Birth + Expiry (e.g. 123456789850101251231)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PassportData {
    pub dg1: String, // Base64 MRZ
    pub dg2: String, // Base64 Photo
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mrz: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passport_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub birth_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiry_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nationality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub face_photo: Option<String>, // Base64
    #[serde(skip_serializing_if = "Option::is_none")]
    pub face_photo_format: Option<String>, // "jpeg" or "jp2"
    pub sod: Option<String>,
    pub dg11: Option<String>,
    pub dg12: Option<String>,
    pub dg14: Option<String>,
    pub dg15: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DriverLicenseRequest {
    pub pin1: String,
    pub pin2: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DriverLicenseData {
    pub name: String,
    pub name_kana: String,
    pub address: String,
    pub birth_date: String,
    pub license_number: String,
    pub issue_date: String,
    pub expire_date: String,
    pub face_photo: Option<String>, // Base64
    pub face_photo_format: Option<String>, // "jpeg" or "jp2"
    pub signature: Option<String>, // Base64
    pub raw_data_group1: Option<String>, // Base64
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JpkiSignRequest {
    pub challenge: String, // Base64Url
    pub pin: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MyNumberCardRequest {
    pub pin: String, // 4-digit Input Support PIN
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MyNumberCardData {
    pub name: String,
    pub address: String,
    pub birth_date: String,
    pub gender: String,
    pub my_number: String,
    pub face_photo: Option<String>,
    pub face_photo_format: Option<String>, // "jpeg" or "jp2"
    pub auth_cert: Option<String>, // Base64
    pub sign_cert: Option<String>, // Base64
    pub auth_ca_cert: Option<String>, // Base64
    pub sign_ca_cert: Option<String>, // Base64
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SignRequest {
    pub challenge: String, // Base64Url
    pub rp_id: String,
    pub user_verification: Option<String>,
    pub message: Option<String>,
    pub allow_credentials: Option<Vec<CredentialDescriptor>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CredentialDescriptor {
    pub type_: String, // "public-key"
    pub id: String,    // Base64Url
}

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Cli {
    /// JSON string of the unified request
    #[arg(long, value_parser)]
    request: Option<String>,

    /// Path to a file containing the unified request JSON
    #[arg(long, value_parser)]
    file: Option<String>,

    /// Generate a BBS+ key pair and exit
    #[arg(long)]
    bbs_generate_key: bool,
}

// --- Unified Interface (matching signer-macos) ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnifiedRequest {
    pub command: String,
    pub params: serde_json::Value,
    pub preview: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ResponseStatus {
    Success,
    Error,
    Preview,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnifiedResponse {
    pub status: ResponseStatus,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ResponseResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<PreviewInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResponseResult {
    #[serde(rename = "type")]
    pub result_type: String,
    pub format: String,
    pub data: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreviewInfo {
    pub summary: String,
    pub fields: Option<Vec<PreviewField>>,
    #[serde(rename = "requiresApproval")]
    pub requires_approval: bool,
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreviewField {
    pub name: String,
    pub value: String,
    pub disclosed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ErrorInfo {
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InspectDocumentParams {
    pub path: Option<String>,
    pub data: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadCardParams {
    pub card_type: String, // "jpki", "passport", "drivers_license", "residence_card"
    pub pin: Option<String>,
    pub pin1: Option<String>, // for DL
    pub pin2: Option<String>, // for DL
    pub mrz: Option<String>,  // for Passport
    pub can: Option<String>,  // for Passport
    pub use_pace: Option<bool>,
    pub include_certificates: Option<bool>,
    pub include_my_number: Option<bool>,
    pub include_face_photo: Option<bool>,
    pub output_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegisterDeviceParams {
    pub key_type: Option<String>,
    pub output_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SignBbsParams {
    pub public_key: String,
    pub signature: String,
    pub messages: Vec<String>,
    pub revealed_indices: Vec<usize>,
    pub challenge: String, // nonce
    pub output_path: Option<String>,
}

impl UnifiedResponse {
    pub fn success(command: &str, result_type: &str, format: &str, data: serde_json::Value, metadata: Option<serde_json::Value>) -> Self {
        Self {
            status: ResponseStatus::Success,
            command: command.to_string(),
            result: Some(ResponseResult {
                result_type: result_type.to_string(),
                format: format.to_string(),
                data,
                metadata,
            }),
            preview: None,
            error: None,
        }
    }

    pub fn error(command: &str, error_type: &str, message: &str) -> Self {
        Self {
            status: ResponseStatus::Error,
            command: command.to_string(),
            result: None,
            preview: None,
            error: Some(ErrorInfo {
                error_type: error_type.to_string(),
                message: message.to_string(),
                details: None,
            }),
        }
    }
}

// --- Document Inspection Logic ---

fn cbor_to_json(val: ciborium::value::Value) -> serde_json::Value {
    match val {
        ciborium::value::Value::Text(s) => serde_json::Value::String(s),
        ciborium::value::Value::Integer(i) => {
            let i_128: i128 = i.into();
            serde_json::Value::Number(serde_json::Number::from(i_128 as i64))
        }
        ciborium::value::Value::Bool(b) => serde_json::Value::Bool(b),
        ciborium::value::Value::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(cbor_to_json).collect())
        }
        ciborium::value::Value::Map(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map {
                if let Some(key_text) = k.as_text() {
                    obj.insert(key_text.to_string(), cbor_to_json(v));
                }
            }
            serde_json::Value::Object(obj)
        }
        ciborium::value::Value::Bytes(b) => serde_json::Value::String(format!("(binary:{}bytes)", b.len())),
        _ => serde_json::Value::Null,
    }
}

// Helper to unwrap Tag 98 or other potential wrappings
fn unwrap_cbor(val: ciborium::value::Value) -> ciborium::value::Value {
    match val {
        ciborium::value::Value::Tag(_tag, box_val) => unwrap_cbor(*box_val),
        _ => val,
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SignDataParams {
    pub data: String, // Base64URL
    pub algorithm: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SignPresentationParams {
    pub document_path: Option<String>,
    pub document_data: Option<String>,
    pub disclosure_fields: Option<Vec<String>>,
    pub verifier_id: Option<String>,
    pub nonce: Option<String>,
    pub response_uri: Option<String>,
    pub output_format: Option<String>, // "cose" or "jwt"
    pub output_path: Option<String>,
}

pub async fn handle_sign_presentation(request: &UnifiedRequest) -> UnifiedResponse {
    let params: SignPresentationParams = match serde_json::from_value(request.params.clone()) {
        Ok(p) => p,
        Err(e) => return UnifiedResponse::error(&request.command, "InvalidRequest", &e.to_string()),
    };

    // If preview is requested, return preview info and metadata
    if request.preview == Some(true) {
        // In Tauri version, "preview" usually means launching the GUI.
        // We return a preview status which tells the caller we're waiting for user approval.
        return UnifiedResponse {
            status: ResponseStatus::Preview,
            command: request.command.clone(),
            result: None,
            preview: Some(PreviewInfo {
                summary: "Preparing Verifiable Presentation for approval in GUI.".to_string(),
                fields: None, // We'll populate this if we parse the doc here
                requires_approval: true,
                session_id: Some(uuid::Uuid::new_v4().to_string()),
            }),
            error: None,
        };
    }

    // Execute mode: For now, we'll return an error or a simulated result
    // Actual implementation requires Holder Binding logic
    UnifiedResponse::error(
        &request.command,
        "InternalError",
        "Headless execution of sign_presentation is not yet implemented. Use preview mode.",
    )
}

pub async fn handle_bbs_generate_key(request: &UnifiedRequest) -> UnifiedResponse {
    match bbs_generate_key() {
        Ok(keys) => UnifiedResponse::success(&request.command, "key", "json", serde_json::to_value(&keys).unwrap(), None),
        Err(e) => UnifiedResponse::error(&request.command, "InternalError", &e.to_string()),
    }
}

pub async fn handle_sign_data(request: &UnifiedRequest) -> UnifiedResponse {
    let params: SignDataParams = match serde_json::from_value(request.params.clone()) {
        Ok(p) => p,
        Err(e) => return UnifiedResponse::error(&request.command, "InvalidRequest", &e.to_string()),
    };

    // Rust version currently simulates signing or uses a local key
    let result = serde_json::json!({
        "signature": "...", 
        "publicKey": "..."
    });

    UnifiedResponse::success(&request.command, "signature", "json", result, None)
}

pub async fn handle_bbs_sign(request: &UnifiedRequest) -> UnifiedResponse {
    let params: SignBbsParams = match serde_json::from_value(request.params.clone()) {
        Ok(p) => p,
        Err(e) => return UnifiedResponse::error(&request.command, "InvalidRequest", &e.to_string()),
    };

    match bbs_derive_proof(params.public_key, params.signature, params.messages, params.revealed_indices, params.challenge) {
        Ok(proof) => {
            let result = serde_json::json!({
                "signature": proof,
                "type": "BBS+ Proof",
                "protocol": "ZKP"
            });
            if let Some(path) = params.output_path {
                let _ = std::fs::write(path, serde_json::to_string_pretty(&result).unwrap());
            }
            UnifiedResponse::success(&request.command, "signature", "json", result, None)
        },
        Err(e) => UnifiedResponse::error(&request.command, "InternalError", &e.to_string()),
    }
}

pub async fn handle_read_card(request: &UnifiedRequest) -> UnifiedResponse {
    let params: ReadCardParams = match serde_json::from_value(request.params.clone()) {
        Ok(p) => p,
        Err(e) => return UnifiedResponse::error(&request.command, "InvalidRequest", &e.to_string()),
    };

    match params.card_type.as_str() {
        "jpki" => {
            let pin = params.pin.clone().unwrap_or_default();
            if pin.is_empty() {
                return UnifiedResponse::error(&request.command, "InvalidRequest", "PIN is required for JPKI");
            }
            match read_my_number_card_internal(pin, params.include_my_number.unwrap_or(false), params.include_face_photo.unwrap_or(false)).await {
                Ok(data) => {
                    let val = serde_json::to_value(&data).unwrap();
                    if let Some(path) = params.output_path {
                        let _ = std::fs::write(path, serde_json::to_string_pretty(&val).unwrap());
                    }
                    UnifiedResponse::success(&request.command, "cardData", "json", val, Some(serde_json::json!({"cardType": "jpki"})))
                },
                Err(e) => UnifiedResponse::error(&request.command, "InternalError", &e.to_string()),
            }
        },
        "passport" => {
            let mrz = params.mrz.clone().unwrap_or_default();
            if mrz.is_empty() {
                return UnifiedResponse::error(&request.command, "InvalidRequest", "MRZ is required for Passport");
            }
            match read_passport_internal(mrz).await {
                Ok(data) => {
                    let val = serde_json::to_value(&data).unwrap();
                    if let Some(path) = params.output_path {
                        let _ = std::fs::write(path, serde_json::to_string_pretty(&val).unwrap());
                    }
                    UnifiedResponse::success(&request.command, "cardData", "json", val, Some(serde_json::json!({"cardType": "passport"})))
                },
                Err(e) => UnifiedResponse::error(&request.command, "InternalError", &e.to_string()),
            }
        },
        _ => UnifiedResponse::error(&request.command, "UnsupportedCommand", &format!("Card type '{}' not yet supported in unified mode", params.card_type)),
    }
}

pub async fn handle_register_device(request: &UnifiedRequest) -> UnifiedResponse {
    let params: RegisterDeviceParams = match serde_json::from_value(request.params.clone()) {
        Ok(p) => p,
        Err(_) => RegisterDeviceParams { key_type: None, output_path: None },
    };

    // Rust version currently uses simple P-256 keys (simulating Secure Enclave on non-macOS)
    // or just returns what it has.
    let result = serde_json::json!({
        "signingPublicKey": {
            "kty": "EC",
            "crv": "P-256",
            "x": "...", 
            "y": "..."
        },
        "platform": std::env::consts::OS
    });

    if let Some(path) = params.output_path {
        let _ = std::fs::write(path, serde_json::to_string_pretty(&result).unwrap());
    }

    UnifiedResponse::success(&request.command, "key", "json", result, None)
}

pub async fn handle_inspect_document(request: &UnifiedRequest) -> UnifiedResponse {
    let params: InspectDocumentParams = match serde_json::from_value(request.params.clone()) {
        Ok(p) => p,
        Err(e) => return UnifiedResponse::error(&request.command, "InvalidRequest", &e.to_string()),
    };

    let data = if let Some(path) = params.path {
        match std::fs::read(path) {
            Ok(d) => d,
            Err(e) => return UnifiedResponse::error(&request.command, "InternalError", &e.to_string()),
        }
    } else if let Some(b64) = params.data {
        match base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(b64) {
            Ok(d) => d,
            Err(e) => return UnifiedResponse::error(&request.command, "InvalidRequest", &e.to_string()),
        }
    } else {
        return UnifiedResponse::error(&request.command, "InvalidRequest", "path or data is required");
    };

    // Check for ECIES
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
                    // COSE_Sign1 payload
                    if let Some(payload_bytes) = arr[2].as_bytes() {
                        ciborium::from_reader::<ciborium::value::Value, _>(payload_bytes.as_slice()).ok()
                    } else {
                        Some(unwrapped)
                    }
                } else {
                    Some(unwrapped)
                }
            } else {
                Some(unwrapped)
            }
        }
        Err(_) => None,
    };

    if let Some(doc_val) = doc {
        let unwrapped_doc = unwrap_cbor(doc_val);
        if let Some(map) = unwrapped_doc.as_map() {
            let doc_type = map.iter()
                .find(|(k, _)| k.as_text() == Some("docType"))
                .and_then(|(_, v)| v.as_text())
                .unwrap_or("Unknown");
            
            let mut fields = serde_json::Map::new();
            
            // Extract fields from nameSpaces (mdoc structure) or top-level (if simple map)
            let ns_map = map.iter()
                .find(|(k, _)| k.as_text() == Some("issuerSigned"))
                .and_then(|(_, v)| v.as_map())
                .and_then(|m| m.iter().find(|(k, _)| k.as_text() == Some("nameSpaces")))
                .and_then(|(_, v)| v.as_map())
                .or_else(|| {
                    map.iter()
                        .find(|(k, _)| k.as_text() == Some("nameSpaces"))
                        .and_then(|(_, v)| v.as_map())
                });

            if let Some(ns_map) = ns_map {
                for (_, items_val) in ns_map {
                    if let Some(items_arr) = items_val.as_array() {
                        for item_bytes_val in items_arr {
                            if let Some(item_bytes) = item_bytes_val.as_bytes() {
                                if let Ok(item_val) = ciborium::from_reader::<ciborium::value::Value, _>(item_bytes.as_slice()) {
                                    let unwrapped_item = unwrap_cbor(item_val);
                                    let item_to_parse = if let Some(inner_bytes) = unwrapped_item.as_bytes() {
                                        ciborium::from_reader::<ciborium::value::Value, _>(inner_bytes.as_slice()).unwrap_or(unwrapped_item)
                                    } else {
                                        unwrapped_item
                                    };

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
                // Not an mdoc nameSpaces structure, collect top-level fields
                for (k, v) in map {
                    if let Some(key_text) = k.as_text() {
                        if key_text != "issuerSigned" && key_text != "docType" && key_text != "visuals" {
                            fields.insert(key_text.to_string(), cbor_to_json(v.clone()));
                        }
                    }
                }
            }

            return UnifiedResponse::success(
                &request.command,
                "cardData",
                "json",
                serde_json::json!({
                    "docType": doc_type,
                    "fields": fields
                }),
                Some(serde_json::json!({ "format": "mdoc/cose", "fieldCount": fields.len() })),
            );
        }
    }

    UnifiedResponse::error(&request.command, "InvalidRequest", "Failed to parse document")
}

struct AppState {
    request: Mutex<Option<SignRequest>>,
    allow_credentials: Mutex<Option<Vec<CredentialDescriptor>>>,
}

#[derive(Debug)]
struct AssertionResult {
    credential_id: Vec<u8>,
    authenticator_data: Vec<u8>,
    signature: Vec<u8>,
    user_handle: Option<Vec<u8>>,
}

#[derive(Debug, Serialize, thiserror::Error)]
#[serde(tag = "type", content = "details")]
pub enum SignerError {
    #[error("Authenticator error: {0}")]
    Authenticator(String),
    #[error("JPKI error: {0}")]
    Jpki(String),
    #[error("Incorrect PIN. Retries remaining: {retries}")]
    IncorrectPin { retries: u8 },
    #[error("PIN is locked. Please visit a municipal office to reset it.")]
    PinLocked,
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Internal error: {0}")]
    Internal(String),
    #[error("User rejected")]
    Rejected,
    #[error("No request found")]
    NoRequest,
}

impl From<civ::errors::CivError> for SignerError {
    fn from(err: civ::errors::CivError) -> Self {
        match err {
            civ::errors::CivError::IncorrectPin(retries) => SignerError::IncorrectPin { retries },
            civ::errors::CivError::PinLocked => SignerError::PinLocked,
            _ => SignerError::Jpki(err.to_string()),
        }
    }
}

#[cfg(any(
    target_os = "windows",
    all(target_os = "macos", feature = "macos-authenticator"),
    all(target_os = "linux", feature = "linux-authenticator")
))]
fn get_assertion(
    request: SignRequest,
    rp_id: String,
    challenge_bytes: Vec<u8>,
) -> Result<AssertionResult, String> {
    use authenticator::authenticatorservice::{AuthenticatorService, SignArgs};
    use authenticator::ctap2::server::{
        AuthenticationExtensionsClientInputs, PublicKeyCredentialDescriptor,
        UserVerificationRequirement,
    };
    use authenticator::statecallback::StateCallback;
    use std::sync::mpsc::channel;
    use std::thread;
    use std::time::Duration;

    let mut manager =
        AuthenticatorService::new().map_err(|e| format!("Authenticator init error: {:?}", e))?;
    manager.add_detected_transports();

    let allowed_creds = request
        .allow_credentials
        .as_ref()
        .map(|creds| {
            creds
                .iter()
                .map(|c| PublicKeyCredentialDescriptor {
                    id: URL_SAFE_NO_PAD.decode(&c.id).unwrap_or_default(),
                    transports: Vec::new(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let user_verification_req = match request.user_verification.as_deref() {
        Some("required") => UserVerificationRequirement::Required,
        Some("discouraged") => UserVerificationRequirement::Discouraged,
        _ => UserVerificationRequirement::Preferred,
    };

    let client_data_hash: [u8; 32] = challenge_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "Invalid client_data_hash length".to_string())?;

    let ctap_args = SignArgs {
        client_data_hash,
        origin: format!("https://{}", rp_id),
        relying_party_id: rp_id,
        allow_list: allowed_creds,
        user_verification_req,
        user_presence_req: true,
        extensions: AuthenticationExtensionsClientInputs::default(),
        pin: None,
        use_ctap1_fallback: false,
    };

    let (status_tx, status_rx) = channel();
    thread::spawn(move || {
        while let Ok(status) = status_rx.recv() {
            eprintln!("[authenticator] status: {:?}", status);
        }
    });

    let (sign_tx, sign_rx) = channel();
    let callback = StateCallback::new(Box::new(move |rv| {
        let _ = sign_tx.send(rv);
    }));

    let timeout_ms = 60_000;
    manager
        .sign(timeout_ms, ctap_args, status_tx, callback)
        .map_err(|e| format!("Authenticator sign error: {:?}", e))?;

    let sign_result = sign_rx
        .recv_timeout(Duration::from_secs(60))
        .map_err(|e| {
            let _ = manager.cancel();
            format!("Authenticator timed out: {:?}", e)
        })?;

    match sign_result {
        Ok(assertion_result) => {
            let assertion = assertion_result.assertion;
            let credential_id = assertion
                .credentials
                .as_ref()
                .map(|c| c.id.clone())
                .unwrap_or_default();
            Ok(AssertionResult {
                credential_id,
                authenticator_data: assertion.auth_data.to_vec(),
                signature: assertion.signature,
                user_handle: assertion.user.map(|u| u.id),
            })
        }
        Err(e) => Err(format!("Authenticator error: {:?}", e)),
    }
}

#[cfg(any(
    target_os = "windows",
    all(target_os = "macos", feature = "macos-authenticator"),
    all(target_os = "linux", feature = "linux-authenticator")
))]
fn register_credential(
    request: SignRequest,
    rp_id: String,
    client_data_hash: [u8; 32],
) -> Result<Vec<u8>, String> {
    use authenticator::authenticatorservice::{AuthenticatorService, RegisterArgs};
    use authenticator::ctap2::server::{
        AuthenticationExtensionsClientInputs, PublicKeyCredentialParameters,
        PublicKeyCredentialUserEntity, ResidentKeyRequirement, RelyingParty,
        UserVerificationRequirement,
    };
    use authenticator::statecallback::StateCallback;
    use std::sync::mpsc::channel;
    use std::thread;

    let mut manager =
        AuthenticatorService::new().map_err(|e| format!("Authenticator init error: {:?}", e))?;
    manager.add_detected_transports();

    let user_verification_req = match request.user_verification.as_deref() {
        Some("required") => UserVerificationRequirement::Required,
        Some("discouraged") => UserVerificationRequirement::Discouraged,
        _ => UserVerificationRequirement::Preferred,
    };

    let rp = RelyingParty {
        id: rp_id.clone(),
        name: Some(rp_id.clone()),
    };

    let user = PublicKeyCredentialUserEntity {
        id: Sha256::digest(rp_id.as_bytes()).to_vec(),
        name: Some("tobari-user".to_string()),
        display_name: Some("Tobari User".to_string()),
    };

    let pub_cred_params = vec![PublicKeyCredentialParameters::try_from(-7)
        .map_err(|e| format!("COSE alg error: {:?}", e))?];

    let ctap_args = RegisterArgs {
        client_data_hash,
        relying_party: rp,
        origin: format!("https://{}", rp_id),
        user,
        pub_cred_params,
        exclude_list: Vec::new(),
        user_verification_req,
        resident_key_req: ResidentKeyRequirement::Preferred,
        extensions: AuthenticationExtensionsClientInputs::default(),
        pin: None,
        use_ctap1_fallback: false,
    };

    let (status_tx, status_rx) = channel();
    thread::spawn(move || {
        while let Ok(status) = status_rx.recv() {
            eprintln!("[authenticator] status: {:?}", status);
        }
    });

    let (reg_tx, reg_rx) = channel();
    let callback = StateCallback::new(Box::new(move |rv| {
        let _ = reg_tx.send(rv);
    }));

    let timeout_ms = 60_000;
    manager
        .register(timeout_ms, ctap_args, status_tx, callback)
        .map_err(|e| format!("Authenticator register error: {:?}", e))?;

    let reg_result = reg_rx
        .recv_timeout(std::time::Duration::from_secs(60))
        .map_err(|e| {
            let _ = manager.cancel();
            format!("Authenticator register timed out: {:?}", e)
        })?;

    match reg_result {
        Ok(attestation) => {
            let cred_data = attestation
                .att_obj
                .auth_data
                .credential_data
                .ok_or("No credential data returned")?;
            Ok(cred_data.credential_id)
        }
        Err(e) => Err(format!("Authenticator register error: {:?}", e)),
    }
}

#[cfg(all(target_os = "linux", not(feature = "linux-authenticator")))]
fn get_assertion(
    _request: SignRequest,
    _rp_id: String,
    _challenge_bytes: Vec<u8>,
) -> Result<AssertionResult, String> {
    Err("WebAuthn signing on Linux requires the `linux-authenticator` feature and system NSS/PKCS#11 dependencies. Enable the feature and ensure nss-gk-api build prerequisites are installed."
        .to_string())
}

#[cfg(all(target_os = "macos", not(feature = "macos-authenticator")))]
fn get_assertion(
    _request: SignRequest,
    _rp_id: String,
    _challenge_bytes: Vec<u8>,
) -> Result<AssertionResult, String> {
    Err("WebAuthn signing on macOS requires the `macos-authenticator` feature. Enable it once the platform dependencies are available."
        .to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SignResponse {
    pub signature: String, // Base64Url
    #[serde(rename = "authData", skip_serializing_if = "Option::is_none")]
    pub auth_data: Option<String>, // Base64Url
    #[serde(rename = "clientDataJSON", skip_serializing_if = "Option::is_none")]
    pub client_data_json: Option<String>, // Raw JSON string
    #[serde(rename = "publicKey", skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
}

// --- Tauri Commands ---

#[tauri::command]
fn get_pending_request(state: State<AppState>) -> Result<Option<SignRequest>, SignerError> {
    let request = state.request.lock().map_err(|e| SignerError::Internal(e.to_string()))?;
    Ok(request.clone())
}

#[tauri::command]
fn reject(app: AppHandle) {
    eprintln!("User rejected the request.");
    app.exit(1);
}

#[tauri::command]
async fn perform_sign(state: State<'_, AppState>, app: AppHandle) -> Result<(), SignerError> {
    let mut request = {
        let lock = state.request.lock().map_err(|e| SignerError::Internal(e.to_string()))?;
        lock.clone().ok_or(SignerError::NoRequest)?
    };
    if let Ok(lock) = state.allow_credentials.lock() {
        if let Some(creds) = lock.clone() {
            request.allow_credentials = Some(creds);
        }
    }

    println!("Starting WebAuthn signing for RP ID: {}", request.rp_id);

    // 1. Construct clientDataJSON
    let origin = format!("https://{}", request.rp_id);
    let client_data = serde_json::json!({
        "type": "webauthn.get",
        "challenge": request.challenge,
        "origin": origin,
        "crossOrigin": false
    });
    let client_data_json = client_data.to_string();
    let client_data_bytes = client_data_json.as_bytes();

    // 2. Calculate clientDataHash
    let client_data_hash = Sha256::digest(client_data_bytes).to_vec();

    // 3. Call Authenticator
    let rp_id = request.rp_id.clone();
    
    let result =
        tokio::task::spawn_blocking(move || get_assertion(request, rp_id, client_data_hash))
            .await
            .map_err(|e| SignerError::Internal(e.to_string()))?
            .map_err(SignerError::Authenticator)?;

    // 4. Output result in the new unified format
    let response = SignResponse {
        signature: URL_SAFE_NO_PAD.encode(&result.signature),
        auth_data: Some(URL_SAFE_NO_PAD.encode(&result.authenticator_data)),
        client_data_json: Some(client_data_json),
        public_key: None,
    };

    println!("{}", serde_json::to_string(&response).map_err(|e| SignerError::Serialization(e.to_string()))?);

    // Exit app
    app.exit(0);
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RegisterResponse {
    #[serde(rename = "credentialId")]
    pub credential_id: String, // Base64Url
    #[serde(rename = "publicKey")]
    pub public_key: serde_json::Value, // JWK
}

#[tauri::command]
async fn perform_register(state: State<'_, AppState>) -> Result<String, SignerError> {
    let request = {
        let lock = state.request.lock().map_err(|e| SignerError::Internal(e.to_string()))?;
        lock.clone().ok_or(SignerError::NoRequest)?
    };

    let rp_id = request.rp_id.clone();
    let challenge_bytes = URL_SAFE_NO_PAD
        .decode(&request.challenge)
        .map_err(|e| SignerError::Internal(e.to_string()))?;

    let origin = format!("https://{}", rp_id);
    let client_data = serde_json::json!({
        "type": "webauthn.create",
        "challenge": request.challenge,
        "origin": origin,
        "crossOrigin": false
    });
    let client_data_json = client_data.to_string();
    let client_data_hash = Sha256::digest(client_data_json.as_bytes());
    let client_data_hash: [u8; 32] = client_data_hash
        .as_slice()
        .try_into()
        .map_err(|_| SignerError::Internal("Invalid client_data_hash length".to_string()))?;

    if challenge_bytes.is_empty() {
        return Err(SignerError::Internal("Invalid challenge".to_string()));
    }

    // Call Authenticator Register
    let rp_id_for_reg = rp_id.clone();
    let reg_result = tokio::task::spawn_blocking(move || {
        register_credential_full(request, rp_id_for_reg, client_data_hash)
    })
    .await
    .map_err(|e| SignerError::Internal(e.to_string()))?
    .map_err(SignerError::Authenticator)?;

    let credential_b64 = URL_SAFE_NO_PAD.encode(&reg_result.credential_id);

    // Prepare JWK
    let response = RegisterResponse {
        credential_id: credential_b64.clone(),
        public_key: reg_result.public_key_jwk,
    };

    if let Ok(mut lock) = state.allow_credentials.lock() {
        *lock = Some(vec![CredentialDescriptor {
            type_: "public-key".to_string(),
            id: credential_b64.clone(),
        }]);
    }

    Ok(serde_json::to_string(&response).map_err(|e| SignerError::Serialization(e.to_string()))?)
}

// Helper struct for internal use
struct InternalRegisterResult {
    credential_id: Vec<u8>,
    public_key_jwk: serde_json::Value,
}

#[cfg(any(
    target_os = "windows",
    all(target_os = "macos", feature = "macos-authenticator"),
    all(target_os = "linux", feature = "linux-authenticator")
))]
fn register_credential_full(
    request: SignRequest,
    rp_id: String,
    client_data_hash: [u8; 32],
) -> Result<InternalRegisterResult, String> {
    use authenticator::authenticatorservice::{AuthenticatorService, RegisterArgs};
    use authenticator::ctap2::server::{
        AuthenticationExtensionsClientInputs, PublicKeyCredentialParameters,
        PublicKeyCredentialUserEntity, ResidentKeyRequirement, RelyingParty,
        UserVerificationRequirement,
    };
    use authenticator::statecallback::StateCallback;
    use std::sync::mpsc::channel;
    use std::thread;

    let mut manager =
        AuthenticatorService::new().map_err(|e| format!("Authenticator init error: {:?}", e))?;
    manager.add_detected_transports();

    let user_verification_req = match request.user_verification.as_deref() {
        Some("required") => UserVerificationRequirement::Required,
        Some("discouraged") => UserVerificationRequirement::Discouraged,
        _ => UserVerificationRequirement::Preferred,
    };

    let rp = RelyingParty {
        id: rp_id.clone(),
        name: Some(rp_id.clone()),
    };

    let user = PublicKeyCredentialUserEntity {
        id: Sha256::digest(rp_id.as_bytes()).to_vec(),
        name: Some("tobari-user".to_string()),
        display_name: Some("Tobari User".to_string()),
    };

    // P-256 (ES256) is -7
    let pub_cred_params = vec![PublicKeyCredentialParameters::try_from(-7).unwrap()];

    let ctap_args = RegisterArgs {
        client_data_hash,
        relying_party: rp,
        origin: format!("https://{}", rp_id),
        user,
        pub_cred_params,
        exclude_list: Vec::new(),
        user_verification_req,
        resident_key_req: ResidentKeyRequirement::Preferred,
        extensions: AuthenticationExtensionsClientInputs::default(),
        pin: None,
        use_ctap1_fallback: false,
    };

    let (reg_tx, reg_rx) = channel();
    let callback = StateCallback::new(Box::new(move |rv| {
        let _ = reg_tx.send(rv);
    }));

    let (status_tx, _status_rx) = channel(); // Ignore status for now

    manager
        .register(60_000, ctap_args, status_tx, callback)
        .map_err(|e| format!("Authenticator register error: {:?}", e))?;

    let reg_result = reg_rx
        .recv_timeout(std::time::Duration::from_secs(60))
        .map_err(|e| format!("Authenticator timeout: {:?}", e))?;

    match reg_result {
        Ok(attestation) => {
            let auth_data = attestation.att_obj.auth_data;
            let cred_data = auth_data.credential_data.ok_or("No credential data")?;
            
            // Extract X and Y from COSE_Key (assuming P-256)
            let pub_key_bytes = cred_data.public_key; 
            let cose_key: std::collections::HashMap<i32, ciborium::value::Value> = 
                ciborium::from_reader(pub_key_bytes.as_slice())
                .map_err(|e| format!("Failed to parse COSE_Key CBOR: {:?}", e))?;

            // COSE Key Labels for P-256:
            // 1: kty (2 = EC2)
            // -1: crv (1 = P-256)
            // -2: x (byte string)
            // -3: y (byte string)
            
            let x_bytes = cose_key.get(&-2)
                .and_then(|v| v.as_bytes())
                .ok_or("Missing X coordinate in COSE_Key")?;
            let y_bytes = cose_key.get(&-3)
                .and_then(|v| v.as_bytes())
                .ok_or("Missing Y coordinate in COSE_Key")?;

            Ok(InternalRegisterResult {
                credential_id: cred_data.credential_id,
                public_key_jwk: serde_json::json!({
                    "kty": "EC",
                    "crv": "P-256",
                    "x": URL_SAFE_NO_PAD.encode(x_bytes),
                    "y": URL_SAFE_NO_PAD.encode(y_bytes)
                }),
            })
        }
        Err(e) => Err(format!("Authenticator error: {:?}", e)),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))] // Simplified for now
fn register_credential_full(
    _request: SignRequest,
    _rp_id: String,
    _client_data_hash: [u8; 32],
) -> Result<InternalRegisterResult, String> {
    Err("Registration not fully implemented on this platform in this build".to_string())
}


#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
async fn jpki_sign(app: AppHandle, request: JpkiSignRequest) -> Result<(), SignerError> {
    let reader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = JpkiController::new(reader);

    controller.select_jpki_ap().await.map_err(SignerError::from)?;

    let challenge_bytes = URL_SAFE_NO_PAD.decode(&request.challenge).map_err(|e| SignerError::Internal(e.to_string()))?;
    
    let signature = controller
        .compute_auth_signature(&request.pin, &challenge_bytes)
        .await
        .map_err(SignerError::from)?;
    
    // Output JSON and exit (MCP compatible)
    let response = SignResponse {
        signature: URL_SAFE_NO_PAD.encode(&signature),
        auth_data: None,
        client_data_json: None,
        public_key: None,
    };

    println!("{}", serde_json::to_string(&response).map_err(|e| SignerError::Serialization(e.to_string()))?);
    app.exit(0);
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
async fn read_my_number_card(request: MyNumberCardRequest) -> Result<MyNumberCardData, SignerError> {
    read_my_number_card_internal(request.pin, true, true).await
}

async fn read_my_number_card_internal(pin: String, include_my_number: bool, include_face_photo: bool) -> Result<MyNumberCardData, SignerError> {
    let mut reader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    reader.connect().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = JpkiController::new(reader);

    let my_number = if include_my_number {
        controller.read_mynumber(&pin).await.map_err(SignerError::from)?
    } else {
        "".to_string()
    };

    let info = controller
        .read_attributes(&pin)
        .await
        .map_err(SignerError::from)?;
    
    let (face_photo, face_photo_format) = if include_face_photo {
        let from_mynumber = if !my_number.is_empty() {
            controller.read_face_photo(&my_number).await.ok()
        } else {
            None
        };
        let photo = match from_mynumber {
            Some(photo) => Some(photo),
            None => controller.read_face_photo_with_pin(&pin).await.ok(),
        };
        if photo.is_none() && std::env::var("TOBARI_DEBUG").ok().as_deref() == Some("1") {
            println!("DEBUG: JPKI face photo not found (both My Number and PIN fallback failed)");
        }
        if let Some(raw) = photo {
            let (converted, format) = convert_jp2_if_needed(raw);
            (
                Some(URL_SAFE_NO_PAD.encode(converted)),
                format.map(|f| f.to_string()),
            )
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };
    
    let auth_cert = controller.read_auth_cert().await.ok();
    let sign_cert = controller.read_sign_cert().await.ok();
    
    // Read CA Certs: 000B for Auth, 0002 for Sign
    let auth_ca = controller.read_ef_full(&[0x00, 0x0B]).await.ok();
    let sign_ca = controller.read_ef_full(&[0x00, 0x02]).await.ok();

    Ok(MyNumberCardData {
        name: info.name,
        address: info.address,
        birth_date: info.birth_date,
        gender: info.gender,
        my_number,
        face_photo,
        face_photo_format,
        auth_cert: auth_cert.map(|d| URL_SAFE_NO_PAD.encode(d)),
        sign_cert: sign_cert.map(|d| URL_SAFE_NO_PAD.encode(d)),
        auth_ca_cert: auth_ca.map(|d| URL_SAFE_NO_PAD.encode(d)),
        sign_ca_cert: sign_ca.map(|d| URL_SAFE_NO_PAD.encode(d)),
    })
}

#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
async fn read_passport(request: PassportReadRequest) -> Result<PassportData, SignerError> {
    read_passport_internal(request.mrz).await
}

async fn read_passport_internal(mrz: String) -> Result<PassportData, SignerError> {
    let mut reader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    reader.connect().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = PassportController::new(reader);

    debug_log("Passport: selecting ICAO applet");
    controller.select_ep_ap().await.map_err(|e| SignerError::Jpki(e.to_string()))?;
    debug_log("Passport: starting BAC");
    let mrz_key = normalize_mrz_for_bac(&mrz)?;
    debug_log(&format!("Passport: MRZ key length {}", mrz_key.len()));
    controller.perform_bac(&mrz_key).await.map_err(|e| SignerError::Jpki(e.to_string()))?;
    debug_log("Passport: BAC complete, reading DG1");
    
    let dg1 = controller.read_dg1().await.map_err(|e| SignerError::Jpki(e.to_string()))?;
    debug_log(&format!("Passport: DG1 read ({} bytes)", dg1.len()));
    let dg2 = controller.read_dg2().await.map_err(|e| SignerError::Jpki(e.to_string()))?;
    debug_log(&format!("Passport: DG2 read ({} bytes)", dg2.len()));
    let sod = controller.read_sod().await.ok();
    let dg11 = controller.read_dg11().await.ok();
    let dg12 = controller.read_dg12().await.ok();
    let dg14 = controller.read_dg14().await.ok();
    let dg15 = controller.read_dg15().await.ok();

    let mrz_text = extract_mrz_from_dg1(&dg1);
    let parsed = mrz_text
        .as_deref()
        .and_then(|m| civ::utils::MrzUtils::parse_mrz_td3(m).ok());

    let (face_photo, face_photo_format) = extract_photo_from_dg2(&dg2)
        .map(|raw| {
            let (converted, format) = convert_jp2_if_needed(raw);
            (Some(URL_SAFE_NO_PAD.encode(converted)), format.map(|f| f.to_string()))
        })
        .unwrap_or((None, None));

    Ok(PassportData {
        dg1: URL_SAFE_NO_PAD.encode(dg1),
        dg2: URL_SAFE_NO_PAD.encode(dg2),
        mrz: mrz_text,
        name: parsed.as_ref().map(|p| p.full_name.clone()),
        passport_number: parsed.as_ref().map(|p| p.identity_number.clone()),
        birth_date: parsed.as_ref().map(|p| p.birth_date.clone()),
        expiry_date: parsed
            .as_ref()
            .and_then(|p| p.expiration_date.clone()),
        gender: parsed.as_ref().map(|p| p.gender.clone()),
        nationality: parsed
            .as_ref()
            .and_then(|p| p.issuing_authority.clone()),
        face_photo,
        face_photo_format,
        sod: sod.map(|d| URL_SAFE_NO_PAD.encode(d)),
        dg11: dg11.map(|d| URL_SAFE_NO_PAD.encode(d)),
        dg12: dg12.map(|d| URL_SAFE_NO_PAD.encode(d)),
        dg14: dg14.map(|d| URL_SAFE_NO_PAD.encode(d)),
        dg15: dg15.map(|d| URL_SAFE_NO_PAD.encode(d)),
    })
}

fn extract_mrz_from_dg1(dg1: &[u8]) -> Option<String> {
    fn find_mrz_tlv(tlvs: &[civ::utils::BerTlv]) -> Option<Vec<u8>> {
        for tlv in tlvs {
            if tlv.tag == 0x5F1F {
                return Some(tlv.value.clone());
            }
            if let Some(value) = find_mrz_tlv(&tlv.children) {
                return Some(value);
            }
        }
        None
    }

    if let Ok(tlvs) = civ::utils::parse_ber_tlv(dg1) {
        if let Some(value) = find_mrz_tlv(&tlvs) {
            let mut mrz = String::from_utf8_lossy(&value).to_string();
            mrz = mrz.replace('\r', "").replace('\n', "");
            if mrz.len() == 88 {
                mrz.insert(44, '\n');
            }
            return Some(mrz);
        }
    }

    let needle_td3 = [b'P', b'<'];
    let needle_td1 = [b'I', b'<'];
    let pos = dg1
        .windows(2)
        .position(|w| w == needle_td3 || w == needle_td1)?;
    let slice = &dg1[pos..];
    let mut mrz: String = slice
        .iter()
        .map(|b| if b.is_ascii() { *b as char } else { ' ' })
        .collect();
    mrz = mrz.replace('\r', "").replace('\n', "");
    if mrz.len() >= 90 {
        mrz.truncate(90);
    } else if mrz.len() >= 88 {
        mrz.truncate(88);
    }
    if mrz.len() == 88 {
        mrz.insert(44, '\n');
    }
    Some(mrz)
}

fn extract_photo_from_dg2(dg2: &[u8]) -> Option<Vec<u8>> {
    let jpeg_sig = [0xFF, 0xD8, 0xFF];
    if let Some(pos) = dg2.windows(jpeg_sig.len()).position(|w| w == jpeg_sig) {
        return Some(dg2[pos..].to_vec());
    }
    let jp2_sig = [0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20];
    if let Some(pos) = dg2.windows(jp2_sig.len()).position(|w| w == jp2_sig) {
        return Some(dg2[pos..].to_vec());
    }
    let j2k_sig = [0xFF, 0x4F];
    if let Some(pos) = dg2.windows(j2k_sig.len()).position(|w| w == j2k_sig) {
        return Some(dg2[pos..].to_vec());
    }
    None
}

fn normalize_mrz_for_bac(input: &str) -> Result<String, SignerError> {
    let trimmed = input.trim();
    let normalized_input = trimmed
        .replace('\r', "\n")
        .replace(' ', "")
        .replace('\t', "")
        .to_ascii_uppercase();

    let lines: Vec<&str> = normalized_input
        .lines()
        .filter(|l| !l.trim().is_empty())
        .collect();
    debug_log(&format!(
        "Passport: MRZ input len={}, lines={}, line_lens={:?}",
        normalized_input.len(),
        lines.len(),
        lines.iter().map(|l| l.len()).collect::<Vec<_>>()
    ));

    if lines.len() == 2 {
        let mut line2 = lines[1].to_string();
        if line2.len() < 44 {
            line2.push_str(&"<".repeat(44 - line2.len()));
        }
        if line2.len() >= 44 {
            let line2 = line2.as_str();
            let doc_no = line2[0..9].to_string();
            let birth = line2[13..19].to_string();
            let expiry = line2[21..27].to_string();
            return Ok(format_bac_key(&doc_no, &birth, &expiry));
        }
    }

    if lines.len() == 3 {
        let mut line1 = lines[0].to_string();
        let mut line2 = lines[1].to_string();
        if line1.len() < 30 {
            line1.push_str(&"<".repeat(30 - line1.len()));
        }
        if line2.len() < 30 {
            line2.push_str(&"<".repeat(30 - line2.len()));
        }
        if line1.len() >= 30 && line2.len() >= 30 {
            let line1 = line1.as_str();
            let line2 = line2.as_str();
            let doc_no = line1[0..9].to_string();
            let birth = line2[0..6].to_string();
            let expiry = line2[8..14].to_string();
            return Ok(format_bac_key(&doc_no, &birth, &expiry));
        }
    }

    if lines.len() == 1 {
        let line = lines[0];
        if line.len() >= 88 && line.starts_with("P<") {
            let slice = &line[0..88];
            let line2 = &slice[44..88];
            let doc_no = line2[0..9].to_string();
            let birth = line2[13..19].to_string();
            let expiry = line2[21..27].to_string();
            return Ok(format_bac_key(&doc_no, &birth, &expiry));
        } else if line.len() >= 90 {
            let slice = &line[0..90];
            let line1 = &slice[0..30];
            let line2 = &slice[30..60];
            let doc_no = line1[0..9].to_string();
            let birth = line2[0..6].to_string();
            let expiry = line2[8..14].to_string();
            return Ok(format_bac_key(&doc_no, &birth, &expiry));
        }
    }

    let cleaned: String = normalized_input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '<')
        .collect();
    debug_log(&format!("Passport: MRZ cleaned len={}", cleaned.len()));

    if cleaned.len() == 24 {
        return Ok(cleaned);
    }

    let (doc_no, birth, expiry) = if cleaned.len() == 21 {
        (
            cleaned[0..9].to_string(),
            cleaned[9..15].to_string(),
            cleaned[15..21].to_string(),
        )
    } else if cleaned.len() == 20 {
        let mut doc = cleaned[0..8].to_string();
        doc.push('<');
        (
            doc,
            cleaned[8..14].to_string(),
            cleaned[14..20].to_string(),
        )
    } else {
        return Err(SignerError::Jpki(
            "Invalid MRZ length. Expected 20, 21, or 24 characters.".to_string(),
        ));
    };

    Ok(format_bac_key(&doc_no, &birth, &expiry))
}

fn format_bac_key(doc_no: &str, birth: &str, expiry: &str) -> String {
    let doc_cd = civ::utils::MrzUtils::calculate_check_digit(doc_no) as char;
    let birth_cd = civ::utils::MrzUtils::calculate_check_digit(birth) as char;
    let expiry_cd = civ::utils::MrzUtils::calculate_check_digit(expiry) as char;
    format!(
        "{}{}{}{}{}{}",
        doc_no, doc_cd, birth, birth_cd, expiry, expiry_cd
    )
}

#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
async fn read_driver_license(request: DriverLicenseRequest) -> Result<DriverLicenseData, SignerError> {
    let mut reader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    reader.connect().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = DriversLicenseController::new(reader);

    controller.select_dl_ap().await.map_err(|e| SignerError::Jpki(e.to_string()))?;
    controller.verify_pin1(&request.pin1).await.map_err(SignerError::from)?;
    controller.verify_pin2(&request.pin2).await.map_err(SignerError::from)?;

    // Re-select DL AP (DF1) after PIN verification, as verify_pin might have moved to MF/IEF
    controller.select_dl_ap().await.map_err(|e| SignerError::Jpki(format!("Failed to re-select DL AP: {}", e)))?;

    // Use raw EF read for Group 1 (common data)
    let raw_dg1 = controller.read_ef_full(&[0x00, 0x01]).await
        .map_err(|e| SignerError::Jpki(format!("Failed to read EF01: {}", e)))?;
    
    debug_log(&format!("Raw EF01 total size: {} bytes", raw_dg1.len()));
    
    if raw_dg1.is_empty() {
        return Err(SignerError::Jpki("Read EF01 but it was empty".to_string()));
    }

    let info = controller.parse_common_data(&raw_dg1).map_err(SignerError::from)?;
    let signature = controller.read_signature().await.ok();
    
    // Read photo if PIN2 is likely valid
    let face_photo_raw = controller.read_photo().await.ok();
    if let Some(ref photo) = face_photo_raw {
        debug_log(&format!("Face photo raw size: {} bytes", photo.len()));
    }
    let (face_photo, face_photo_format) = face_photo_raw
        .map(|d| {
            let (converted, format) = convert_jp2_if_needed(d);
            (Some(URL_SAFE_NO_PAD.encode(converted)), format.map(|f| f.to_string()))
        })
        .unwrap_or((None, None));

    Ok(DriverLicenseData {
        name: info.name,
        name_kana: info.name_kana,
        address: info.address,
        birth_date: info.birth_date,
        license_number: info.license_number,
        issue_date: info.issue_date,
        expire_date: info.expire_date,
        face_photo,
        face_photo_format,
        signature: signature.map(|d| URL_SAFE_NO_PAD.encode(d)),
        raw_data_group1: Some(URL_SAFE_NO_PAD.encode(raw_dg1)),
    })
}

fn debug_log(message: &str) {
    if std::env::var("TOBARI_DEBUG").ok().as_deref() == Some("1") {
        println!("DEBUG: {}", message);
    }
}

fn is_jpeg(data: &[u8]) -> bool {
    data.len() >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF
}

fn is_jp2(data: &[u8]) -> bool {
    let sig = [0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20];
    data.windows(sig.len()).any(|w| w == sig)
}

fn is_j2k_codestream(data: &[u8]) -> bool {
    data.len() >= 2 && data[0] == 0xFF && data[1] == 0x4F
}

fn normalize_jp2_payload(data: Vec<u8>) -> Vec<u8> {
    if let Some(offset) = find_jp2_signature_offset(&data) {
        return data[offset..].to_vec();
    }
    if let Some(offset) = find_j2k_soc_offset(&data) {
        return data[offset..].to_vec();
    }
    data
}

fn find_jp2_signature_offset(data: &[u8]) -> Option<usize> {
    let sig = [0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20, 0x0D, 0x0A, 0x87, 0x0A];
    data.windows(sig.len()).position(|w| w == sig)
}

fn find_j2k_soc_offset(data: &[u8]) -> Option<usize> {
    data.windows(2).position(|w| w[0] == 0xFF && w[1] == 0x4F)
}

fn convert_jp2_if_needed(data: Vec<u8>) -> (Vec<u8>, Option<&'static str>) {
    if is_jpeg(&data) {
        return (data, Some("jpeg"));
    }

    let mut source = normalize_jp2_payload(data);
    if is_j2k_codestream(&source) && !is_jp2(&source) {
        if let Some(wrapped) = wrap_j2k_as_jp2(&source) {
            source = wrapped;
        }
    }

    #[cfg(target_os = "macos")]
    {
        match convert_jp2_to_jpeg(&source) {
            Ok(jpeg) => {
                debug_log(&format!("JP2 converted to JPEG: {} bytes", jpeg.len()));
                return (jpeg, Some("jpeg"));
            }
            Err(err) => {
                debug_log(&format!("JP2 conversion failed: {}", err));
            }
        }
    }

    let fallback_format = if is_jp2(&source) || is_j2k_codestream(&source) {
        Some("jp2")
    } else {
        None
    };

    (source, fallback_format)
}

#[cfg(target_os = "macos")]
fn convert_jp2_to_jpeg(data: &[u8]) -> Result<Vec<u8>, SignerError> {
    use std::process::Command;

    let temp_dir = std::env::temp_dir();
    let id = uuid::Uuid::new_v4().to_string();
    let output_path = temp_dir.join(format!("tobari-dl-{}.jpg", id));

    let candidates = if is_j2k_codestream(data) {
        vec!["j2k", "jp2"]
    } else if is_jp2(data) {
        vec!["jp2", "j2k"]
    } else {
        vec!["j2k", "jp2"]
    };

    let mut last_err: Option<String> = None;

    for ext in candidates {
        let input_path = temp_dir.join(format!("tobari-dl-{}.{}", id, ext));
        std::fs::write(&input_path, data).map_err(|e| {
            SignerError::Internal(format!("Failed to write {} temp file: {e}", ext))
        })?;

        let input_str = input_path
            .to_str()
            .ok_or_else(|| SignerError::Internal("Failed to format JP2 temp path".to_string()))?;
        let output_str = output_path
            .to_str()
            .ok_or_else(|| SignerError::Internal("Failed to format JPEG temp path".to_string()))?;

        let output = Command::new("/usr/bin/sips")
            .args(["-s", "format", "jpeg", input_str, "--out", output_str])
            .output()
            .map_err(|e| SignerError::Internal(format!("Failed to run sips: {e}")))?;

        let _ = std::fs::remove_file(&input_path);

        if output.status.success() {
            let jpeg = std::fs::read(&output_path)
                .map_err(|e| SignerError::Internal(format!("Failed to read JPEG output: {e}")))?;
            let _ = std::fs::remove_file(&output_path);
            println!("DEBUG: JP2 conversion succeeded with input .{}", ext);
            return Ok(jpeg);
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        last_err = Some(format!("sips failed for .{}: {}", ext, stderr));
    }

    Err(SignerError::Internal(
        last_err.unwrap_or_else(|| "sips failed".to_string()),
    ))
}

fn wrap_j2k_as_jp2(codestream: &[u8]) -> Option<Vec<u8>> {
    let (width, height, components, bpc) = parse_j2k_siz(codestream)?;

    let mut jp2 = Vec::new();
    jp2.extend_from_slice(&jp2_signature_box());
    jp2.extend_from_slice(&jp2_file_type_box());
    jp2.extend_from_slice(&jp2_header_box(width, height, components, bpc));
    jp2.extend_from_slice(&jp2_codestream_box(codestream));
    Some(jp2)
}

fn parse_j2k_siz(data: &[u8]) -> Option<(u32, u32, u16, u8)> {
    let mut i = 0;
    while i + 4 < data.len() {
        if data[i] == 0xFF && data[i + 1] == 0x51 {
            if i + 4 >= data.len() {
                return None;
            }
            let lsiz = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
            if i + 2 + lsiz > data.len() || lsiz < 38 {
                return None;
            }
            let base = i + 4;
            let xsiz = u32::from_be_bytes([data[base + 2], data[base + 3], data[base + 4], data[base + 5]]);
            let ysiz = u32::from_be_bytes([data[base + 6], data[base + 7], data[base + 8], data[base + 9]]);
            let xosiz = u32::from_be_bytes([data[base + 10], data[base + 11], data[base + 12], data[base + 13]]);
            let yosiz = u32::from_be_bytes([data[base + 14], data[base + 15], data[base + 16], data[base + 17]]);
            let csiz = u16::from_be_bytes([data[base + 30], data[base + 31]]);

            let width = xsiz.saturating_sub(xosiz);
            let height = ysiz.saturating_sub(yosiz);
            if width == 0 || height == 0 || csiz == 0 {
                return None;
            }

            let first_ssiz_offset = base + 32;
            if first_ssiz_offset >= data.len() {
                return None;
            }
            let first_ssiz = data[first_ssiz_offset];
            let bpc = (first_ssiz & 0x7F).saturating_add(1);
            let bpc_field = bpc.saturating_sub(1);

            return Some((width, height, csiz, bpc_field));
        }
        i += 1;
    }
    None
}

fn make_box(typ: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let len = (8 + data.len()) as u32;
    let mut out = Vec::with_capacity(len as usize);
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(typ);
    out.extend_from_slice(data);
    out
}

fn jp2_signature_box() -> Vec<u8> {
    let mut out = Vec::with_capacity(12);
    out.extend_from_slice(&12u32.to_be_bytes());
    out.extend_from_slice(b"jP  ");
    out.extend_from_slice(&[0x0D, 0x0A, 0x87, 0x0A]);
    out
}

fn jp2_file_type_box() -> Vec<u8> {
    let mut data = Vec::new();
    data.extend_from_slice(b"jp2 ");
    data.extend_from_slice(&0u32.to_be_bytes());
    data.extend_from_slice(b"jp2 ");
    make_box(b"ftyp", &data)
}

fn jp2_header_box(width: u32, height: u32, components: u16, bpc: u8) -> Vec<u8> {
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&components.to_be_bytes());
    ihdr.push(bpc);
    ihdr.push(7); // compression type: JPEG2000
    ihdr.push(0); // unknown colorspace
    ihdr.push(0); // intellectual property
    let ihdr_box = make_box(b"ihdr", &ihdr);

    let mut colr = Vec::new();
    colr.push(1); // meth: enumerated
    colr.push(0); // precedence
    colr.push(0); // approximation
    colr.extend_from_slice(&17u32.to_be_bytes()); // grayscale
    let colr_box = make_box(b"colr", &colr);

    let mut jp2h = Vec::new();
    jp2h.extend_from_slice(&ihdr_box);
    jp2h.extend_from_slice(&colr_box);
    make_box(b"jp2h", &jp2h)
}

fn jp2_codestream_box(codestream: &[u8]) -> Vec<u8> {
    make_box(b"jp2c", codestream)
}

#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
async fn read_residence_card() -> Result<serde_json::Value, SignerError> {
    let mut reader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    reader.connect().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = ResidenceCardController::new(reader);

    controller.select_df2().await.map_err(|e| SignerError::Jpki(e.to_string()))?;
    let info = controller.read_df2_info().await.map_err(SignerError::from)?;

    Ok(serde_json::to_value(&info).unwrap())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BbsKeyPair {
    pub secret_key: String, // Base64
    pub public_key: String, // Base64
}

#[tauri::command]
fn bbs_generate_key() -> Result<BbsKeyPair, SignerError> {
    use bbs::prelude::*;
    let (pk, sk) = Issuer::new_keys(1).map_err(|e| SignerError::Internal(format!("{:?}", e)))?;
    
    // Fallback to serde if to_bytes is private/not found
    let sk_json = serde_json::to_value(&sk).map_err(|e| SignerError::Serialization(e.to_string()))?;
    let pk_json = serde_json::to_value(&pk).map_err(|e| SignerError::Serialization(e.to_string()))?;

    Ok(BbsKeyPair {
        secret_key: sk_json.to_string(),
        public_key: pk_json.to_string(),
    })
}

#[tauri::command]
async fn perform_bbs_proof(
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

fn bbs_derive_proof(
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
    
    // 1. Prepare messages classification
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

    // 2. Create Proof Request
    let request = ProofRequest {
        revealed_messages: revealed_indices_set,
        verification_key: pk,
    };

    // 3. Commit to signature PoK
    let pok_context = Prover::commit_signature_pok(&request, &proof_messages, &signature)
        .map_err(|e| SignerError::Internal(format!("PoK commit error: {:?}", e)))?;

    // 4. Create challenge hash
    let nonce_val = ProofNonce::hash(nonce.as_bytes());
    let challenge_hash = Prover::create_challenge_hash(&[pok_context.clone()], None, &nonce_val)
        .map_err(|e| SignerError::Internal(format!("Challenge hash error: {:?}", e)))?;

    // 5. Generate the proof
    let proof = Prover::generate_signature_pok(pok_context, &challenge_hash)
        .map_err(|e| SignerError::Internal(format!("Proof generation error: {:?}", e)))?;

    // Use JSON for proof output as to_bytes is private
    serde_json::to_string(&proof).map_err(|e| SignerError::Serialization(e.to_string()))
}

pub async fn handle_unified_request(request: &UnifiedRequest) -> UnifiedResponse {
    match request.command.as_str() {
        "inspect_document" => handle_inspect_document(request).await,
        "read_card" => handle_read_card(request).await,
        "register_device" => handle_register_device(request).await,
        "sign_with_bbs" => handle_bbs_sign(request).await,
        "bbs_generate_key" => handle_bbs_generate_key(request).await,
        "sign_data" => handle_sign_data(request).await,
        "sign_presentation" => handle_sign_presentation(request).await,
        _ => UnifiedResponse::error(
            &request.command,
            "UnsupportedCommand",
            &format!("Command '{}' is not supported in unified mode", request.command),
        ),
    }
}

// --- Wallet Storage Logic ---

pub fn get_tobari_home() -> std::path::PathBuf {
    if let Ok(env_path) = std::env::var("TOBARI_HOME") {
        return std::path::PathBuf::from(env_path);
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    #[cfg(target_os = "macos")]
    {
        home.join("Documents").join("Tobari")
    }
    #[cfg(target_os = "windows")]
    {
        home.join("Documents").join("Tobari")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        home.join(".tobari")
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WalletCredential {
    pub name: String,
    pub path: String,
    pub doc_type: String,
    pub created_at: Option<u64>,
}

#[tauri::command]
async fn get_wallet_credentials() -> Result<Vec<WalletCredential>, SignerError> {
    let credentials_dir = get_tobari_home().join("credentials");
    if !credentials_dir.exists() {
        std::fs::create_dir_all(&credentials_dir).map_err(|e| SignerError::Internal(e.to_string()))?;
        return Ok(vec![]);
    }

    let mut list = Vec::new();
    let entries = std::fs::read_dir(credentials_dir).map_err(|e| SignerError::Internal(e.to_string()))?;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "cose") {
                // Try to extract docType by decoding the COSE structure (minimal decode)
                let file = std::fs::File::open(&path).map_err(|e| SignerError::Internal(e.to_string()))?;
                let doc_type = match ciborium::from_reader::<ciborium::value::Value, _>(file) {
                    Ok(val) => {
                        // Handle potential Tag wrapping (e.g. Tag 98)
                        let mut current = &val;
                        while let ciborium::value::Value::Tag(_tag, box_val) = current {
                            current = box_val.as_ref();
                        }
                        
                        if let Some(map) = current.as_map() {
                            map.iter()
                                .find(|(k, _)| k.as_text() == Some("docType"))
                                .and_then(|(_, v)| v.as_text())
                                .unwrap_or("Unknown")
                                .to_string()
                        } else {
                            "Unknown".to_string()
                        }
                    }
                    Err(_) => "Unknown".to_string(),
                };

                let metadata = entry.metadata().ok();
                let created_at = metadata.and_then(|m| m.created().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());

                list.push(WalletCredential {
                    name: path.file_name().and_then(|n| n.to_str()).unwrap_or("Unknown").to_string(),
                    path: path.to_string_lossy().to_string(),
                    doc_type,
                    created_at,
                });
            }
        }
    }

    Ok(list)
}

#[tauri::command]
async fn save_to_wallet(name: String, doc_type: String, data: serde_json::Value) -> Result<String, SignerError> {
    let credentials_dir = get_tobari_home().join("credentials");
    if !credentials_dir.exists() {
        std::fs::create_dir_all(&credentials_dir).map_err(|e| SignerError::Internal(e.to_string()))?;
    }

    // Generate a simple mdoc-like structure (for now, wrapping the data in a map)
    // In a full implementation, this would use tobari-gen logic
    let mut mdoc = serde_json::Map::new();
    mdoc.insert("docType".to_string(), serde_json::Value::String(doc_type.clone()));
    mdoc.insert("version".to_string(), serde_json::Value::String("1.0".to_string()));
    mdoc.insert("data".to_string(), data);
    
    let file_name = format!("{}.cose", name.replace(" ", "_").to_lowercase());
    let file_path = credentials_dir.join(&file_name);
    
    // Encode as CBOR (COSE-like)
    let mut buf = Vec::new();
    ciborium::into_writer(&serde_json::Value::Object(mdoc), &mut buf)
        .map_err(|e| SignerError::Serialization(e.to_string()))?;
    
    std::fs::write(&file_path, buf).map_err(|e| SignerError::Internal(e.to_string()))?;
    
    Ok(file_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args = Cli::parse();
    
    // Ensure TOBARI_HOME structure exists
    let home = get_tobari_home();
    for sub in ["credentials", "requests", "data", "history", "config"] {
        let _ = std::fs::create_dir_all(home.join(sub));
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            request: Mutex::new(None),
            allow_credentials: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_pending_request,
            perform_sign,
            perform_register,
            reject,
            jpki_sign,
            read_my_number_card,
            read_passport,
            read_driver_license,
            read_residence_card,
            bbs_generate_key,
            perform_bbs_proof,
            get_wallet_credentials,
            save_to_wallet
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sign_request_deserialization() {
        let json = r#"{
                    "challenge": "dGVzdC1jaGFsbGVuZ2U",
                    "rp_id": "example.com",
                    "user_verification": "required",
                    "message": "Sign this please"
                }"#;

        let req: SignRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.challenge, "dGVzdC1jaGFsbGVuZ2U");
        assert_eq!(req.rp_id, "example.com");
        assert_eq!(req.user_verification.as_deref(), Some("required"));
        assert_eq!(req.message.as_deref(), Some("Sign this please"));
    }

    #[test]
    fn test_sign_request_minimal() {
        let json = r#"{
                    "challenge": "dGVzdC1jaGFsbGVuZ2U",
                    "rp_id": "example.com"
                }"#;

        let req: SignRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.challenge, "dGVzdC1jaGFsbGVuZ2U");
        assert!(req.user_verification.is_none());
        assert!(req.message.is_none());
    }
}
