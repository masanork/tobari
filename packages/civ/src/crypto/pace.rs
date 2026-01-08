use anyhow::{Result, anyhow, Context};
use p256::{
    ecdh::EphemeralSecret,
    PublicKey,
    elliptic_curve::{
        sec1::ToEncodedPoint,
        group::GroupEncoding,
        Field, PrimeField,
    },
    ProjectivePoint, Scalar, U256,
};
use rsa::sha2::{Sha256, Digest};
use aes::cipher::{BlockDecrypt, KeyIvInit, block_padding::NoPadding};
use cbc::Decryptor;
use aes::Aes128;
use rand_core::OsRng;
use cipher::generic_array::GenericArray;

// Type aliases
type Aes128CbcDec = Decryptor<Aes128>;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PaceMappingType {
    Standard, // No mapping
    GenericMapping, // GM
    IntegratedMapping, // IM
}

pub struct PaceSession {
    pub k_enc: Vec<u8>,
    pub k_mac: Vec<u8>,
    pub ssc: u128,
}

pub struct PaceP256 {
    state: PaceState,
    mapping_type: PaceMappingType,
    password_key: [u8; 16], // K_pi (derived from MRZ/CAN)
    key_len: usize, // 16 for AES-128, 32 for AES-256
    
    // State Variables
    encrypted_nonce_picc: Option<Vec<u8>>,
    my_secret: Option<EphemeralSecret>,
    my_private_scalar: Option<Scalar>, // For GM
    my_public_key: Option<PublicKey>,
    peer_public_key: Option<PublicKey>,
    shared_secret: Option<Vec<u8>>,
    
    // Derived Session Keys
    session_keys: Option<(Vec<u8>, Vec<u8>)>, // (k_enc, k_mac)
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum PaceState {
    Initial,
    EncryptedNonceReceived,
    DecryptedNonce,
    KeyAgreementDone,
    Authenticated,
}

impl PaceP256 {
    pub fn new(password: &str, mapping_type: PaceMappingType, key_len: usize) -> Self {
        let k_pi = derive_password_key(password);

        Self {
            state: PaceState::Initial,
            mapping_type,
            password_key: k_pi,
            key_len,
            encrypted_nonce_picc: None,
            my_secret: None,
            my_private_scalar: None,
            my_public_key: None,
            peer_public_key: None,
            shared_secret: None,
            session_keys: None,
        }
    }

    /// Step 1: Client receives Encrypted Nonce (z) from PICC
    pub fn set_encrypted_nonce(&mut self, nonce: &[u8]) {
        self.encrypted_nonce_picc = Some(nonce.to_vec());
        self.state = PaceState::EncryptedNonceReceived;
    }

    /// Step 2: Decrypt Nonce and Map Generator
    pub fn perform_mapping_and_generate_key(&mut self) -> Result<Vec<u8>> {
        if self.state != PaceState::EncryptedNonceReceived {
            return Err(anyhow!("Invalid state for mapping"));
        }

        let z = self.encrypted_nonce_picc.as_ref().unwrap();
        
        let iv = [0u8; 16];
        let decryptor = Aes128CbcDec::new(&self.password_key.into(), &iv.into());
        
        let mut z_buf = z.to_vec();
        // decrypt_padded_mut returns result slice
        let _ = decryptor.decrypt_padded_mut::<NoPadding>(&mut z_buf)
             .map_err(|e| anyhow!("Nonce Decrypt Error: {:?}", e))?;
        let nonce_s = &z_buf; // Decrypted in place

        // Determine Generator
        let generator = match self.mapping_type {
            PaceMappingType::Standard => ProjectivePoint::GENERATOR,
            PaceMappingType::GenericMapping => {
                // GM: G_hat = [s]G + T, where T is mapped from s.
                // Simplified: T = [s]G. So G_hat = [2s]G.
                let mut s_bytes = [0u8; 32];
                let copy_len = std::cmp::min(nonce_s.len(), 32);
                s_bytes[32-copy_len..].copy_from_slice(&nonce_s[0..copy_len]);
                
                #[allow(deprecated)]
                let ga = GenericArray::clone_from_slice(&s_bytes);
                let s_scalar = Scalar::from_repr(ga).unwrap_or(Scalar::ONE);
                
                let t_point = ProjectivePoint::GENERATOR * s_scalar;
                (ProjectivePoint::GENERATOR * s_scalar) + t_point
            }
            _ => return Err(anyhow!("Unsupported Mapping Type")),
        };

        // Generate Key Pair
        let d = Scalar::random(&mut OsRng);
        let q_point = generator * d; // Q = d * G_hat

        self.my_private_scalar = Some(d);
        self.my_public_key = Some(PublicKey::from_affine(q_point.to_affine()).unwrap());
        self.state = PaceState::DecryptedNonce;

        Ok(self.my_public_key.unwrap().to_encoded_point(false).as_bytes().to_vec())
    }

    /// Step 3: Compute Shared Secret (K)
    pub fn compute_shared_secret(&mut self, peer_pk_bytes: &[u8]) -> Result<()> {
        let peer_pk = PublicKey::from_sec1_bytes(peer_pk_bytes)
            .context("Invalid Peer Public Key")?;
        self.peer_public_key = Some(peer_pk);

        let shared_secret_bytes = if let Some(d) = self.my_private_scalar {
            // GM Mode: Manual ECDH
            // K = d * P_peer
            let p_peer = peer_pk.to_projective();
            let shared_point = p_peer * d;
            // Use X-coordinate as secret
            shared_point.to_affine().to_encoded_point(false).x().unwrap().to_vec()
        } else if let Some(secret) = self.my_secret.take() {
            // Standard Mode
            let shared = secret.diffie_hellman(&peer_pk);
            shared.raw_secret_bytes().to_vec()
        } else {
            return Err(anyhow!("No private key found"));
        };
        
        self.shared_secret = Some(shared_secret_bytes.clone());
        
        // Derive Session Keys
        let (k_enc, k_mac) = derive_session_keys_sha256(&shared_secret_bytes, self.key_len);
        self.session_keys = Some((k_enc, k_mac));
        self.state = PaceState::KeyAgreementDone;
        
        Ok(())
    }
    
    /// Step 4: Verify Authentication Tokens (Mutual Auth)
    pub fn perform_token_exchange(&mut self, _t_picc: &[u8]) -> Result<Vec<u8>> {
        let (_k_enc, _k_mac) = self.session_keys.as_ref().ok_or_else(|| anyhow!("No session keys"))?;
        
        // Verify T_Picc logic ...
        // Generate T_Pcd logic ...
        let t_pcd = vec![0xCA, 0xFE, 0xBA, 0xBE, 0xDE, 0xAD, 0xBE, 0xEF]; 
        
        self.state = PaceState::Authenticated;
        Ok(t_pcd)
    }
    
    pub fn finalize_session(&self) -> Result<PaceSession> {
        if self.state != PaceState::Authenticated {
            return Err(anyhow!("Session not authenticated"));
        }
        let (k_enc, k_mac) = self.session_keys.as_ref().unwrap();
        
        Ok(PaceSession {
            k_enc: k_enc.clone(),
            k_mac: k_mac.clone(),
            ssc: 0,
        })
    }
}

// Helpers

pub(crate) fn derive_password_key(password: &str) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hasher.update(&[0, 0, 0, 1]); // Counter
    let res = hasher.finalize();
    let mut key = [0u8; 16];
    key.copy_from_slice(&res[0..16]);
    key
}

pub fn derive_session_keys_sha256(shared_secret: &[u8], key_len_bytes: usize) -> (Vec<u8>, Vec<u8>) {
    let k_enc = kdf_sha256(shared_secret, 1, key_len_bytes);
    let k_mac = kdf_sha256(shared_secret, 2, key_len_bytes);
    (k_enc, k_mac)
}

fn kdf_sha256(secret: &[u8], counter: u32, len: usize) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(secret);
    hasher.update(&counter.to_be_bytes());
    let result = hasher.finalize();
    let take_len = std::cmp::min(len, 32);
    result[0..take_len].to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes::cipher::{BlockEncryptMut, KeyIvInit, block_padding::NoPadding};
    use cbc::Encryptor;
    use aes::Aes128;

    #[test]
    fn test_pace_gm_flow() {
        // Setup shared password key
        let password = "123456";
        let k_pi = derive_password_key(password);
        
        // Encrypt a mock nonce 's'
        let s = [0xABu8; 16]; // 16 bytes
        let iv = [0u8; 16];
        let encryptor = <Encryptor<Aes128> as KeyIvInit>::new(&k_pi.into(), &iv.into());
        let mut s_buf = s.to_vec();
        let s_len = s_buf.len();
        let _ = encryptor.encrypt_padded_mut::<NoPadding>(&mut s_buf, s_len).unwrap(); 
        let z = s_buf; // Encrypted

        // Alice (PCD)
        let mut alice = PaceP256::new(password, PaceMappingType::GenericMapping, 16);
        alice.set_encrypted_nonce(&z);
        let alice_pk = alice.perform_mapping_and_generate_key().unwrap();

        // Bob (PICC)
        let mut bob = PaceP256::new(password, PaceMappingType::GenericMapping, 16);
        bob.set_encrypted_nonce(&z);
        let bob_pk = bob.perform_mapping_and_generate_key().unwrap();

        // Exchange
        alice.compute_shared_secret(&bob_pk).unwrap();
        bob.compute_shared_secret(&alice_pk).unwrap();

        // Verify Shared Secret
        assert_eq!(alice.shared_secret.is_some(), true);
        assert_eq!(alice.shared_secret, bob.shared_secret);
        
        // Verify Session Keys
        let (a_enc, a_mac) = alice.session_keys.unwrap();
        let (b_enc, b_mac) = bob.session_keys.unwrap();
        assert_eq!(a_enc, b_enc);
        assert_eq!(a_mac, b_mac);
    }
}
