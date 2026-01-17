use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::{command, AppHandle, State};
use crate::models::{SignerError, SignRequest, SignResponse, AssertionResult, CredentialDescriptor, RegisterResponse, InternalRegisterResult};
use crate::keys::{save_key, StoredKey};

pub struct AppState {
    pub request: Mutex<Option<SignRequest>>,
    pub allow_credentials: Mutex<Option<Vec<CredentialDescriptor>>>,
}

#[command]
pub fn get_pending_request(state: State<AppState>) -> Result<Option<SignRequest>, SignerError> {
    let request = state.request.lock().map_err(|e| SignerError::Internal(e.to_string()))?;
    Ok(request.clone())
}

#[command]
pub fn reject(app: AppHandle) {
    eprintln!("User rejected the request.");
    app.exit(1);
}

#[command]
pub async fn perform_sign(state: State<'_, AppState>, app: AppHandle) -> Result<(), SignerError> {
    let mut request = {
        let lock = state.request.lock().map_err(|e| SignerError::Internal(e.to_string()))?;
        lock.clone().ok_or(SignerError::NoRequest)?
    };
    if let Ok(lock) = state.allow_credentials.lock() {
        if let Some(creds) = lock.clone() {
            request.allow_credentials = Some(creds);
        }
    }

    let origin = format!("https://{}", request.rp_id);
    let client_data = serde_json::json!({
        "type": "webauthn.get",
        "challenge": request.challenge,
        "origin": origin,
        "crossOrigin": false
    });
    let client_data_json = client_data.to_string();
    let client_data_hash = Sha256::digest(client_data_json.as_bytes()).to_vec();
    let rp_id = request.rp_id.clone();
    
    let result = tokio::task::spawn_blocking(move || -> Result<AssertionResult, String> { 
                get_assertion(request, rp_id, client_data_hash) 
            })
            .await
            .map_err(|e: tokio::task::JoinError| SignerError::Internal(e.to_string()))?
            .map_err(SignerError::Authenticator)?;

    let response = SignResponse {
        signature: URL_SAFE_NO_PAD.encode(&result.signature),
        auth_data: Some(URL_SAFE_NO_PAD.encode(&result.authenticator_data)),
        client_data_json: Some(client_data_json),
        public_key: None,
    };

    println!("{}", serde_json::to_string(&response).map_err(|e| SignerError::Serialization(e.to_string()))?);
    app.exit(0);
    Ok(())
}

#[command]
pub async fn perform_register(state: State<'_, AppState>) -> Result<String, SignerError> {
    let request = {
        let lock = state.request.lock().map_err(|e| SignerError::Internal(e.to_string()))?;
        match lock.clone() {
            Some(r) => r,
            None => {
                SignRequest {
                    challenge: URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>()),
                    rp_id: "tobari.local".to_string(),
                    user_verification: Some("preferred".to_string()),
                    message: Some("Registering Tobari Passkey".to_string()),
                    allow_credentials: None,
                }
            }
        }
    };

    let rp_id = request.rp_id.clone();
    let origin = format!("https://{}", rp_id);
    let client_data = serde_json::json!({
        "type": "webauthn.create",
        "challenge": request.challenge,
        "origin": origin,
        "crossOrigin": false
    });
    let client_data_json = client_data.to_string();
    let client_data_hash = Sha256::digest(client_data_json.as_bytes());
    let client_data_hash: [u8; 32] = client_data_hash.as_slice().try_into()
        .map_err(|_| SignerError::Internal("Invalid client_data_hash length".to_string()))?;

    let rp_id_for_reg = rp_id.clone();
    let reg_result = tokio::task::spawn_blocking(move || -> Result<InternalRegisterResult, String> {
        register_credential_full(request, rp_id_for_reg, client_data_hash)
    })
    .await
    .map_err(|e: tokio::task::JoinError| SignerError::Internal(e.to_string()))?
    .map_err(SignerError::Authenticator)?;

    let credential_b64 = URL_SAFE_NO_PAD.encode(&reg_result.credential_id);
    let response = RegisterResponse {
        credential_id: credential_b64.clone(),
        public_key: reg_result.public_key_jwk.clone(),
    };

    if let Ok(mut lock) = state.allow_credentials.lock() {
        *lock = Some(vec![CredentialDescriptor {
            type_: "public-key".to_string(),
            id: credential_b64.clone(),
        }]);
    }

    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    save_key(StoredKey {
        id: credential_b64.clone(),
        name: format!("Passkey {}", &credential_b64[0..8]),
        created_at: now,
        public_key: reg_result.public_key_jwk.clone(),
    })?;

    Ok(serde_json::to_string(&response).map_err(|e| SignerError::Serialization(e.to_string()))?)
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

    let mut manager = AuthenticatorService::new().map_err(|e| format!("Authenticator init error: {:?}", e))?;
    manager.add_detected_transports();

    let allowed_creds = request.allow_credentials.as_ref().map(|creds| {
            creds.iter().map(|c| PublicKeyCredentialDescriptor {
                    id: URL_SAFE_NO_PAD.decode(&c.id).unwrap_or_default(),
                    transports: Vec::new(),
                }).collect::<Vec<_>>()
        }).unwrap_or_default();

    let user_verification_req = match request.user_verification.as_deref() {
        Some("required") => UserVerificationRequirement::Required,
        Some("discouraged") => UserVerificationRequirement::Discouraged,
        _ => UserVerificationRequirement::Preferred,
    };

    let client_data_hash: [u8; 32] = challenge_bytes.as_slice().try_into()
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

    let (status_tx, _status_rx) = channel();
    let (sign_tx, sign_rx) = channel();
    let callback = StateCallback::new(Box::new(move |rv| { let _ = sign_tx.send(rv); }));

    manager.sign(60_000, ctap_args, status_tx, callback).map_err(|e| format!("Authenticator sign error: {:?}", e))?;

    let sign_result = sign_rx.recv_timeout(Duration::from_secs(60)).map_err(|e| { let _ = manager.cancel(); format!("Authenticator timed out: {:?}", e) })?;

    match sign_result {
        Ok(assertion_result) => {
            let assertion = assertion_result.assertion;
            Ok(AssertionResult {
                credential_id: assertion.credentials.as_ref().map(|c| c.id.clone()).unwrap_or_default(),
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

    let mut manager = AuthenticatorService::new().map_err(|e| format!("Authenticator init error: {:?}", e))?;
    manager.add_detected_transports();

    let user_verification_req = match request.user_verification.as_deref() {
        Some("required") => UserVerificationRequirement::Required,
        Some("discouraged") => UserVerificationRequirement::Discouraged,
        _ => UserVerificationRequirement::Preferred,
    };

    let rp = RelyingParty { id: rp_id.clone(), name: Some(rp_id.clone()) };
    let user = PublicKeyCredentialUserEntity {
        id: Sha256::digest(rp_id.as_bytes()).to_vec(),
        name: Some("tobari-user".to_string()),
        display_name: Some("Tobari User".to_string()),
    };

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
    let callback = StateCallback::new(Box::new(move |rv| { let _ = reg_tx.send(rv); }));
    let (status_tx, _status_rx) = channel();

    manager.register(60_000, ctap_args, status_tx, callback).map_err(|e| format!("Authenticator register error: {:?}", e))?;

    let reg_result = reg_rx.recv_timeout(std::time::Duration::from_secs(60)).map_err(|e| format!("Authenticator timeout: {:?}", e))?;

    match reg_result {
        Ok(attestation) => {
            let cred_data = attestation.att_obj.auth_data.credential_data.ok_or("No credential data")?;
            let mut pub_key_bytes = Vec::new();
            ciborium::into_writer(&cred_data.credential_public_key, &mut pub_key_bytes).unwrap();
            let cose_key: std::collections::HashMap<i32, ciborium::value::Value> = ciborium::from_reader(pub_key_bytes.as_slice()).unwrap();
            
            let x_bytes = cose_key.get(&-2).and_then(|v| v.as_bytes()).ok_or("Missing X")?;
            let y_bytes = cose_key.get(&-3)
                .and_then(|v: &ciborium::value::Value| v.as_bytes())
                .ok_or("Missing Y")?;

            Ok(InternalRegisterResult {
                credential_id: cred_data.credential_id,
                public_key_jwk: serde_json::json!({
                    "kty": "EC", "crv": "P-256",
                    "x": URL_SAFE_NO_PAD.encode(x_bytes),
                    "y": URL_SAFE_NO_PAD.encode(y_bytes)
                }),
            })
        }
        Err(e) => Err(format!("Authenticator error: {:?}", e)),
    }
}

#[cfg(all(target_os = "linux", not(feature = "linux-authenticator")))]
fn get_assertion(_request: SignRequest, _rp_id: String, _challenge_bytes: Vec<u8>) -> Result<AssertionResult, String> {
    Err("WebAuthn signing on Linux requires feature.".to_string())
}

#[cfg(all(target_os = "macos", not(feature = "macos-authenticator")))]
fn get_assertion(_request: SignRequest, _rp_id: String, _challenge_bytes: Vec<u8>) -> Result<AssertionResult, String> {
    Err("WebAuthn signing on macOS requires feature.".to_string())
}

#[cfg(not(any(target_os = "windows", all(target_os = "macos", feature = "macos-authenticator"), all(target_os = "linux", feature = "linux-authenticator"))))]
fn register_credential_full(_request: SignRequest, _rp_id: String, _client_data_hash: [u8; 32]) -> Result<InternalRegisterResult, String> {
    Err("Registration not fully implemented (FEATURE_MISSING).".to_string())
}