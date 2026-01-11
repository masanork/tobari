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
    Encoded,
    EncodedSizeUser,
    Ciphertext as MlCiphertext,
    SharedKey as MlSharedKey,
    KemCore,
    MlKem768
};
#[cfg(feature = "pqc_kem")]
use kem::{Decapsulate, Encapsulate};

#[cfg(feature = "pqc_kem")]
const MLKEM_768_CT_LEN: usize = 1088;

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

// Hybrid HPKE (P-256 + ML-KEM-768)
#[cfg(feature = "pqc_kem")]
#[wasm_bindgen]
pub fn hpke_p256_mlkem768_encrypt(
    pk_bytes: &[u8],
    mlkem_pub_bytes: &[u8],
    plaintext: &[u8],
    info: &[u8]
) -> Result<Vec<u8>, JsValue> {
    let mut rng = StdRng::from_entropy();
    let recipient_pk = PublicKey::from_sec1_bytes(pk_bytes)
        .map_err(|e| JsValue::from_str(&format!("Invalid public key: {}", e)))?;

    let sender_sk = SecretKey::random(&mut rng);
    let sender_pk = sender_sk.public_key();

    let shared_secret = diffie_hellman(sender_sk.to_nonzero_scalar(), recipient_pk.as_affine());
    let secret_bytes = shared_secret.raw_secret_bytes();

    let ek_encoded = Encoded::< <MlKem768 as KemCore>::EncapsulationKey >::try_from(mlkem_pub_bytes)
        .map_err(|_| JsValue::from_str("Invalid ML-KEM public key length"))?;
    let ek = <MlKem768 as KemCore>::EncapsulationKey::from_bytes(&ek_encoded);
    let (ct, ss): (MlCiphertext<MlKem768>, MlSharedKey<MlKem768>) =
        ek.encapsulate(&mut rng).map_err(|_| JsValue::from_str("ML-KEM encapsulation failed"))?;

    let mut ikm = Vec::with_capacity(secret_bytes.len() + ss.as_slice().len());
    ikm.extend_from_slice(secret_bytes.as_slice());
    ikm.extend_from_slice(ss.as_slice());

    let h = Hkdf::<Sha256>::new(None, &ikm);
    let mut okm = [0u8; 28]; // 16 bytes key + 12 bytes nonce
    h.expand(info, &mut okm).map_err(|_| JsValue::from_str("HKDF expand failed"))?;

    let aes_key = &okm[..16];
    let aes_nonce = &okm[16..];

    let cipher = Aes128Gcm::new_from_slice(aes_key).map_err(|_| JsValue::from_str("Invalid key length"))?;
    let nonce = Nonce::from_slice(aes_nonce);
    let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|_| JsValue::from_str("Encryption failed"))?;

    let mut result = sender_pk.to_sec1_bytes().to_vec();
    result.extend_from_slice(ct.as_slice());
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

#[cfg(feature = "pqc_kem")]
#[wasm_bindgen]
pub fn hpke_p256_mlkem768_decrypt(
    sk_bytes: &[u8],
    mlkem_priv_bytes: &[u8],
    data: &[u8],
    info: &[u8]
) -> Result<Vec<u8>, JsValue> {
    if data.len() < 65 + MLKEM_768_CT_LEN {
        return Err(JsValue::from_str("Data too short"));
    }

    let sender_pk_bytes = &data[..65];
    let mlkem_ct_bytes = &data[65..65 + MLKEM_768_CT_LEN];
    let ciphertext = &data[65 + MLKEM_768_CT_LEN..];

    let recipient_sk = SecretKey::from_slice(sk_bytes)
        .map_err(|e| JsValue::from_str(&format!("Invalid private key: {}", e)))?;
    let sender_pk = PublicKey::from_sec1_bytes(sender_pk_bytes)
        .map_err(|e| JsValue::from_str(&format!("Invalid ephemeral public key: {}", e)))?;

    let shared_secret = diffie_hellman(recipient_sk.to_nonzero_scalar(), sender_pk.as_affine());
    let secret_bytes = shared_secret.raw_secret_bytes();

    let dk_encoded = Encoded::< <MlKem768 as KemCore>::DecapsulationKey >::try_from(mlkem_priv_bytes)
        .map_err(|_| JsValue::from_str("Invalid ML-KEM private key length"))?;
    let dk = <MlKem768 as KemCore>::DecapsulationKey::from_bytes(&dk_encoded);
    let ct = MlCiphertext::<MlKem768>::try_from(mlkem_ct_bytes)
        .map_err(|_| JsValue::from_str("Invalid ML-KEM ciphertext length"))?;
    let ss = dk.decapsulate(&ct).map_err(|_| JsValue::from_str("ML-KEM decapsulation failed"))?;

    let mut ikm = Vec::with_capacity(secret_bytes.len() + ss.as_slice().len());
    ikm.extend_from_slice(secret_bytes.as_slice());
    ikm.extend_from_slice(ss.as_slice());

    let h = Hkdf::<Sha256>::new(None, &ikm);
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
    let mut rng = rand::rngs::OsRng;
    let (dk, ek) = MlKem768::generate(&mut rng);
    let dk_bytes = dk.as_bytes();
    let ek_bytes = ek.as_bytes();

    let mut out = Vec::with_capacity(dk_bytes.as_slice().len() + ek_bytes.as_slice().len());
    out.extend_from_slice(dk_bytes.as_slice());
    out.extend_from_slice(ek_bytes.as_slice());
    Ok(out)
}

#[cfg(feature = "pqc_kem")]
#[wasm_bindgen]
pub fn ml_kem_768_encap(public_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    let ek_encoded = Encoded::< <MlKem768 as KemCore>::EncapsulationKey >::try_from(public_key)
        .map_err(|_| JsValue::from_str("Invalid public key length"))?;
    let ek = <MlKem768 as KemCore>::EncapsulationKey::from_bytes(&ek_encoded);

    let mut rng = rand::rngs::OsRng;
    let (ct, ss): (MlCiphertext<MlKem768>, MlSharedKey<MlKem768>) =
        ek.encapsulate(&mut rng).map_err(|_| JsValue::from_str("Encapsulation failed"))?;

    let mut out = Vec::with_capacity(ct.as_slice().len() + ss.as_slice().len());
    out.extend_from_slice(ss.as_slice());
    out.extend_from_slice(ct.as_slice());
    Ok(out)
}

#[cfg(feature = "pqc_kem")]
#[wasm_bindgen]
pub fn ml_kem_768_decap(private_key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, JsValue> {
    let dk_encoded = Encoded::< <MlKem768 as KemCore>::DecapsulationKey >::try_from(private_key)
        .map_err(|_| JsValue::from_str("Invalid private key length"))?;
    let dk = <MlKem768 as KemCore>::DecapsulationKey::from_bytes(&dk_encoded);
    let ct = MlCiphertext::<MlKem768>::try_from(ciphertext)
        .map_err(|_| JsValue::from_str("Invalid ciphertext length"))?;

    let ss = dk.decapsulate(&ct).map_err(|_| JsValue::from_str("Decapsulation failed"))?;
    Ok(ss.as_slice().to_vec())
}
