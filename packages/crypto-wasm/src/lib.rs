use wasm_bindgen::prelude::*;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes128Gcm, Nonce
};
use p256::ecdh::diffie_hellman;
use p256::{PublicKey, SecretKey};
use sha2::Sha256;
use hkdf::Hkdf;
use rand::prelude::*;
use serde_json::json;

#[wasm_bindgen]
pub fn get_version() -> String {
    "Tobari Crypto WASM v0.3.5 (Web/A Style HPKE)".to_string()
}

#[wasm_bindgen]
pub fn hpke_p256_encrypt(pk_bytes: &[u8], plaintext: &[u8], info: &[u8]) -> Result<Vec<u8>, JsValue> {
    let mut rng = StdRng::from_entropy();
    let recipient_pk = PublicKey::from_sec1_bytes(pk_bytes)
        .map_err(|e| JsValue::from_str(&format!("Invalid public key: {}", e)))?;

    let sender_sk = SecretKey::random(&mut rng);
    let sender_pk = sender_sk.public_key();

    let shared_secret = diffie_hellman(sender_sk.to_nonzero_scalar(), recipient_pk.as_affine());
    let secret_bytes = shared_secret.raw_secret_bytes();

    let h = Hkdf::<Sha256>::new(None, &secret_bytes);
    let mut okm = [0u8; 28]; // 16 bytes key + 12 bytes nonce
    h.expand(info, &mut okm).map_err(|_| JsValue::from_str("HKDF expand failed"))?;

    let aes_key = &okm[..16];
    let aes_nonce = &okm[16..];

    let cipher = Aes128Gcm::new_from_slice(aes_key).map_err(|_| JsValue::from_str("Invalid key length"))?;
    let nonce = Nonce::from_slice(aes_nonce);
    let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|_| JsValue::from_str("Encryption failed"))?;

    let mut result = sender_pk.to_sec1_bytes().to_vec();
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

#[wasm_bindgen]
pub fn hpke_p256_decrypt(sk_bytes: &[u8], data: &[u8], info: &[u8]) -> Result<Vec<u8>, JsValue> {
    if data.len() < 65 {
        return Err(JsValue::from_str("Data too short"));
    }
    let sender_pk_bytes = &data[..65];
    let ciphertext = &data[65..];

    let recipient_sk = SecretKey::from_slice(sk_bytes)
        .map_err(|e| JsValue::from_str(&format!("Invalid private key: {}", e)))?;
    let sender_pk = PublicKey::from_sec1_bytes(sender_pk_bytes)
        .map_err(|e| JsValue::from_str(&format!("Invalid ephemeral public key: {}", e)))?;

    let shared_secret = diffie_hellman(recipient_sk.to_nonzero_scalar(), sender_pk.as_affine());
    let secret_bytes = shared_secret.raw_secret_bytes();

    let h = Hkdf::<Sha256>::new(None, &secret_bytes);
    let mut okm = [0u8; 28];
    h.expand(info, &mut okm).map_err(|_| JsValue::from_str("HKDF expand failed"))?;

    let aes_key = &okm[..16];
    let aes_nonce = &okm[16..];

    let cipher = Aes128Gcm::new_from_slice(aes_key).map_err(|_| JsValue::from_str("Invalid key length"))?;
    let nonce = Nonce::from_slice(aes_nonce);
    let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|_| JsValue::from_str("Decryption failed"))?;

    Ok(plaintext)
}

#[wasm_bindgen]
pub fn derive_p256_keypair(seed: &[u8]) -> Result<Vec<u8>, JsValue> {
    let sk = SecretKey::from_slice(&seed[..32])
        .map_err(|e| JsValue::from_str(&format!("Invalid seed for private key: {}", e)))?;
    let pk = sk.public_key();
    
    // Concatenate [publicKey (65)] + [privateKey (32)]
    let mut result = pk.to_sec1_bytes().to_vec();
    result.extend_from_slice(&sk.to_bytes());
    Ok(result)
}
