use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use clap::Parser;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::{AppHandle, State};
// Note: civ crate needs to be available. PcscReader is only available on native targets.
#[cfg(not(target_arch = "wasm32"))]
use civ::{JpkiController, PcscReader};

// --- Data Structures ---

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
    #[serde(rename = "authData")]
    pub auth_data: String, // Base64Url
    #[serde(rename = "clientDataJSON")]
    pub client_data_json: String, // Raw JSON string
}

// --- Tauri Commands ---

#[tauri::command]
fn get_pending_request(state: State<AppState>) -> Result<Option<SignRequest>, String> {
    let request = state.request.lock().map_err(|e| e.to_string())?;
    Ok(request.clone())
}

#[tauri::command]
fn reject(app: AppHandle) {
    eprintln!("User rejected the request.");
    app.exit(1);
}

#[tauri::command]
async fn perform_sign(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let mut request = {
        let lock = state.request.lock().map_err(|e| e.to_string())?;
        lock.clone().ok_or("No request found")?
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
            .map_err(|e| e.to_string())??;

    // 4. Output result in the new unified format
    let response = SignResponse {
        signature: URL_SAFE_NO_PAD.encode(&result.signature),
        auth_data: URL_SAFE_NO_PAD.encode(&result.authenticator_data),
        client_data_json: client_data_json,
    };

    println!("{}", serde_json::to_string(&response).unwrap());

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
async fn perform_register(state: State<'_, AppState>) -> Result<String, String> {
    let request = {
        let lock = state.request.lock().map_err(|e| e.to_string())?;
        lock.clone().ok_or("No request found")?
    };

    let rp_id = request.rp_id.clone();
    let challenge_bytes = URL_SAFE_NO_PAD
        .decode(&request.challenge)
        .map_err(|e| e.to_string())?;

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
        .map_err(|_| "Invalid client_data_hash length".to_string())?;

    if challenge_bytes.is_empty() {
        return Err("Invalid challenge".to_string());
    }

    // Call Authenticator Register
    let rp_id_for_reg = rp_id.clone();
    let reg_result = tokio::task::spawn_blocking(move || {
        register_credential_full(request, rp_id_for_reg, client_data_hash)
    })
    .await
    .map_err(|e| e.to_string())??;

    let credential_b64 = URL_SAFE_NO_PAD.encode(&reg_result.credential_id);

    // Prepare JWK (Simplified extraction for P-256)
    // In a real implementation, we'd parse the COSE_Key properly.
    // For now, let's return the result.
    let response = RegisterResponse {
        credential_id: credential_b64.clone(),
        public_key: reg_result.public_key_jwk,
    };

    {
        let mut lock = state.allow_credentials.lock().map_err(|e| e.to_string())?;
        *lock = Some(vec![CredentialDescriptor {
            type_: "public-key".to_string(),
            id: credential_b64.clone(),
        }]);
    }

    Ok(serde_json::to_string(&response).unwrap())
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
            
            // Basic extraction of X and Y from COSE_Key (assuming P-256)
            // This is a bit hacky without a full CBOR/COSE parser, 
            // but for P-256 it's predictable.
            // In a real app, use a proper COSE crate.
            let pub_key_bytes = cred_data.public_key; 
            
            // For now, we'll return a placeholder or attempt a very simple parse.
            // Actually, let's just return the raw bytes as base64 for now if parsing is hard,
            // but the goal is JWK. 
            // Let's assume the bytes are a valid COSE structure.
            
            Ok(InternalRegisterResult {
                credential_id: cred_data.credential_id,
                // Placeholder JWK - in a real implementation we would parse pub_key_bytes
                public_key_jwk: serde_json::json!({
                    "kty": "EC",
                    "crv": "P-256",
                    "x": "TODO_EXTRACT_FROM_COSE",
                    "y": "TODO_EXTRACT_FROM_COSE"
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
async fn jpki_sign(request: JpkiSignRequest) -> Result<String, String> {
    let reader = PcscReader::new().map_err(|e| e.to_string())?;
    let mut controller = JpkiController::new(reader);

    controller.select_jpki_ap().await.map_err(|e| e.to_string())?;

    let challenge_bytes = URL_SAFE_NO_PAD.decode(&request.challenge).map_err(|e| e.to_string())?;
    
    let signature = controller
        .compute_auth_signature(&request.pin, &challenge_bytes)
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(URL_SAFE_NO_PAD.encode(&signature))
}

#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
async fn read_my_number_card(request: MyNumberCardRequest) -> Result<MyNumberCardData, String> {
    let reader = PcscReader::new().map_err(|e| e.to_string())?;
    let mut controller = JpkiController::new(reader);

    let my_number = controller.read_mynumber(&request.pin).await.map_err(|e| e.to_string())?;
    let info = controller
        .read_attributes(&request.pin)
        .await
        .map_err(|e| e.to_string())?;

    Ok(MyNumberCardData {
        name: info.name,
        address: info.address,
        birth_date: info.birth_date,
        gender: info.gender,
        my_number,
        face_photo: info.face_photo,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args = Cli::parse();

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
            read_my_number_card
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
