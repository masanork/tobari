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
    /// JSON string of the sign request
    #[arg(long, value_parser)]
    request: Option<String>,

    /// Path to a file containing the sign request JSON
    #[arg(long, value_parser)]
    file: Option<String>,

    /// Generate a BBS+ key pair and exit
    #[arg(long)]
    bbs_generate_key: bool,
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
    let reader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = JpkiController::new(reader);

    let my_number = controller.read_mynumber(&request.pin).await.map_err(SignerError::from)?;
    let info = controller
        .read_attributes(&request.pin)
        .await
        .map_err(SignerError::from)?;

    Ok(MyNumberCardData {
        name: info.name,
        address: info.address,
        birth_date: info.birth_date,
        gender: info.gender,
        my_number,
        face_photo: info.face_photo,
    })
}

#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
async fn read_passport(request: PassportReadRequest) -> Result<PassportData, SignerError> {
    let reader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = PassportController::new(reader);

    controller.perform_bac(&request.mrz).await.map_err(|e| SignerError::Jpki(e.to_string()))?;
    
    let dg1 = controller.read_dg1().await.map_err(|e| SignerError::Jpki(e.to_string()))?;
    let dg2 = controller.read_dg2().await.map_err(|e| SignerError::Jpki(e.to_string()))?;

    Ok(PassportData {
        dg1: URL_SAFE_NO_PAD.encode(dg1),
        dg2: URL_SAFE_NO_PAD.encode(dg2),
    })
}

#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
async fn read_driver_license(request: DriverLicenseRequest) -> Result<DriverLicenseData, SignerError> {
    let reader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
    let mut controller = DriversLicenseController::new(reader);

    controller.select_dl_ap().await.map_err(|e| SignerError::Jpki(e.to_string()))?;
    controller.verify_pin1(&request.pin1).await.map_err(SignerError::from)?;
    controller.verify_pin2(&request.pin2).await.map_err(SignerError::from)?;

    let info = controller.read_common_data().await.map_err(SignerError::from)?;

    Ok(DriverLicenseData {
        name: info.name,
        name_kana: info.name_kana,
        address: info.address,
        birth_date: info.birth_date,
        license_number: info.license_number,
        issue_date: info.issue_date,
        expire_date: info.expire_date,
    })
}

#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
async fn read_residence_card() -> Result<serde_json::Value, SignerError> {
    let reader = PcscReader::new().map_err(|e| SignerError::Jpki(e.to_string()))?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args = Cli::parse();

    if args.bbs_generate_key {
        match bbs_generate_key() {
            Ok(keys) => {
                println!("{}", serde_json::to_string(&keys).unwrap());
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("BBS Keygen failed: {:?}", e);
                std::process::exit(1);
            }
        }
    }

    let sign_request = if let Some(req_str) = args.request {
        serde_json::from_str::<SignRequest>(&req_str).ok()
    } else if let Some(file_path) = args.file {
        std::fs::read_to_string(file_path)
            .ok()
            .and_then(|s| serde_json::from_str::<SignRequest>(&s).ok())
    } else {
        None
    };

    if sign_request.is_none() {
        // If no request provided via CLI, maybe we are in dev mode or just testing.
        eprintln!("No valid sign request provided via arguments.");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            request: Mutex::new(sign_request),
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
            perform_bbs_proof
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
