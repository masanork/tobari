use anyhow::{Result, anyhow};
use crate::crypto::pace::{PaceP256, PaceMappingType, PaceSession};
use crate::crypto::sm::{AesSecureMessaging, SecureMessagingSession};
use aes::cipher::{BlockEncryptMut, KeyIvInit, block_padding::NoPadding};
use cbc::Encryptor;
use aes::Aes128;

type Aes128CbcEnc = Encryptor<Aes128>;

pub struct MockPassport {
    password: String,
    pace_state: PaceP256,
    secure_session: Option<AesSecureMessaging>,
}

impl MockPassport {
    pub fn new(password: &str) -> Self {
        Self {
            password: password.to_string(),
            pace_state: PaceP256::new(password, PaceMappingType::GenericMapping, 16),
            secure_session: None,
        }
    }

    pub fn handle_apdu(&mut self, apdu_bytes: &[u8]) -> Vec<u8> {
        if apdu_bytes.len() < 4 {
            return vec![0x6F, 0x00];
        }
        let cla = apdu_bytes[0];
        let ins = apdu_bytes[1];
        let p1 = apdu_bytes[2];
        let p2 = apdu_bytes[3];
        
        let (_real_cla, _real_ins, _real_p1, _real_p2, data) = if is_sm(cla) {
            return vec![0x69, 0x82]; 
        } else {
            let lc = if apdu_bytes.len() > 4 { apdu_bytes[4] as usize } else { 0 };
            let data = if apdu_bytes.len() >= 5 + lc {
                &apdu_bytes[5..5+lc]
            } else {
                &[]
            };
            (cla, ins, p1, p2, data)
        };

        match (ins, p1, p2) {
            (0x22, 0xC1, 0xA4) => {
                vec![0x90, 0x00]
            },
            (0x86, 0x00, 0x00) => self.handle_gen_auth(data),
            _ => vec![0x6D, 0x00],
        }
    }

    fn handle_gen_auth(&mut self, data: &[u8]) -> Vec<u8> {
        if data.len() < 2 || data[0] != 0x7C {
            return vec![0x6A, 0x80];
        }
        
        let inner_tag = if data.len() > 3 { data[2] } else { 0 };
        
        match inner_tag {
            0x00 => {
                // 1. Get Nonce
                let nonce = [0x11u8; 16]; 
                
                let k_pi = crate::crypto::pace::derive_password_key(&self.password);
                let iv = [0u8; 16];
                let encryptor = Aes128CbcEnc::new(&k_pi.into(), &iv.into());
                
                let mut nonce_buf = nonce.to_vec();
                let _ = encryptor.encrypt_padded_mut::<NoPadding>(&mut nonce_buf, 16).unwrap();
                
                build_tlv_response(0x80, &nonce_buf)
            },
            0x81 => {
                // 2. Map
                let nonce = [0x11u8; 16];
                let k_pi = crate::crypto::pace::derive_password_key(&self.password);
                let iv = [0u8; 16];
                let encryptor = Aes128CbcEnc::new(&k_pi.into(), &iv.into());
                
                let mut nonce_buf = nonce.to_vec();
                let _ = encryptor.encrypt_padded_mut::<NoPadding>(&mut nonce_buf, 16).unwrap();
                
                self.pace_state.set_encrypted_nonce(&nonce_buf);
                
                let server_pk = self.pace_state.perform_mapping_and_generate_key().unwrap();
                let client_pk_bytes = extract_tlv_value(data, 0x81).unwrap();
                self.pace_state.compute_shared_secret(&client_pk_bytes).unwrap();
                
                build_tlv_response(0x82, &server_pk)
            },
            0x85 => {
                // 3. Mutual Auth
                let server_token = self.pace_state.perform_token_exchange(&[]).unwrap();
                
                let session = self.pace_state.finalize_session().unwrap();
                self.secure_session = Some(AesSecureMessaging::new(
                    &session.k_enc, &session.k_mac, session.ssc
                ).unwrap());
                
                build_tlv_response(0x86, &server_token)
            },
            _ => vec![0x6A, 0x88],
        }
    }
}

fn is_sm(cla: u8) -> bool {
    cla & 0x0C == 0x0C
}

fn build_tlv_response(tag: u8, value: &[u8]) -> Vec<u8> {
    let mut inner = Vec::new();
    inner.push(tag);
    inner.extend_from_slice(&encode_len(value.len()));
    inner.extend_from_slice(value);
    
    let mut outer = Vec::new();
    outer.push(0x7C);
    outer.extend_from_slice(&encode_len(inner.len()));
    outer.extend_from_slice(&inner);
    outer.extend_from_slice(&[0x90, 0x00]);
    outer
}

fn encode_len(len: usize) -> Vec<u8> {
    if len <= 0x7F {
        vec![len as u8]
    } else {
        vec![0x81, len as u8] 
    }
}

fn extract_tlv_value(data: &[u8], tag: u8) -> Option<Vec<u8>> {
    if data.len() < 5 { return None; }
    let mut idx = 2; 
    if data[1] > 0x80 { idx += 1; }
    
    if data[idx] == tag {
        let len = data[idx+1] as usize; 
        return Some(data[idx+2..idx+2+len].to_vec());
    }
    None
}
