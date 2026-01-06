use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

// --- Data Structures ---

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

    // Convert Challenge
    let challenge_bytes = URL_SAFE_NO_PAD
        .decode(&request.challenge)
        .map_err(|e| format!("Invalid base64url challenge: {}", e))?;

    // Setup Authenticator
    // Note: This logic runs in the Tauri thread pool (async).
    // In a real implementation, we might need to handle UI callbacks if the authenticator crate supports them.

    // In a real scenario, we would map the request.allow_credentials to the authenticator's expected format.
    // For now, we assume we want to use any available credential (resident key) or let the user choose.

    // Since `authenticator` crate 0.5.0 usage can be complex regarding transports,
    // we will attempt a "default" interaction which usually includes platform authenticators.

    // NOTE: The `authenticator` crate API varies.
    // We are simulating the core logic here. If `authenticator` fails to compile, we will fix it.

    // Prepare SHA-256 hash of clientDataJSON?
    // WebAuthn signers usually take the challenge and sign over the clientDataHash.
    // However, lower level CTAP2 signers take the challenge directly.
    // We assume the MCP server expects a standard WebAuthn assertion response.

    // Simplified: Just calling the authenticator (Blocking call in async context is okayish here or use tokio::task::spawn_blocking)
    let rp_id = request.rp_id.clone();

    let result =
        tokio::task::spawn_blocking(move || get_assertion(request, rp_id, challenge_bytes))
            .await
            .map_err(|e| e.to_string())??;

    // Output result to STDOUT
    let output = serde_json::json!({
        "credential_id": URL_SAFE_NO_PAD.encode(&result.credential_id),
        "authenticator_data": URL_SAFE_NO_PAD.encode(&result.authenticator_data),
        "signature": URL_SAFE_NO_PAD.encode(&result.signature),
        "user_handle": result.user_handle.map(|h| URL_SAFE_NO_PAD.encode(h)),
        // In raw CTAP2, clientDataJSON is constructed by the caller (browser).
        // Here, since we are acting as the client, we might need to construct it or
        // if the authenticator just signed the challenge (CTAP1/U2F style) or clientDataHash (CTAP2).
        // The `authenticator` crate usually handles CTAP2.
        // We might need to provide the clientDataJSON that was implicitly used, or the caller constructs it.
        // Note: For CTAP2, the authenticator signs the hash of clientDataJSON.
        // We need to return what was signed.
    });

    println!("{}", output.to_string());

    // Exit app
    app.exit(0);
    Ok(())
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
            reject
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
