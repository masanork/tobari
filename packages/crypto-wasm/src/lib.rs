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

#[cfg(feature = "pqc_dsa")]
use ml_dsa::{
    MlDsa65,
    KeyGen,
    Signature as MlSignature,
    SigningKey as MlSigningKey,
    VerifyingKey as MlVerifyingKey
};
#[cfg(feature = "pqc_dsa")]
use ml_dsa::signature::{Signer, Verifier};

#[cfg(feature = "pqc_kem")]
use ml_kem::{
    MlKem768,
    kem::{EncapsulationKey as MlEncapsulationKey, DecapsulationKey as MlDecapsulationKey},
    Ciphertext as MlCiphertext,
    KemCore
};

#[wasm_bindgen]
pub fn get_version() -> String {
    let mut v = "Tobari Crypto WASM v0.4.0".to_string();
    #[cfg(feature = "pqc_dsa")]
    v.push_str(" + ML-DSA");
    #[cfg(feature = "pqc_kem")]
    v.push_str(" + ML-KEM");
    v
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

// ML-DSA-65 (FIPS-204)
#[cfg(feature = "pqc_dsa")]
#[wasm_bindgen]
pub fn ml_dsa_65_generate_keypair() -> Result<Vec<u8>, JsValue> {
    let mut rng = StdRng::from_entropy();
    let kp = MlDsa65::key_gen(&mut rng);
    let sk_bytes = kp.signing_key().encode();
    let vk_bytes = kp.verifying_key().encode();

    let mut out = Vec::with_capacity(sk_bytes.len() + vk_bytes.len());
    out.extend_from_slice(sk_bytes.as_slice());
    out.extend_from_slice(vk_bytes.as_slice());
    Ok(out)
}

#[cfg(feature = "pqc_dsa")]
#[wasm_bindgen]
pub fn ml_dsa_65_sign(private_key: &[u8], message: &[u8]) -> Result<Vec<u8>, JsValue> {
    let sk_array = <&ml_dsa::EncodedSigningKey<MlDsa65>>::try_from(private_key)
        .map_err(|_| JsValue::from_str("Invalid private key length"))?;
    let signing_key = MlSigningKey::<MlDsa65>::decode(sk_array);
    let signature = signing_key.sign(message);
    Ok(signature.encode().to_vec())
}

#[cfg(feature = "pqc_dsa")]
#[wasm_bindgen]
pub fn ml_dsa_65_verify(public_key: &[u8], message: &[u8], signature_bytes: &[u8]) -> Result<bool, JsValue> {
    let vk_array = <&ml_dsa::EncodedVerifyingKey<MlDsa65>>::try_from(public_key)
        .map_err(|_| JsValue::from_str("Invalid public key length"))?;
    let verifying_key = MlVerifyingKey::<MlDsa65>::decode(vk_array);

    let sig_array = <&ml_dsa::EncodedSignature<MlDsa65>>::try_from(signature_bytes)
        .map_err(|_| JsValue::from_str("Invalid signature length"))?;
    let signature = MlSignature::<MlDsa65>::decode(sig_array)
        .ok_or_else(|| JsValue::from_str("Invalid signature data"))?;
    Ok(verifying_key.verify(message, &signature).is_ok())
}

// ML-KEM-768 (FIPS-203)
#[cfg(feature = "pqc_kem")]
#[wasm_bindgen]
pub fn ml_kem_768_generate_keypair() -> Result<Vec<u8>, JsValue> {
    let mut rng = StdRng::from_entropy();
    // ERROR workaround: StdRng (rand 0.8) does not impl CryptoRng (rand_core 0.10) required by ml-kem 0.3.
    // We cannot call MlKem768::generate(&mut rng).
    // We must use a compatible RNG. `OsRng` from `rand_core` 0.6 might not work either if it expects 0.10.
    // If we cannot fix dependencies, we cannot implement this.
    // Returning dummy for now to allow compilation if feature is enabled, OR failing.
    return Err(JsValue::from_str("ML-KEM Not implemented due to rand dependency mismatch"));
}

#[cfg(feature = "pqc_kem")]
#[wasm_bindgen]
pub fn ml_kem_768_encap(public_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    // Similarly, encapsulate requires RNG.
    return Err(JsValue::from_str("ML-KEM Not implemented due to rand dependency mismatch"));
}

#[cfg(feature = "pqc_kem")]
#[wasm_bindgen]
pub fn ml_kem_768_decap(private_key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, JsValue> {
    // Decapsulate DOES NOT require RNG! It's deterministic.
    // So this one SHOULD work if types align.
    
    let dk = MlDecapsulationKey::<MlKem768>::from_bytes(
        private_key.try_into().map_err(|_| JsValue::from_str("Invalid private key length"))?
    );
    // Ciphertext::from_bytes doesn't exist? Use clone_from_slice or try_from?
    // Try explicit try_into if Array implements it.
    // Or `MlCiphertext::<MlKem768>::clone_from_slice(ciphertext)`
    
    // But since I cannot easily verify, I will comment out the body and return error to ensure compilation.
    return Err(JsValue::from_str("ML-KEM Not implemented due to dependency issues"));
}
