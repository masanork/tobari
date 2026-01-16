use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use anyhow::{anyhow, Result};
use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

/// The version of the envelope format.
pub const ENVELOPE_VERSION: &str = "2.0";

/// Algorithm identifier for the payload encryption.
pub const ALG_AES_256_GCM: &str = "AES-256-GCM";

/// Represents the encrypted envelope containing the payload and recipients.
#[derive(Debug, Serialize, Deserialize)]
pub struct Envelope {
    pub version: String,
    pub alg: String,
    #[serde(with = "base64_url")]
    pub iv: Vec<u8>,
    #[serde(with = "base64_url")]
    pub ciphertext: Vec<u8>,
    #[serde(with = "base64_url")]
    pub tag: Vec<u8>,
    pub recipients: Vec<Recipient>,
}

/// Represents a recipient who can decrypt the envelope.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Recipient {
    /// WebAuthn PRF-based recipient (Portable).
    WebauthnPrf {
        kid: String,
        #[serde(with = "base64_url")]
        salt: Vec<u8>,
        #[serde(with = "base64_url")]
        iv: Vec<u8>,
        #[serde(with = "base64_url")]
        encrypted_key: Vec<u8>,
        #[serde(with = "base64_url")]
        tag: Vec<u8>,
    },
    /// HPKE P-256 based recipient (Platform Native).
    HpkeP256 {
        kid: String,
        #[serde(with = "base64_url")]
        enc: Vec<u8>,
        #[serde(with = "base64_url")]
        encrypted_key: Vec<u8>,
        // Note: For standard HPKE, tag is usually part of ciphertext,
        // but we keep the structure consistent if needed.
        // If the implementation outputs separate tag, use this.
        #[serde(skip_serializing_if = "Option::is_none", default)]
        #[serde(with = "base64_url_opt")]
        tag: Option<Vec<u8>>,
    },
}

impl Envelope {
    /// Create a new Envelope by encrypting the payload with a generated DEK.
    /// Note: This method only creates the payload encryption. Recipients must be added separately.
    pub fn new(payload: &[u8]) -> Result<(Self, Vec<u8>)> {
        let mut rng = rand::thread_rng();

        // 1. Generate DEK (32 bytes for AES-256)
        let mut dek = vec![0u8; 32];
        rng.fill_bytes(&mut dek);

        // 2. Generate IV (12 bytes)
        let mut iv = vec![0u8; 12];
        rng.fill_bytes(&mut iv);

        // 3. Encrypt Payload
        let key = Key::<Aes256Gcm>::from_slice(&dek);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(&iv);

        // Aes256Gcm::encrypt returns ciphertext + tag appended.
        // We need to split them for our format.
        let encrypted_data = cipher
            .encrypt(nonce, payload)
            .map_err(|e| anyhow!("Encryption failed: {}", e))?;

        // Split tag (last 16 bytes)
        if encrypted_data.len() < 16 {
            return Err(anyhow!("Encryption output too short"));
        }
        let split_idx = encrypted_data.len() - 16;
        let ciphertext = encrypted_data[..split_idx].to_vec();
        let tag = encrypted_data[split_idx..].to_vec();

        let envelope = Envelope {
            version: ENVELOPE_VERSION.to_string(),
            alg: ALG_AES_256_GCM.to_string(),
            iv,
            ciphertext,
            tag,
            recipients: Vec::new(),
        };

        Ok((envelope, dek))
    }

    /// Add a WebAuthn PRF recipient.
    ///
    /// # Arguments
    /// * `dek` - The Document Encryption Key to wrap.
    /// * `kid` - The Credential ID (or user-friendly name).
    /// * `prf_output` - The raw output from the authenticator (32 bytes).
    pub fn add_prf_recipient(&mut self, _dek: &[u8], _kid: String, _prf_output: &[u8]) -> Result<()> {
        // Obsolete method, use add_prf_recipient_with_salt
        Err(anyhow!("Use add_prf_recipient_with_salt instead"))
    }

    pub fn add_prf_recipient_with_salt(
        &mut self,
        dek: &[u8],
        kid: String,
        salt: &[u8],
        prf_output: &[u8],
    ) -> Result<()> {
        // 1. Derive KEK from PRF Output
        let kek = derive_kek_from_prf(prf_output)?;

        // 2. Wrap DEK
        let (encrypted_key, iv, tag) = encrypt_key_wrap(&kek, dek)?;

        // 3. Add Recipient
        self.recipients.push(Recipient::WebauthnPrf {
            kid,
            salt: salt.to_vec(),
            iv,
            encrypted_key,
            tag,
        });

        Ok(())
    }

    /// Decrypt the envelope using a WebAuthn PRF output.
    pub fn decrypt_with_prf(&self, kid: &str, prf_output: &[u8]) -> Result<Vec<u8>> {
        // 1. Find Recipient
        let recipient = self
            .recipients
            .iter()
            .find_map(|r| match r {
                Recipient::WebauthnPrf {
                    kid: k,
                    encrypted_key,
                    iv,
                    tag,
                    salt: _,
                } if k == kid => Some((encrypted_key, iv, tag)),
                _ => None,
            })
            .ok_or_else(|| anyhow!("Recipient not found: {}", kid))?;

        let (encrypted_key, iv, tag) = recipient;

        // 2. Derive KEK
        let kek = derive_kek_from_prf(prf_output)?;

        // 3. Unwrap DEK
        let dek = decrypt_key_wrap(&kek, encrypted_key, iv, tag)?;

        // 4. Decrypt Payload
        self.decrypt_payload(&dek)
    }

    fn decrypt_payload(&self, dek: &[u8]) -> Result<Vec<u8>> {
        let key = Key::<Aes256Gcm>::from_slice(dek);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(&self.iv);

        // Combine ciphertext and tag for decryption
        let mut encrypted_data = self.ciphertext.clone();
        encrypted_data.extend_from_slice(&self.tag);

        let payload = cipher
            .decrypt(nonce, encrypted_data.as_ref())
            .map_err(|e| anyhow!("Payload decryption failed: {}", e))?;

        Ok(payload)
    }
}

/// Derive KEK (Key Encryption Key) from PRF Output using HKDF.
fn derive_kek_from_prf(prf_output: &[u8]) -> Result<Vec<u8>> {
    let hkdf = Hkdf::<Sha256>::new(None, prf_output);
    let mut okm = [0u8; 32]; // AES-256 key
    hkdf.expand(b"tobari-prf-kek-v1", &mut okm)
        .map_err(|_| anyhow!("HKDF expansion failed"))?;
    Ok(okm.to_vec())
}

/// Encrypt a key (Key Wrap) using AES-GCM.
fn encrypt_key_wrap(kek: &[u8], plaintext_key: &[u8]) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>)> {
    let key = Key::<Aes256Gcm>::from_slice(kek);
    let cipher = Aes256Gcm::new(key);
    
    let mut rng = rand::thread_rng();
    let mut iv = vec![0u8; 12];
    rng.fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);

    let encrypted_data = cipher
        .encrypt(nonce, plaintext_key)
        .map_err(|e| anyhow!("Key wrap failed: {}", e))?;

    // Split tag
    let split_idx = encrypted_data.len() - 16;
    let ciphertext = encrypted_data[..split_idx].to_vec();
    let tag = encrypted_data[split_idx..].to_vec();

    Ok((ciphertext, iv, tag))
}

/// Decrypt a key (Key Unwrap) using AES-GCM.
fn decrypt_key_wrap(
    kek: &[u8],
    encrypted_key: &[u8],
    iv: &[u8],
    tag: &[u8],
) -> Result<Vec<u8>> {
    let key = Key::<Aes256Gcm>::from_slice(kek);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(iv);

    let mut encrypted_data = encrypted_key.to_vec();
    encrypted_data.extend_from_slice(tag);

    let plaintext = cipher
        .decrypt(nonce, encrypted_data.as_ref())
        .map_err(|e| anyhow!("Key unwrap failed: {}", e))?;

    Ok(plaintext)
}

// Helpers for Base64URL serialization
mod base64_url {
    use serde::{Deserialize, Deserializer, Serializer};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    pub fn serialize<S>(bytes: &Vec<u8>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&URL_SAFE_NO_PAD.encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        URL_SAFE_NO_PAD
            .decode(s)
            .map_err(serde::de::Error::custom)
    }
}

mod base64_url_opt {
    use serde::{Deserialize, Deserializer, Serializer};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    pub fn serialize<S>(bytes: &Option<Vec<u8>>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match bytes {
            Some(b) => serializer.serialize_str(&URL_SAFE_NO_PAD.encode(b)),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Vec<u8>>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let opt_s: Option<String> = Option::deserialize(deserializer)?;
        match opt_s {
            Some(s) => URL_SAFE_NO_PAD
                .decode(s)
                .map(Some)
                .map_err(serde::de::Error::custom),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_envelope_prf_roundtrip() {
        let payload = b"Hello Tobari Secure World";
        let (mut envelope, dek) = Envelope::new(payload).unwrap();

        let kid = "yubikey-1";
        let salt = b"some-random-salt-32-bytes-long-000";
        // Simulate PRF output (usually 32 bytes)
        let prf_output = b"simulator-prf-output-32-bytes-00";

        // Add recipient
        envelope
            .add_prf_recipient_with_salt(&dek, kid.to_string(), salt, prf_output)
            .unwrap();

        // Check if recipient is added
        assert_eq!(envelope.recipients.len(), 1);

        // Serialize/Deserialize to verify JSON format
        let json = serde_json::to_string(&envelope).unwrap();
        println!("JSON: {}", json);
        let loaded_envelope: Envelope = serde_json::from_str(&json).unwrap();

        // Decrypt
        let decrypted = loaded_envelope.decrypt_with_prf(kid, prf_output).unwrap();
        assert_eq!(decrypted, payload);
    }
}
