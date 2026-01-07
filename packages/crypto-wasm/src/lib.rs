use wasm_bindgen::prelude::*;
use subtle::ConstantTimeEq;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce
};
use x25519_dalek::{StaticSecret, PublicKey as XPublicKey};
use ed25519_dalek::{SigningKey as EdSigningKey, VerifyingKey as EdVerifyingKey, Signature as EdSignature, Signer as EdSigner, Verifier as EdVerifier};
use ml_kem::{MlKem768, MlKem768Params, Encoded, EncodedSizeUser, KemCore, Ciphertext};
use ml_kem::kem::{EncapsulationKey, DecapsulationKey, Encapsulate, Decapsulate};
use rand::prelude::*;
use sha2::{Sha256, Digest};
use hkdf::Hkdf;
use ml_dsa::{MlDsa44, KeyGen, SigningKey as MlSigningKey, VerifyingKey as MlVerifyingKey, Signature as MlSignature};
use serde::{Serialize, Deserialize};
use serde_json::json;


const HPKE_VERSION_LABEL: &str = "HPKE-v1";
const HPKE_SUITE_ID_LABEL: &str = "HPKE";
const HPKE_INFO_CONTEXT: &str = "weba-l2";
const HPKE_KDF_ID_HKDF_SHA256: u16 = 0x0001;
const HPKE_AEAD_ID_AES_256_GCM: u16 = 0x0002;
const HPKE_KEM_ID_X25519: u16 = 0x0020;
const HPKE_KEM_ID_X25519_ML_KEM_768: u16 = 0x0030;


#[wasm_bindgen]
pub fn constant_time_equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.ct_eq(b).into()
}

#[wasm_bindgen]
pub fn get_version() -> String {
    "Web/A Crypto WASM v0.1.6 (AES-GCM + X25519 + Ed25519 + P-256 + ML-KEM-768 + ML-DSA-44 + SHA256/HKDF)".to_string()
}

#[wasm_bindgen]
pub fn aes_gcm_encrypt(key: &[u8], iv: &[u8], plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, JsValue> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| JsValue::from_str("Invalid key length"))?;
    let nonce = Nonce::from_slice(iv);
    let payload = Payload {
        msg: plaintext,
        aad: aad,
    };
    let ciphertext = cipher.encrypt(nonce, payload).map_err(|_| JsValue::from_str("Encryption failed"))?;
    Ok(ciphertext)
}

#[wasm_bindgen]
pub fn aes_gcm_decrypt(key: &[u8], iv: &[u8], ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>, JsValue> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| JsValue::from_str("Invalid key length"))?;
    let nonce = Nonce::from_slice(iv);
    let payload = Payload {
        msg: ciphertext,
        aad: aad,
    };
    let plaintext = cipher.decrypt(nonce, payload).map_err(|_| JsValue::from_str("Decryption failed"))?;
    Ok(plaintext)
}

// X25519
#[wasm_bindgen]
pub fn x25519_generate_keypair() -> Result<Vec<u8>, JsValue> {
    let mut rng = thread_rng();
    let secret = StaticSecret::random_from_rng(&mut rng);
    let public = XPublicKey::from(&secret);
    
    let mut out = Vec::with_capacity(64);
    out.extend_from_slice(secret.to_bytes().as_slice());
    out.extend_from_slice(public.as_bytes());
    Ok(out)
}

#[wasm_bindgen]
pub fn x25519_get_public_key(private_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    if private_key.len() != 32 {
        return Err(JsValue::from_str("Invalid private key length"));
    }
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(private_key);
    let secret = StaticSecret::from(bytes);
    let public = XPublicKey::from(&secret);
    Ok(public.as_bytes().to_vec())
}

#[wasm_bindgen]
pub fn x25519_get_shared_secret(private_key: &[u8], public_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    if private_key.len() != 32 || public_key.len() != 32 {
        return Err(JsValue::from_str("Invalid key length"));
    }
    let mut priv_bytes = [0u8; 32];
    priv_bytes.copy_from_slice(private_key);
    let secret = StaticSecret::from(priv_bytes);
    
    let mut pub_bytes = [0u8; 32];
    pub_bytes.copy_from_slice(public_key);
    let public = XPublicKey::from(pub_bytes);
    
    let ss = secret.diffie_hellman(&public);
    Ok(ss.as_bytes().to_vec())
}

// Ed25519
#[wasm_bindgen]
pub fn ed25519_generate_keypair() -> Result<Vec<u8>, JsValue> {
    let mut rng = thread_rng();
    let signing_key = EdSigningKey::generate(&mut rng);
    let verifying_key = EdVerifyingKey::from(&signing_key);
    
    let mut out = Vec::with_capacity(64);
    out.extend_from_slice(&signing_key.to_bytes());
    out.extend_from_slice(verifying_key.as_bytes());
    Ok(out)
}

#[wasm_bindgen]
pub fn ed25519_sign(private_key: &[u8], message: &[u8]) -> Result<Vec<u8>, JsValue> {
    if private_key.len() != 32 {
        return Err(JsValue::from_str("Invalid private key length"));
    }
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(private_key);
    let signing_key = EdSigningKey::from_bytes(&bytes);
    let signature = signing_key.sign(message);
    Ok(signature.to_bytes().to_vec())
}

#[wasm_bindgen]
pub fn ed25519_verify(public_key: &[u8], message: &[u8], signature: &[u8]) -> Result<bool, JsValue> {
    if public_key.len() != 32 || signature.len() != 64 {
        return Ok(false);
    }
    let mut pub_bytes = [0u8; 32];
    pub_bytes.copy_from_slice(public_key);
    let verifying_key = EdVerifyingKey::from_bytes(&pub_bytes).map_err(|_| JsValue::from_str("Invalid public key"))?;
    
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(signature);
    let signature = EdSignature::from_bytes(&sig_bytes);
    
    Ok(verifying_key.verify(message, &signature).is_ok())
}

#[wasm_bindgen]
pub fn ed25519_public_key_to_x25519_public_key(ed25519_pub: &[u8]) -> Result<Vec<u8>, JsValue> {
    if ed25519_pub.len() != 32 {
        return Err(JsValue::from_str("Invalid Ed25519 public key length"));
    }
    let compressedy = curve25519_dalek::edwards::CompressedEdwardsY::from_slice(ed25519_pub)
        .map_err(|_| JsValue::from_str("Invalid Ed25519 public key"))?;
    let point = compressedy.decompress()
        .ok_or_else(|| JsValue::from_str("Failed to decompress Ed25519 public key"))?;
    let x_point = point.to_montgomery();
    Ok(x_point.as_bytes().to_vec())
}

// P-256 (ECDSA)
#[wasm_bindgen]
pub fn p256_generate_keypair() -> Result<Vec<u8>, JsValue> {
    use p256::SecretKey;
    
    let mut rng = thread_rng();
    let secret_key = SecretKey::random(&mut rng);
    let public_key = secret_key.public_key();
    
    // Secret key: 32 bytes, Public key: 65 bytes (uncompressed)
    let mut out = Vec::with_capacity(32 + 65);
    out.extend_from_slice(&secret_key.to_bytes());
    out.extend_from_slice(&public_key.to_sec1_bytes());
    Ok(out)
}

#[wasm_bindgen]
pub fn p256_sign(private_key: &[u8], message: &[u8]) -> Result<Vec<u8>, JsValue> {
    use p256::{SecretKey, ecdsa::{SigningKey, signature::Signer}};
    
    if private_key.len() != 32 {
        return Err(JsValue::from_str("Invalid private key length"));
    }
    
    let secret = SecretKey::from_bytes(private_key.into())
        .map_err(|_| JsValue::from_str("Invalid private key"))?;
    let signing_key = SigningKey::from(&secret);
    
    let signature: p256::ecdsa::Signature = signing_key.sign(message);
    Ok(signature.to_bytes().to_vec())
}

#[wasm_bindgen]
pub fn p256_verify(public_key: &[u8], message: &[u8], signature: &[u8]) -> Result<bool, JsValue> {
    use p256::{PublicKey, ecdsa::{VerifyingKey, Signature, signature::Verifier}};
    
    let public = PublicKey::from_sec1_bytes(public_key)
        .map_err(|_| JsValue::from_str("Invalid public key"))?;
    let verifying_key = VerifyingKey::from(&public);
    
    let sig = Signature::from_bytes(signature.into())
        .map_err(|_| JsValue::from_str("Invalid signature"))?;
    
    Ok(verifying_key.verify(message, &sig).is_ok())
}

// ML-KEM-768
#[wasm_bindgen]
pub fn ml_kem_768_generate_keypair() -> Result<Vec<u8>, JsValue> {
    let mut rng = thread_rng();
    let (dk, ek) = MlKem768::generate(&mut rng);
    
    let ek_bytes = ek.as_bytes();
    let dk_bytes = dk.as_bytes();
    
    let mut out = Vec::with_capacity(ek_bytes.len() + dk_bytes.len());
    out.extend_from_slice(dk_bytes.as_slice()); 
    out.extend_from_slice(ek_bytes.as_slice());
    Ok(out)
}

#[wasm_bindgen]
pub fn ml_kem_768_encapsulate(public_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    let mut rng = thread_rng();
    
    let ek_encoded = Encoded::<EncapsulationKey<MlKem768Params>>::try_from(public_key)
        .map_err(|_| JsValue::from_str("Invalid public key length"))?;
    let ek = EncapsulationKey::<MlKem768Params>::from_bytes(&ek_encoded);
    
    let (ct, ss) = ek.encapsulate(&mut rng).map_err(|_| JsValue::from_str("Encapsulation failed"))?;
    
    let mut out = Vec::with_capacity(ct.len() + ss.len());
    out.extend_from_slice(ss.as_slice()); 
    out.extend_from_slice(ct.as_slice());
    Ok(out)
}

#[wasm_bindgen]
pub fn ml_kem_768_decapsulate(private_key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, JsValue> {
    let dk_encoded = Encoded::<DecapsulationKey<MlKem768Params>>::try_from(private_key)
        .map_err(|_| JsValue::from_str("Invalid private key length"))?;
    let dk = DecapsulationKey::<MlKem768Params>::from_bytes(&dk_encoded);
    
    let ct = Ciphertext::<MlKem768>::try_from(ciphertext)
        .map_err(|_| JsValue::from_str("Invalid ciphertext length"))?;
    
    let ss = dk.decapsulate(&ct).map_err(|_| JsValue::from_str("Decapsulation failed"))?;
    
    Ok(ss.to_vec())
}

// ML-DSA-44
#[wasm_bindgen]
pub fn ml_dsa_44_generate_keypair() -> Result<Vec<u8>, JsValue> {
    let mut rng = thread_rng();
    let kp = MlDsa44::key_gen(&mut rng);
    let sk_bytes = kp.signing_key().encode();
    let vk_bytes = kp.verifying_key().encode();
    
    let mut out = Vec::with_capacity(sk_bytes.len() + vk_bytes.len());
    out.extend_from_slice(sk_bytes.as_slice());
    out.extend_from_slice(vk_bytes.as_slice());
    Ok(out)
}

#[wasm_bindgen]
pub fn ml_dsa_44_sign(private_key: &[u8], message: &[u8]) -> Result<Vec<u8>, JsValue> {
    let sk_array = <&ml_dsa::EncodedSigningKey<MlDsa44>>::try_from(private_key)
        .map_err(|_| JsValue::from_str("Invalid private key length"))?;
    let signing_key = MlSigningKey::<MlDsa44>::decode(sk_array);
    let signature = signing_key.sign(message);
    Ok(signature.encode().to_vec())
}

#[wasm_bindgen]
pub fn ml_dsa_44_verify(public_key: &[u8], message: &[u8], signature_bytes: &[u8]) -> Result<bool, JsValue> {
    let vk_array = <&ml_dsa::EncodedVerifyingKey<MlDsa44>>::try_from(public_key)
        .map_err(|_| JsValue::from_str("Invalid public key length"))?;
    let verifying_key = MlVerifyingKey::<MlDsa44>::decode(vk_array);
    
    let sig_array = <&ml_dsa::EncodedSignature<MlDsa44>>::try_from(signature_bytes)
        .map_err(|_| JsValue::from_str("Invalid signature length"))?;
    let signature = MlSignature::<MlDsa44>::decode(sig_array).ok_or_else(|| JsValue::from_str("Invalid signature data"))?;
    Ok(verifying_key.verify(message, &signature).is_ok())
}

// SHA-256 & HKDF
#[wasm_bindgen]
pub fn sha256_wasm(data: &[u8]) -> Vec<u8> {
    sha256_hash(data)
}

#[wasm_bindgen]
pub fn hkdf_sha256_wasm(ikm: &[u8], salt: &[u8], info: &[u8], okm_len: usize) -> Result<Vec<u8>, JsValue> {
    hkdf_sha256_derive(ikm, Some(salt.to_vec()), info, okm_len)
}

#[wasm_bindgen]
pub fn sha256_hash(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

#[wasm_bindgen]
pub fn hkdf_sha256_derive(ikm: &[u8], salt: Option<Vec<u8>>, info: &[u8], length: usize) -> Result<Vec<u8>, JsValue> {
    let salt_ref = salt.as_deref();
    let hk = Hkdf::<Sha256>::new(salt_ref, ikm);
    let mut okm = vec![0u8; length];
    hk.expand(info, &mut okm).map_err(|_| JsValue::from_str("HKDF expansion failed"))?;
    Ok(okm)
}

fn kem_id_for(kem: &str) -> Result<u16, JsValue> {
    let normalized = kem.replace(' ', "");
    match normalized.as_str() {
        "X25519" => Ok(HPKE_KEM_ID_X25519),
        "X25519+ML-KEM-768" | "X25519(+ML-KEM-768)" => Ok(HPKE_KEM_ID_X25519_ML_KEM_768),
        _ => Err(JsValue::from_str("Unsupported HPKE KEM ID")),
    }
}

fn hpke_suite_id(kem: &str, kdf: &str, aead: &str) -> Result<Vec<u8>, JsValue> {
    if kdf != "HKDF-SHA256" || aead != "AES-256-GCM" {
        return Err(JsValue::from_str("Unsupported HPKE KDF/AEAD"));
    }
    let kem_id = kem_id_for(kem)?;
    let mut out = Vec::with_capacity(4 + 6);
    out.extend_from_slice(HPKE_SUITE_ID_LABEL.as_bytes());
    out.extend_from_slice(&kem_id.to_be_bytes());
    out.extend_from_slice(&HPKE_KDF_ID_HKDF_SHA256.to_be_bytes());
    out.extend_from_slice(&HPKE_AEAD_ID_AES_256_GCM.to_be_bytes());
    Ok(out)
}

fn hpke_labeled_extract(salt: &[u8], suite_id: &[u8], label: &str, ikm: &[u8]) -> Hkdf<Sha256> {
    let mut labeled_ikm = Vec::with_capacity(
        HPKE_VERSION_LABEL.len() + suite_id.len() + label.len() + ikm.len()
    );
    labeled_ikm.extend_from_slice(HPKE_VERSION_LABEL.as_bytes());
    labeled_ikm.extend_from_slice(suite_id);
    labeled_ikm.extend_from_slice(label.as_bytes());
    labeled_ikm.extend_from_slice(ikm);
    Hkdf::<Sha256>::new(Some(salt), &labeled_ikm)
}

fn hpke_labeled_expand(
    hkdf: &Hkdf<Sha256>,
    suite_id: &[u8],
    label: &str,
    info: &[u8],
    length: usize,
) -> Result<Vec<u8>, JsValue> {
    if length > u16::MAX as usize {
        return Err(JsValue::from_str("HPKE labeled expand length too long"));
    }
    let mut labeled_info = Vec::with_capacity(
        2 + HPKE_VERSION_LABEL.len() + suite_id.len() + label.len() + info.len()
    );
    labeled_info.extend_from_slice(&(length as u16).to_be_bytes());
    labeled_info.extend_from_slice(HPKE_VERSION_LABEL.as_bytes());
    labeled_info.extend_from_slice(suite_id);
    labeled_info.extend_from_slice(label.as_bytes());
    labeled_info.extend_from_slice(info);
    let mut okm = vec![0u8; length];
    hkdf.expand(&labeled_info, &mut okm)
        .map_err(|_| JsValue::from_str("HKDF expansion failed"))?;
    Ok(okm)
}

fn encode_hpke_info_field(value: &str) -> Result<Vec<u8>, JsValue> {
    let bytes = value.as_bytes();
    if bytes.len() > u16::MAX as usize {
        return Err(JsValue::from_str("HPKE info field too long"));
    }
    let mut out = Vec::with_capacity(2 + bytes.len());
    out.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
    out.extend_from_slice(bytes);
    Ok(out)
}

fn build_hpke_info(
    weba_version: &str,
    enc: &str,
    suite: &L2SuiteWasm,
    layer1_ref: &str,
    recipient: &str,
) -> Result<Vec<u8>, JsValue> {
    let mut out = Vec::new();
    out.extend_from_slice(&encode_hpke_info_field(HPKE_INFO_CONTEXT)?);
    out.extend_from_slice(&encode_hpke_info_field(weba_version)?);
    out.extend_from_slice(&encode_hpke_info_field(enc)?);
    out.extend_from_slice(&encode_hpke_info_field(&suite.kem)?);
    out.extend_from_slice(&encode_hpke_info_field(&suite.kdf)?);
    out.extend_from_slice(&encode_hpke_info_field(&suite.aead)?);
    out.extend_from_slice(&encode_hpke_info_field(layer1_ref)?);
    out.extend_from_slice(&encode_hpke_info_field(recipient)?);
    Ok(out)
}

// Padding
#[wasm_bindgen]
pub fn get_padding_target_size(current_size: usize) -> usize {
    let buckets = [1024, 4096, 16384, 65536, 262144, 1048576];
    for &b in buckets.iter() {
        if current_size <= b {
            return b;
        }
    }
    // Round up to nearest 1MB for very large payloads
    ((current_size + 1048575) / 1048576) * 1048576
}

// High-level L2 Envelope Implementation

#[derive(Serialize, Deserialize)]
pub struct L2ConfigWasm {
    pub enabled: bool,
    pub recipient_kid: String,
    pub recipient_x25519: String, // base64url
    pub recipient_pqc: Option<String>, // base64url
    pub layer1_ref: String,
    pub weba_version: Option<String>,
    pub campaign_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Layer2SignatureWasm {
    pub alg: String,
    pub kid: String,
    pub sig: String, // base64url
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct Layer2PayloadWasm {
    pub layer2_plain: serde_json::Value,
    pub layer2_sig: Layer2SignatureWasm,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub _padding: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Layer2EncryptedWasm {
    pub weba_version: String,
    pub layer1_ref: String,
    pub layer2: L2EnvelopeWasm,
    pub meta: L2MetaWasm,
}

#[derive(Serialize, Deserialize)]
pub struct L2EnvelopeWasm {
    pub enc: String,
    pub suite: L2SuiteWasm,
    pub recipient: String,
    pub encapsulated: L2EncapsulatedWasm,
    pub ciphertext: String, // base64url
    pub auth_tag: String,   // base64url (16 bytes)
    pub aad: String,        // base64url
}

#[derive(Serialize, Deserialize)]
pub struct L2SuiteWasm {
    pub kem: String,
    pub kdf: String,
    pub aead: String,
}

#[derive(Serialize, Deserialize)]
pub struct L2EncapsulatedWasm {
    pub classical: String, // base64url
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pqc: Option<String>, // base64url
}

#[derive(Serialize, Deserialize)]
pub struct L2MetaWasm {
    pub created_at: String,
    pub nonce: String, // base64url
    #[serde(skip_serializing_if = "Option::is_none")]
    pub campaign_id: Option<String>,
}

// Helpers for base64url
fn to_b64url(data: &[u8]) -> String {
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data);
    b64.replace('+', "-").replace('/', "_").trim_end_matches('=').to_string()
}

fn from_b64url(s: &str) -> Vec<u8> {
    let mut s = s.replace('-', "+").replace('_', "/");
    while s.len() % 4 != 0 {
        s.push('=');
    }
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &s).unwrap_or_default()
}

#[wasm_bindgen]
pub fn build_l2_envelope_wasm(
    payload_json: &str,
    user_sk: &[u8],
    user_kid: &str,
    config_json: &str,
    created_at: &str,
) -> Result<String, JsValue> {
    let payload_val: serde_json::Value = serde_json::from_str(payload_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid payload JSON: {}", e)))?;
    let config: L2ConfigWasm = serde_json::from_str(config_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid config JSON: {}", e)))?;
    
    let weba_version = config.weba_version.clone().unwrap_or_else(|| "0.1".to_string());
    
    // 1. Sign (or use 'none' if no secret key provided)
    let l2_sig = if user_sk.is_empty() {
        Layer2SignatureWasm {
            alg: "none".to_string(),
            kid: user_kid.to_string(),
            sig: "".to_string(),
            created_at: created_at.to_string(),
        }
    } else {
        let sig_bytes = ed25519_sign(user_sk, payload_json.as_bytes())?;
        Layer2SignatureWasm {
            alg: "Ed25519".to_string(),
            kid: user_kid.to_string(),
            sig: to_b64url(&sig_bytes),
            created_at: created_at.to_string(),
        }
    };

    
    let mut payload = Layer2PayloadWasm {
        layer2_plain: payload_val,
        layer2_sig: l2_sig,
        _padding: None,
    };
    
    // 2. Padding
    let current_bytes = serde_json::to_vec(&payload).unwrap();
    let overhead = 32;
    let target_size = get_padding_target_size(current_bytes.len() + overhead);
    let padding_needed = target_size.saturating_sub(current_bytes.len() + overhead);
    
    if padding_needed > 0 {
        let mut rng = thread_rng();
        let mut pad_bytes = vec![0u8; padding_needed];
        rng.fill_bytes(&mut pad_bytes);
        payload._padding = Some(hex::encode(pad_bytes));
    }
    
    let final_payload_bytes = serde_json::to_vec(&payload).unwrap();
    
    // 3. AAD
    let aad_obj = json!({
        "layer1_ref": config.layer1_ref,
        "recipient": config.recipient_kid,
        "weba_version": weba_version
    });
    let aad_str = serde_json::to_string(&aad_obj).unwrap();
    let aad_bytes = aad_str.as_bytes();
    
    // 4. KEM
    let recipient_pub = from_b64url(&config.recipient_x25519);
    let mut rng = thread_rng();
    let eph_sk = StaticSecret::random_from_rng(&mut rng);
    let eph_pk = XPublicKey::from(&eph_sk);
    let ss1 = eph_sk.diffie_hellman(&XPublicKey::from(
        <[u8; 32]>::try_from(recipient_pub).map_err(|_| JsValue::from_str("Invalid X25519 pubkey"))?
    ));
    
    let mut ikm = ss1.as_bytes().to_vec();
    let mut pqc_enc = None;
    let mut kem_id = "X25519".to_string();
    
    if let Some(pqc_pub_b64) = config.recipient_pqc {
        let pqc_pub = from_b64url(&pqc_pub_b64);
        let res = ml_kem_768_encapsulate(&pqc_pub)?;
        // ss=32, ct=1088
        let ss2 = &res[0..32];
        let ct = &res[32..];
        ikm.extend_from_slice(ss2);
        pqc_enc = Some(to_b64url(ct));
        kem_id = "X25519+ML-KEM-768".to_string();
    }
    
    // 5. KDF
    let suite = L2SuiteWasm {
        kem: kem_id,
        kdf: "HKDF-SHA256".to_string(),
        aead: "AES-256-GCM".to_string(),
    };
    let suite_id = hpke_suite_id(&suite.kem, &suite.kdf, &suite.aead)?;
    let info = build_hpke_info(
        &weba_version,
        "HPKE-v1",
        &suite,
        &config.layer1_ref,
        &config.recipient_kid,
    )?;
    let hk = hpke_labeled_extract(&[], &suite_id, "eae_prk", &ikm);
    let key = hpke_labeled_expand(&hk, &suite_id, "key", &info, 32)?;
    let iv = hpke_labeled_expand(&hk, &suite_id, "iv", &info, 12)?;
    
    // 6. AEAD
    let ct_with_tag = aes_gcm_encrypt(&key, &iv, &final_payload_bytes, aad_bytes)?;
    let auth_tag = &ct_with_tag[ct_with_tag.len()-16..];
    let actual_ct = &ct_with_tag[..ct_with_tag.len()-16];
    
    let nonce = {
        let mut b = [0u8; 16];
        rng.fill_bytes(&mut b);
        to_b64url(&b)
    };
    
    let envelope = Layer2EncryptedWasm {
        weba_version: weba_version,
        layer1_ref: config.layer1_ref,
        layer2: L2EnvelopeWasm {
            enc: "HPKE-v1".to_string(),
            suite,
            recipient: config.recipient_kid,
            encapsulated: L2EncapsulatedWasm {
                classical: to_b64url(eph_pk.as_bytes()),
                pqc: pqc_enc,
            },
            ciphertext: to_b64url(actual_ct),
            auth_tag: to_b64url(auth_tag),
            aad: to_b64url(aad_bytes),
        },
        meta: L2MetaWasm {
            created_at: created_at.to_string(),
            nonce,
            campaign_id: config.campaign_id,
        },
    };
    
    serde_json::to_string(&envelope).map_err(|e| JsValue::from_str(&format!("Failed to serialize envelope: {}", e)))
}

#[wasm_bindgen]
pub fn decrypt_l2_envelope_wasm(
    envelope_json: &str,
    recipient_sk: &[u8],
    pqc_sk: Option<Vec<u8>>,
) -> Result<String, JsValue> {
    let env: Layer2EncryptedWasm = serde_json::from_str(envelope_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid envelope JSON: {}", e)))?;
    
    let aad_bytes = from_b64url(&env.layer2.aad);
    let aad_str = String::from_utf8(aad_bytes.clone()).map_err(|_| JsValue::from_str("Invalid AAD encoding"))?;
    let aad_val: serde_json::Value = serde_json::from_str(&aad_str).unwrap();
    
    if aad_val["layer1_ref"] != env.layer1_ref
        || aad_val["recipient"] != env.layer2.recipient
        || aad_val["weba_version"] != env.weba_version
    {
         return Err(JsValue::from_str("AAD mismatch"));
    }
    
    // 1. KEM
    let eph_pub = from_b64url(&env.layer2.encapsulated.classical);
    let mut sk_bytes = [0u8; 32];
    sk_bytes.copy_from_slice(recipient_sk);
    let sk = StaticSecret::from(sk_bytes);
    let ss1 = sk.diffie_hellman(&XPublicKey::from(
        <[u8; 32]>::try_from(eph_pub).map_err(|_| JsValue::from_str("Invalid ephemeral pubkey"))?
    ));
    
    let mut ikm = ss1.as_bytes().to_vec();
    if let Some(pqc_enc_b64) = env.layer2.encapsulated.pqc {
        let pqc_sk_bytes = pqc_sk.ok_or_else(|| JsValue::from_str("Missing PQC KEM for envelope"))?;
        let ct_bytes = from_b64url(&pqc_enc_b64);
        let ss2 = ml_kem_768_decapsulate(&pqc_sk_bytes, &ct_bytes)?;
        ikm.extend_from_slice(&ss2);
    }
    
    // 2. KDF
    let suite_id = hpke_suite_id(&env.layer2.suite.kem, &env.layer2.suite.kdf, &env.layer2.suite.aead)?;
    let info = build_hpke_info(
        &env.weba_version,
        &env.layer2.enc,
        &env.layer2.suite,
        &env.layer1_ref,
        &env.layer2.recipient,
    )?;
    let hk = hpke_labeled_extract(&[], &suite_id, "eae_prk", &ikm);
    let key = hpke_labeled_expand(&hk, &suite_id, "key", &info, 32)?;
    let iv = hpke_labeled_expand(&hk, &suite_id, "iv", &info, 12)?;
    
    // 3. AEAD
    let ct = from_b64url(&env.layer2.ciphertext);
    let tag = from_b64url(&env.layer2.auth_tag);
    let mut ct_with_tag = ct;
    ct_with_tag.extend_from_slice(&tag);
    
    let pt = aes_gcm_decrypt(&key, &iv, &ct_with_tag, &aad_str.as_bytes())
        .map_err(|_| JsValue::from_str("Decryption failed"))?;
    
    String::from_utf8(pt).map_err(|_| JsValue::from_str("Invalid UTF-8 in plaintext"))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256() {
        let data = b"hello";
        let hash = sha256_hash(data);
        assert_eq!(hash.len(), 32);
        // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        assert_eq!(format!("{:x}", sha2::Sha256::digest(data)), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    }

    #[test]
    fn test_padding_logic() {
        assert_eq!(get_padding_target_size(500), 1024);
        assert_eq!(get_padding_target_size(1024), 1024);
        assert_eq!(get_padding_target_size(1025), 4096);
        assert_eq!(get_padding_target_size(70000), 262144);
    }

    #[test]
    fn test_aes_gcm_roundtrip() {
        let key = [0u8; 32];
        let iv = [0u8; 12];
        let aad = b"context";
        let plaintext = b"secret message";

        let ciphertext = aes_gcm_encrypt(&key, &iv, plaintext, aad).unwrap();
        let decrypted = aes_gcm_decrypt(&key, &iv, &ciphertext, aad).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_constant_time_equal() {
        assert!(constant_time_equal(b"abc", b"abc"));
        assert!(!constant_time_equal(b"abc", b"abd"));
        assert!(!constant_time_equal(b"abc", b"abcd"));
    }

    #[test]
    fn test_x25519_handshake() {
        let kp1 = x25519_generate_keypair().unwrap();
        let sk1 = &kp1[0..32];
        let pk1 = &kp1[32..64];

        let kp2 = x25519_generate_keypair().unwrap();
        let sk2 = &kp2[0..32];
        let pk2 = &kp2[32..64];

        let ss1 = x25519_get_shared_secret(sk1, pk2).unwrap();
        let ss2 = x25519_get_shared_secret(sk2, pk1).unwrap();

        assert_eq!(ss1, ss2);
    }

    #[test]
    fn test_ml_dsa_roundtrip() {
        let kp = ml_dsa_44_generate_keypair().unwrap();
        let sk = &kp[0..2560];
        let pk = &kp[2560..];
        let msg = b"signed message";

        let sig = ml_dsa_44_sign(sk, msg).unwrap();
        let valid = ml_dsa_44_verify(pk, msg, &sig).unwrap();
        assert!(valid);
    }
}
