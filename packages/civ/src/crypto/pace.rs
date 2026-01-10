use anyhow::{Result, anyhow, Context};
use p256::{
    ecdh::EphemeralSecret,
    PublicKey, EncodedPoint,
    elliptic_curve::{
        sec1::{ToEncodedPoint, FromEncodedPoint},
        Field, PrimeField,
    },
    ProjectivePoint, Scalar,
};
use rsa::sha2::{Sha256, Digest};
use aes::cipher::{BlockDecryptMut, KeyIvInit, KeyInit, block_padding::NoPadding};
use cbc::Decryptor;
use aes::Aes128;
use cmac::{Cmac, Mac};
use rand_core::OsRng;
use generic_array::GenericArray;

// Type aliases
type Aes128CbcDec = Decryptor<Aes128>;
type Aes128Cmac = Cmac<Aes128>;

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
                // GM: G_hat = [s]G + Map(s)
                // s: Scalar derived from decrypted nonce
                // Map(s): Point derived from s (Try-and-Increment X-coordinate)
                
                // 1. Derive scalar s
                let mut s_bytes = [0u8; 32];
                let copy_len = std::cmp::min(nonce_s.len(), 32);
                s_bytes[32-copy_len..].copy_from_slice(&nonce_s[0..copy_len]);
                let ga = *GenericArray::from_slice(&s_bytes);
                let s_scalar = Scalar::from_repr(ga).unwrap_or(Scalar::ONE);
                
                // 2. Map(s) -> T
                // Try to find a valid point T where T.x = s (or derivative)
                let mut t_point = Option::<ProjectivePoint>::None;
                let mut candidate_bytes = s_bytes; // Start with s
                
                for _ in 0..100 { // Max retries
                    // Construct compressed point: 0x02 || candidate
                    let mut encoded = Vec::with_capacity(33);
                    encoded.push(0x02); // Compressed, even Y
                    encoded.extend_from_slice(&candidate_bytes);
                    
                    if let Ok(ep) = EncodedPoint::from_bytes(&encoded) {
                        // Check if valid point on curve
                        // EncodedPoint doesn't verify curve equation immediately?
                        // Convert to Projective/Affine to verify.
                        // ProjectivePoint::from_encoded_point returns CtOption
                        let ct_opt = ProjectivePoint::from_encoded_point(&ep);
                        if bool::from(ct_opt.is_some()) {
                            t_point = Some(ct_opt.unwrap());
                            break;
                        }
                    }
                    
                    // Failed, generate next candidate: H(candidate)
                    let mut hasher = Sha256::new();
                    hasher.update(candidate_bytes);
                    let hash = hasher.finalize();
                    candidate_bytes.copy_from_slice(&hash);
                }
                
                let t = t_point.ok_or(anyhow!("Failed to map nonce to point"))?;
                
                // G_hat = [s]G + T
                (ProjectivePoint::GENERATOR * s_scalar) + t
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
    /// Input: Token from PICC (T_Picc)
    /// Output: Token to send to PICC (T_Pcd)
    pub fn perform_token_exchange(&mut self, peer_token: &[u8]) -> Result<Vec<u8>> {
        let (_k_enc, k_mac) = self.session_keys.as_ref().ok_or_else(|| anyhow!("No session keys"))?;
        
        let my_pk = self.my_public_key.as_ref().ok_or(anyhow!("No My PK"))?
            .to_encoded_point(false).as_bytes().to_vec();
        let peer_pk = self.peer_public_key.as_ref().ok_or(anyhow!("No Peer PK"))?
            .to_encoded_point(false).as_bytes().to_vec();

        // According to ICAO 9303-11:
        // T_PCD = MAC(K_mac, PK_PICC)
        // T_PICC = MAC(K_mac, PK_PCD)

        // 1. Verify Peer Token
        if !peer_token.is_empty() {
            let mut mac = <Aes128Cmac as KeyInit>::new_from_slice(k_mac)
                .map_err(|e| anyhow!("MAC Init error: {}", e))?;
            // If I am PCD, peer is PICC, so I expect T_Picc = MAC(K_mac, PK_Pcd)
            // If I am PICC, peer is PCD, so I expect T_Pcd = MAC(K_mac, PK_Picc)
            // In both cases, the peer tokens are computed over OUR public key.
            mac.update(&my_pk);
            let expected = mac.finalize().into_bytes();
            let expected_8 = &expected[0..8];
            
            if peer_token != expected_8 {
                return Err(anyhow!("Token Verification Failed. Expected: {:?}, Got: {:?}", expected_8, peer_token));
            }
        }

        // 2. Generate My Token
        // My token is computed over the PEER's public key.
        let mut mac = <Aes128Cmac as KeyInit>::new_from_slice(k_mac)
            .map_err(|e| anyhow!("MAC Init error: {}", e))?;
        mac.update(&peer_pk);
        let result = mac.finalize().into_bytes();
        
        let my_token = result[0..8].to_vec();
        
        self.state = PaceState::Authenticated;
        Ok(my_token)
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
    hasher.update([0, 0, 0, 1]); // Counter
    let hash = hasher.finalize();
    let mut key = [0u8; 16];
    key.copy_from_slice(&hash[0..16]);
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
    hasher.update(counter.to_be_bytes());
    let hash = hasher.finalize();
    let take_len = std::cmp::min(len, 32);
    hash[0..take_len].to_vec()
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