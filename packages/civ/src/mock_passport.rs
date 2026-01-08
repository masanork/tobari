use crate::crypto::pace::{PaceP256, PaceMappingType, derive_session_keys_sha256};
use crate::crypto::sm::AesSecureMessaging;
use aes::cipher::{BlockEncryptMut, KeyIvInit, block_padding::NoPadding};
use cbc::Encryptor;
use aes::Aes128;
use std::collections::HashMap;
use p256::{PublicKey, elliptic_curve::sec1::ToEncodedPoint};

type Aes128CbcEnc = Encryptor<Aes128>;

fn build_tlv_response(tag: u8, value: &[u8]) -> Vec<u8> {
    let mut resp = vec![0x7C];
    resp.push(value.len() as u8 + 2);
    resp.push(tag);
    resp.push(value.len() as u8);
    resp.extend_from_slice(value);
    resp.extend_from_slice(&[0x90, 0x00]);
    resp
}

fn extract_tlv_value(data: &[u8], target_tag: u8) -> Option<Vec<u8>> {
    if data.len() < 2 || data[0] != 0x7C { return None; }
    let mut i = 2;
    while i < data.len() {
        let tag = data[i];
        let len = data[i+1] as usize;
        if tag == target_tag {
            return Some(data[i+2..i+2+len].to_vec());
        }
        i += 2 + len;
    }
    None
}

fn is_sm(cla: u8) -> bool { (cla & 0x0C) != 0 }

pub struct MockPassport {
    password: String,
    pace_state: PaceP256,
    secure_session: Option<AesSecureMessaging>,
    files: HashMap<Vec<u8>, Vec<u8>>,
    current_file: Option<Vec<u8>>,
}

impl MockPassport {
    pub fn new(password: &str) -> Self {
        let mut files = HashMap::new();
        // DG14 (Security Infos)
        files.insert(vec![0x01, 0x0E], vec![0x31, 0x10, 0x30, 0x0E, 0x04, 0x0C, 0x01, 0x02, 0x03, 0x04]); 
        // DG15 (AA Public Key)
        files.insert(vec![0x01, 0x0F], vec![0x30, 0x05, 0x01, 0x02, 0x03]);
        // DG3 (Fingerprints)
        files.insert(vec![0x01, 0x03], vec![0x03, 0x01, 0xAA]);
        // DG4 (Iris)
        files.insert(vec![0x01, 0x04], vec![0x04, 0x01, 0xBB]);
        
        Self {
            password: password.to_string(),
            pace_state: PaceP256::new(password, PaceMappingType::GenericMapping, 16),
            secure_session: None,
            files,
            current_file: None,
        }
    }

    pub fn handle_apdu(&mut self, apdu_bytes: &[u8]) -> Vec<u8> {
        if apdu_bytes.len() < 4 { return vec![0x6F, 0x00]; }
        let cla = apdu_bytes[0];
        let ins = apdu_bytes[1];
        let p1 = apdu_bytes[2];
        let p2 = apdu_bytes[3];
        
        let (_real_cla, _real_ins, _real_p1, _real_p2, data) = if is_sm(cla) {
            return vec![0x69, 0x82]; 
        } else {
            let lc = if apdu_bytes.len() > 4 { apdu_bytes[4] as usize } else { 0 };
            let data = if apdu_bytes.len() >= 5 + lc { &apdu_bytes[5..5+lc] } else { &[] };
            (cla, ins, p1, p2, data)
        };

        match (ins, p1, p2) {
            // SELECT FILE
            (0xA4, 0x02, 0x0C) | (0xA4, 0x01, 0x0C) => {
                if self.files.contains_key(data) {
                    self.current_file = Some(data.to_vec());
                    vec![0x90, 0x00]
                } else {
                    vec![0x6A, 0x82]
                }
            },
            // READ BINARY
            (0xB0, _, _) => {
                if let Some(fid) = &self.current_file {
                    if let Some(content) = self.files.get(fid) {
                        let offset = ((p1 as usize) << 8) | (p2 as usize);
                        if offset >= content.len() { return vec![0x6B, 0x00]; }
                        let mut resp = content[offset..].to_vec();
                        resp.extend_from_slice(&[0x90, 0x00]);
                        resp
                    } else { vec![0x69, 0x82] }
                } else { vec![0x69, 0x86] }
            },
            // MSE: SET
            (0x22, 0xC1, 0xA4) | (0x22, 0x41, 0xA6) | (0x22, 0x81, 0xB6) => {
                vec![0x90, 0x00]
            },
            // GET CHALLENGE
            (0x84, 0x00, 0x00) => {
                let rnd = vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
                let mut resp = rnd;
                resp.extend_from_slice(&[0x90, 0x00]);
                resp
            },
            // EXTERNAL AUTHENTICATE
            (0x82, 0x00, 0x00) => {
                vec![0x90, 0x00]
            },
            // GEN AUTH
            (0x86, 0x00, 0x00) => self.handle_gen_auth(data),
            // INTERNAL AUTHENTICATE (Active Auth)
            (0x88, 0x00, 0x00) => {
                let mut resp = vec![0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE];
                resp.extend_from_slice(&[0x90, 0x00]);
                resp
            },
            _ => vec![0x6D, 0x00],
        }
    }

    fn handle_gen_auth(&mut self, data: &[u8]) -> Vec<u8> {
        if data.len() < 2 || data[0] != 0x7C { return vec![0x6A, 0x80]; }
        let inner_tag = if data.len() > 3 { data[2] } else { 0 };
        match inner_tag {
            0x00 => { // Get Nonce
                let nonce = [0x11u8; 16]; 
                let k_pi = crate::crypto::pace::derive_password_key(&self.password);
                let encryptor = Aes128CbcEnc::new(&k_pi.into(), &[0u8; 16].into());
                let mut nonce_buf = nonce.to_vec();
                let _ = encryptor.encrypt_padded_mut::<NoPadding>(&mut nonce_buf, 16).unwrap();
                build_tlv_response(0x80, &nonce_buf)
            },
            0x81 => { // Map
                let nonce = [0x11u8; 16];
                let k_pi = crate::crypto::pace::derive_password_key(&self.password);
                let encryptor = Aes128CbcEnc::new(&k_pi.into(), &[0u8; 16].into());
                let mut nonce_buf = nonce.to_vec();
                let _ = encryptor.encrypt_padded_mut::<NoPadding>(&mut nonce_buf, 16).unwrap();
                self.pace_state.set_encrypted_nonce(&nonce_buf);
                let server_pk = self.pace_state.perform_mapping_and_generate_key().unwrap();
                let client_pk_bytes = extract_tlv_value(data, 0x81).unwrap();
                self.pace_state.compute_shared_secret(&client_pk_bytes).unwrap();
                build_tlv_response(0x82, &server_pk)
            },
            0x85 => { // Mutual Auth
                let client_token = extract_tlv_value(data, 0x85).unwrap_or_default();
                let server_token = self.pace_state.perform_token_exchange(&client_token).unwrap();
                let session = self.pace_state.finalize_session().unwrap();
                self.secure_session = Some(AesSecureMessaging::new(&session.k_enc, &session.k_mac, session.ssc).unwrap());
                build_tlv_response(0x86, &server_token)
            },
            0x80 => { // Chip Auth
                let pcd_pk_bytes = extract_tlv_value(data, 0x80).unwrap();
                let pcd_pk = PublicKey::from_sec1_bytes(&pcd_pk_bytes).unwrap();
                let shared_point = pcd_pk.to_projective(); 
                let shared_bytes = shared_point.to_affine().to_encoded_point(false).x().unwrap().to_vec();
                let (k_enc, k_mac) = derive_session_keys_sha256(&shared_bytes, 16);
                self.secure_session = Some(AesSecureMessaging::new(&k_enc, &k_mac, 0).unwrap());
                vec![0x90, 0x00]
            },
            _ => vec![0x6A, 0x88],
        }
    }
}