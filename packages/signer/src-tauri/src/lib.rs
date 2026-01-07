use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use clap::Parser;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
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
    let mut manager = authenticator::Authenticator::new();
    // Set timeout
    // manager.set_timeout(...)

    // Convert allow_credentials if present
    let allowed_creds = request
        .allow_credentials
        .as_ref()
        .map(|creds| {
            creds
                .iter()
                .map(|c| authenticator::state::Descriptor {
                    media_type: authenticator::state::MediaType::PublicKey,
                    id: URL_SAFE_NO_PAD.decode(&c.id).unwrap_or_default(),
                    transports: None,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    // This is a simplified call. `authenticator` crate usually requires a callback for user presence.
    // For platform authenticators (TouchID/Windows Hello), it might just work or require specific flags.

    // NOTE: As of `authenticator` 0.4/0.5, direct platform support might be tricky without a UI callback.
    // We will try `interactive` mode if available.

    let flags = authenticator::state::GetAssertionFlags {
        user_presence: true,
        user_verification: matches!(request.user_verification.as_deref(), Some("required")),
        ..Default::default()
    };

    // We rely on the `authenticator` crate's finding mechanism.
    // In a real app, we might want to iterate transports.
    // For now, let's try to get an assertion from any transport.
    match manager.get_assertion(&rp_id, &challenge_bytes, &allowed_creds, flags, |_status| {
        // println!("Status: {:?}", status);
    }) {
        Ok(assertion) => Ok(AssertionResult {
            credential_id: assertion.credential_id,
            authenticator_data: assertion.authenticator_data,
            signature: assertion.signature,
            user_handle: assertion.user_handle,
        }),
        Err(e) => Err(format!("Authenticator error: {:?}", e)),
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
    let request = {
        let lock = state.request.lock().map_err(|e| e.to_string())?;
        lock.clone().ok_or("No request found")?
    };

    println!("Starting WebAuthn signing for RP ID: {}", request.rp_id);

    // 1. Construct clientDataJSON
    // https://www.w3.org/TR/webauthn-2/#client-data
    let origin = format!("https://{}", request.rp_id); // Assuming RP ID is the domain
    let client_data = serde_json::json!({
        "type": "webauthn.get",
        "challenge": request.challenge, // This is the base64url encoded challenge
        "origin": origin,
        "crossOrigin": false
    });
    let client_data_json = client_data.to_string();
    let client_data_bytes = client_data_json.as_bytes();

    // 2. Calculate clientDataHash
    let client_data_hash = Sha256::digest(client_data_bytes).to_vec();

    // 3. Call Authenticator
    let rp_id = request.rp_id.clone();
    
    // Pass the HASH as the challenge to the authenticator crate (CTAP2 behavior)
    let result =
        tokio::task::spawn_blocking(move || get_assertion(request, rp_id, client_data_hash))
            .await
            .map_err(|e| e.to_string())??;

    // 4. Output result
    let output = serde_json::json!({
        "credential_id": URL_SAFE_NO_PAD.encode(&result.credential_id),
        "authenticator_data": URL_SAFE_NO_PAD.encode(&result.authenticator_data),
        "signature": URL_SAFE_NO_PAD.encode(&result.signature),
        "user_handle": result.user_handle.map(|h| URL_SAFE_NO_PAD.encode(h)),
        "client_data_json": URL_SAFE_NO_PAD.encode(client_data_bytes), // Return the raw JSON we constructed
    });

    println!("{}", output.to_string());

    // Exit app
    app.exit(0);
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
async fn jpki_sign(request: JpkiSignRequest) -> Result<String, String> {
    let reader = PcscReader::new().map_err(|e| e.to_string())?;
    let mut controller = JpkiController::new(reader);

    controller.select_jpki_ap().await.map_err(|e| e.to_string())?;
    
    // Select User Authentication PIN (EF 0018 for Auth, usually)
    // Actually, for digital signature (Sign), it is usually another EF (e.g. 001B).
    // Let's assume Auth for now as per common use case for login.
    let pin_ef = [0x00, 0x18]; 
    controller.verify_pin(&pin_ef, &request.pin).await.map_err(|e| e.to_string())?;

    let challenge_bytes = URL_SAFE_NO_PAD.decode(&request.challenge).map_err(|e| e.to_string())?;
    
    let signature = controller.compute_signature(&challenge_bytes).await.map_err(|e| e.to_string())?;
    
    Ok(URL_SAFE_NO_PAD.encode(&signature))
}

#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
async fn read_my_number_card(request: MyNumberCardRequest) -> Result<MyNumberCardData, String> {
    let reader = PcscReader::new().map_err(|e| e.to_string())?;
    let mut controller = JpkiController::new(reader);

    let my_number = controller.read_mynumber(&request.pin).await.map_err(|e| e.to_string())?;
    let info = controller.read_attributes(&request.pin, None, None).await.map_err(|e| e.to_string())?;

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
        })
        .invoke_handler(tauri::generate_handler![
            get_pending_request,
            perform_sign,
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
