use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use crate::models::SignerError;
use crate::utils::{get_tobari_home, inspect_cbor_value};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::PublicKey;
use aes_gcm::{Aes256Gcm, Key, Nonce, KeyInit, aead::Aead};
use hkdf::Hkdf;
use sha2::Sha256;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredKey {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub public_key: serde_json::Value,
}

pub fn get_key_store_path() -> std::path::PathBuf {
    get_tobari_home().join("config").join("keys.json")
}

pub fn load_keys() -> Result<Vec<StoredKey>, SignerError> {
    let path = get_key_store_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let file = std::fs::File::open(path).map_err(|e| SignerError::Internal(e.to_string()))?;
    let keys: Vec<StoredKey> = serde_json::from_reader(file).unwrap_or_default();
    Ok(keys)
}

pub fn save_key(key: StoredKey) -> Result<(), SignerError> {
    let mut keys = load_keys()?;
    keys.retain(|k| k.id != key.id);
    keys.push(key);
    
    let path = get_key_store_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| SignerError::Internal(e.to_string()))?;
    }
    let file = std::fs::File::create(path).map_err(|e| SignerError::Internal(e.to_string()))?;
    serde_json::to_writer_pretty(file, &keys).map_err(|e| SignerError::Serialization(e.to_string()))?;
    Ok(())
}

pub fn get_device_key_path() -> std::path::PathBuf {
    get_tobari_home().join("config").join("device.key")
}

pub fn get_or_generate_device_key() -> Result<p256::SecretKey, SignerError> {
    let path = get_device_key_path();
    if path.exists() {
        let bytes = std::fs::read(path).map_err(|e| SignerError::Internal(e.to_string()))?;
        p256::SecretKey::from_slice(&bytes).map_err(|e| SignerError::Internal(e.to_string()))
    } else {
        let secret = p256::SecretKey::random(&mut rand::thread_rng());
        let bytes = secret.to_bytes();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(path, bytes).map_err(|e| SignerError::Internal(e.to_string()))?;
        Ok(secret)
    }
}

#[tauri::command]
pub fn get_registered_keys() -> Result<Vec<StoredKey>, SignerError> {
    load_keys()
}

#[tauri::command]
pub fn get_device_public_key() -> Result<serde_json::Value, SignerError> {
    let secret = get_or_generate_device_key()?;
    let public_key = secret.public_key();
    let point = public_key.to_encoded_point(false);
    let x = point.x().ok_or(SignerError::Internal("Invalid point".to_string()))?;
    let y = point.y().ok_or(SignerError::Internal("Invalid point".to_string()))?;
    
    Ok(serde_json::json!({
        "kty": "EC",
        "crv": "P-256",
        "x": URL_SAFE_NO_PAD.encode(x),
        "y": URL_SAFE_NO_PAD.encode(y)
    }))
}

#[tauri::command]
pub async fn decrypt_data(data: serde_json::Value) -> Result<serde_json::Value, SignerError> {
    let secret = get_or_generate_device_key()?;
    
    let tobari_enc = data.get("tobari_enc").and_then(|v| v.as_bool()).unwrap_or(false);
    if !tobari_enc {
        return Ok(data);
    }

    let ephem_pub_b64 = data.get("enc").or(data.get("ephemeralPublicKey"))
        .and_then(|v| v.as_str())
        .ok_or(SignerError::InvalidData("Missing ephemeral key".to_string()))?;
    let ciphertext_b64 = data.get("ciphertext")
        .and_then(|v| v.as_str())
        .ok_or(SignerError::InvalidData("Missing ciphertext".to_string()))?;
    let iv_b64 = data.get("iv")
        .and_then(|v| v.as_str())
        .ok_or(SignerError::InvalidData("Missing IV".to_string()))?;
    let tag_b64 = data.get("tag")
        .and_then(|v| v.as_str())
        .ok_or(SignerError::InvalidData("Missing tag".to_string()))?;

    let ephem_pub_bytes = URL_SAFE_NO_PAD.decode(ephem_pub_b64).map_err(|e| SignerError::InvalidData(e.to_string()))?;
    let ciphertext = URL_SAFE_NO_PAD.decode(ciphertext_b64).map_err(|e| SignerError::InvalidData(e.to_string()))?;
    let iv = URL_SAFE_NO_PAD.decode(iv_b64).map_err(|e| SignerError::InvalidData(e.to_string()))?;
    let tag = URL_SAFE_NO_PAD.decode(tag_b64).map_err(|e| SignerError::InvalidData(e.to_string()))?;

    let remote_pub = PublicKey::from_sec1_bytes(&ephem_pub_bytes)
        .map_err(|e| SignerError::InvalidData(format!("Invalid ephemeral public key: {}", e)))?;
    
    let shared_secret = p256::ecdh::diffie_hellman(secret.to_nonzero_scalar(), remote_pub.as_affine());
    let secret_bytes = shared_secret.raw_secret_bytes();

    let hkdf = Hkdf::<Sha256>::new(Some(b"tobari-ecies-salt"), secret_bytes.as_slice());
    let mut okm = [0u8; 32];
    hkdf.expand(b"tobari-ecies-info", &mut okm).map_err(|e| SignerError::Internal(e.to_string()))?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&okm));
    let nonce = Nonce::from_slice(&iv);
    
    let mut combined = ciphertext.clone();
    combined.extend_from_slice(&tag);

    let plaintext = cipher.decrypt(nonce, combined.as_slice())
        .map_err(|e| SignerError::Internal(format!("AES decryption failed: {}", e)))?;

    let decoded: serde_json::Value = match ciborium::from_reader(plaintext.as_slice()) {
        Ok(v) => inspect_cbor_value(v),
        Err(e) => {
            if std::env::var("TOBARI_DEBUG").ok().as_deref() == Some("1") {
                println!("DEBUG: CBOR decode failed: {}", e);
                println!("DEBUG: Plaintext hex: {}", hex::encode(&plaintext));
            }
            if let Ok(json_val) = serde_json::from_slice(&plaintext) {
                json_val
            } else {
                match String::from_utf8(plaintext) {
                    Ok(s) => serde_json::Value::String(s),
                    Err(_) => serde_json::Value::String("Binary data (decryption successful but decode failed)".to_string()),
                }
            }
        }
    };

    Ok(decoded)
}
