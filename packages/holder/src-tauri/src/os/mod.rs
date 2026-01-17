use crate::SignerError;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use p256::elliptic_curve::sec1::ToEncodedPoint;

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use security_framework::item::{
        ItemClass, ItemSearchOptions, Reference, SearchResult, Limit,
    };
    use security_framework::key::SecKey;
    use security_framework::access_control::SecAccessControl;
    use security_framework_sys::item::kSecAttrKeyTypeECSECPrimeRandom;
    use security_framework_sys::key::{kSecAttrKeyType, kSecAttrKeySizeInBits, kSecAttrTokenID, kSecAttrTokenIDSecureEnclave};
    use std::ptr;

    const KEY_LABEL: &str = "io.github.masanork.tobari.signer.device-key";

    pub fn get_or_create_device_key() -> Result<SecKey, SignerError> {
        // 1. Search for existing key
        let mut search = ItemSearchOptions::new();
        search.class(ItemClass::key());
        search.label(KEY_LABEL);
        search.load_refs(true);
        search.limit(Limit::One);

        match search.search() {
            Ok(results) => {
                if let Some(SearchResult::Ref(Reference::Key(key))) = results.first() {
                    return Ok(key.clone());
                }
            }
            Err(_) => {} // Not found or error, proceed to create
        }

        // 2. Create new key in Secure Enclave
        // Note: Creating key directly via SecKeyCreateRandomKey requires dictionary
        // Since security-framework doesn't wrap SecKeyCreateRandomKey fully with Secure Enclave attributes easily,
        // we might use a simpler approach or raw CFDictionary.
        // For simplicity in this PoC, we will fall back to software key in Keychain if SE is hard from Rust.
        // But let's try to do it right.
        
        // Actually, security-framework's Key::generate supports basic types.
        // But Secure Enclave requires specific attributes.
        // Let's assume standard Keychain key for now (still protected by user login/biometrics if set).
        
        // TODO: Implement Secure Enclave specific generation.
        // For now, generating a standard EC P-256 key in Keychain.
        
        use security_framework::key::GenerateKeyOptions;
        // P-256 = 256 bits
        let key = GenerateKeyOptions::default()
            .key_type(security_framework::key::KeyType::ec())
            .key_size_in_bits(256)
            .label(KEY_LABEL)
            .token(security_framework::key::Token::SecureEnclave) // Try SE
            .generate()
            .or_else(|_| {
                // Fallback to software keychain if SE fails (e.g. simulator)
                GenerateKeyOptions::default()
                    .key_type(security_framework::key::KeyType::ec())
                    .key_size_in_bits(256)
                    .label(KEY_LABEL)
                    .generate()
            })
            .map_err(|e| SignerError::Internal(format!("Failed to generate device key: {}", e)))?;

        Ok(key)
    }

    pub fn sign_data(data: &[u8]) -> Result<Vec<u8>, SignerError> {
        // Not used for encryption, but useful to test auth
        let key = get_or_create_device_key()?;
        // Signing triggers auth
        // Use SHA256
        let signature = key.create_signature(security_framework::key::Algorithm::ECDSASignatureMessageX962SHA256, data)
            .map_err(|e| SignerError::Internal(format!("Sign failed (Auth?): {}", e)))?;
        Ok(signature)
    }
    
    // macOS Keychain gives us SecKey. We need raw scalar for ECIES?
    // No, we cannot get raw private key from Secure Enclave.
    // We MUST use SecKeyCreateEncryptedData (HPKE/ECIES) or KeyAgreement (ECDH).
    // security-framework supports `create_shared_secret` (ECDH).
    
    pub fn derive_shared_secret(public_key_bytes: &[u8]) -> Result<Vec<u8>, SignerError> {
        let priv_key = get_or_create_device_key()?;
        
        // Import ephemeral public key
        // Note: SecKeyCreateFromData requires proper header/format
        let pub_key = SecKey::import(
            security_framework::import_export::ImportOptions::default().filename("ephem.pub").items(public_key_bytes)
            // This is tricky. Importing raw P-256 point to SecKey.
        );
        
        // Easier approach: Use the private key to perform ECDH
        // But security-framework's `exchange_key` needs a public key `SecKey`.
        
        // TODO: Import raw bytes (04||x||y) as SecKey.
        Err(SignerError::Internal("ECDH with Keychain key not yet fully implemented".to_string()))
    }
}

pub fn get_device_public_key_os() -> Result<serde_json::Value, SignerError> {
    #[cfg(target_os = "macos")]
    {
        let key = macos::get_or_create_device_key()?;
        let pub_key = key.public_key().ok_or(SignerError::Internal("No public key".to_string()))?;
        let bytes = pub_key.external_representation().ok_or(SignerError::Internal("Export failed".to_string()))?;
        
        // Bytes should be 04 || X || Y (65 bytes) for P-256
        if bytes.len() != 65 {
             return Err(SignerError::Internal(format!("Unexpected key size: {}", bytes.len())));
        }
        
        let x = &bytes[1..33];
        let y = &bytes[33..65];
        
        return Ok(serde_json::json!({
            "kty": "EC",
            "crv": "P-256",
            "x": URL_SAFE_NO_PAD.encode(x),
            "y": URL_SAFE_NO_PAD.encode(y)
        }));
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        Err(SignerError::Internal("OS KeyStore not supported on this platform".to_string()))
    }
}

pub fn decrypt_data_os(data: serde_json::Value) -> Result<serde_json::Value, SignerError> {
    // For decryption, we need ECDH using the stored private key.
    // 1. Get ephemeral public key from data
    // 2. Perform ECDH (triggers Touch ID if configured)
    // 3. Derive AES key -> Decrypt
    
    Err(SignerError::Internal("OS decryption not implemented".to_string()))
}
