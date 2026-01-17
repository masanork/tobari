use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PassportReadRequest {
    pub mrz: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PassportData {
    pub dg1: String,
    pub dg2: String,
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
    pub face_photo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub face_photo_format: Option<String>,
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
    pub face_photo: Option<String>,
    pub face_photo_format: Option<String>,
    pub signature: Option<String>,
    pub raw_data_group1: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JpkiSignRequest {
    pub challenge: String,
    pub pin: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MyNumberCardRequest {
    pub pin: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MyNumberCardData {
    pub name: String,
    pub address: String,
    pub birth_date: String,
    pub gender: String,
    pub my_number: String,
    pub face_photo: Option<String>,
    pub face_photo_format: Option<String>,
    pub auth_cert: Option<String>,
    pub sign_cert: Option<String>,
    pub auth_ca_cert: Option<String>,
    pub sign_ca_cert: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SignRequest {
    pub challenge: String,
    pub rp_id: String,
    pub user_verification: Option<String>,
    pub message: Option<String>,
    pub allow_credentials: Option<Vec<CredentialDescriptor>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CredentialDescriptor {
    pub type_: String,
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SignResponse {
    pub signature: String,
    #[serde(rename = "authData", skip_serializing_if = "Option::is_none")]
    pub auth_data: Option<String>,
    #[serde(rename = "clientDataJSON", skip_serializing_if = "Option::is_none")]
    pub client_data_json: Option<String>,
    #[serde(rename = "publicKey", skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
}

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
    pub card_type: String,
    pub pin: Option<String>,
    pub pin1: Option<String>,
    pub pin2: Option<String>,
    pub mrz: Option<String>,
    pub can: Option<String>,
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
    pub challenge: String,
    pub output_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SignDataParams {
    pub data: String,
    pub algorithm: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BbsKeyPair {
    pub secret_key: String,
    pub public_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WalletCredential {
    pub name: String,
    pub path: String,
    pub doc_type: String,
    pub created_at: Option<u64>,
}

pub struct AssertionResult {
    pub credential_id: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub signature: Vec<u8>,
    pub user_handle: Option<Vec<u8>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RegisterResponse {
    #[serde(rename = "credentialId")]
    pub credential_id: String,
    #[serde(rename = "publicKey")]
    pub public_key: serde_json::Value,
}

pub struct InternalRegisterResult {
    pub credential_id: Vec<u8>,
    pub public_key_jwk: serde_json::Value,
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
    #[error("Invalid data: {0}")]
    InvalidData(String),
    #[error("No pending request found.")]
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