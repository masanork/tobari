use std::collections::HashMap;
use crate::apdu::{file_ids, ApduCommand};
use crate::crypto::sm::{AesSecureMessaging, SecureMessagingSession};
use crate::crypto::pace::{PaceP256, PaceMappingType, derive_session_keys_sha256};
use p256::{PublicKey, elliptic_curve::sec1::ToEncodedPoint};
use aes::cipher::{BlockEncryptMut, KeyIvInit, block_padding::NoPadding};
use cbc::Encryptor;
use aes::Aes128;

type Aes128CbcEnc = Encryptor<Aes128>;

pub trait MockBackend: Send {
    fn handle_apdu(&mut self, cmd: &ApduCommand, aid: &[u8]) -> (Vec<u8>, u16);
    fn get_secure_session(&mut self) -> Option<AesSecureMessaging> { None }
}

pub struct MockSmartCard {
    current_ap_aid: Option<Vec<u8>>,
    backends: HashMap<Vec<u8>, Box<dyn MockBackend>>,
    secure_session: Option<AesSecureMessaging>,
}

impl MockSmartCard {
    pub fn new() -> Self {
        Self {
            current_ap_aid: None,
            backends: HashMap::new(),
            secure_session: None,
        }
    }

    pub fn add_backend(&mut self, aid: Vec<u8>, backend: Box<dyn MockBackend>) {
        self.backends.insert(aid, backend);
    }

    pub fn handle_apdu(&mut self, apdu_bytes: &[u8]) -> Vec<u8> {
        let cla = apdu_bytes[0];
        let cmd = match ApduCommand::from_bytes(apdu_bytes) {
            Ok(c) => c,
            Err(_) => return vec![0x6F, 0x00],
        };

        if (cla & 0x0C) != 0 {
            if let Some(mut session) = self.secure_session.take() {
                let res = match session.unwrap_command_from_reader(&cmd) {
                    Ok(plain_cmd) => {
                        let (res_data, sw) = self.dispatch_plain_apdu(&plain_cmd);
                        match session.wrap_response_from_card(&res_data, (sw >> 8) as u8, (sw & 0xFF) as u8) {
                            Ok(wrapped) => wrapped,
                            Err(_) => vec![0x6F, 0x00],
                        }
                    },
                    Err(_) => vec![0x69, 0x82],
                };
                self.secure_session = Some(session);
                return res;
            } else {
                return vec![0x69, 0x82];
            }
        }

        let (mut data, sw) = self.dispatch_plain_apdu(&cmd);
        
        if let Some(aid) = &self.current_ap_aid {
            if let Some(backend) = self.backends.get_mut(aid) {
                if let Some(session) = backend.get_secure_session() {
                    self.secure_session = Some(session);
                }
            }
        }

        data.push((sw >> 8) as u8);
        data.push((sw & 0xFF) as u8);
        data

    }

    fn dispatch_plain_apdu(&mut self, cmd: &ApduCommand) -> (Vec<u8>, u16) {
        if cmd.ins == 0xA4 && (cmd.p1 == 0x04 || (cmd.p1 == 0x00 && cmd.data.len() > 2)) {
            if self.backends.contains_key(&cmd.data) {
                self.current_ap_aid = Some(cmd.data.clone());
                return (vec![], 0x9000);
            } else {
                return (vec![], 0x6A82);
            }
        }

        if let Some(aid) = &self.current_ap_aid {
            if let Some(backend) = self.backends.get_mut(aid) {
                return backend.handle_apdu(cmd, aid);
            }
        }

        (vec![], 0x6D00)
    }

    pub fn set_secure_session(&mut self, session: AesSecureMessaging) {
        self.secure_session = Some(session);
    }
}

// --- JPKI Backend ---
pub struct JpkiBackend {
    files: HashMap<(Vec<u8>, Vec<u8>), Vec<u8>>,
    current_ef: Option<Vec<u8>>,
    pin_retries: HashMap<(Vec<u8>, Vec<u8>), u8>,
}

impl JpkiBackend {
    pub fn new() -> Self {
        let mut files = HashMap::new();
        let mut pin_retries = HashMap::new();
        
        let jpki_aid = file_ids::DF_JPKI.to_vec();
        let input_support_aid = file_ids::DF_INPUT_SUPPORT.to_vec();
        let surface_aid = file_ids::DF_SURFACE.to_vec();

        files.insert((jpki_aid.clone(), vec![0x00, 0x0A]), vec![0x30, 0x82, 0x01, 0x00]); 
        files.insert((jpki_aid.clone(), vec![0x00, 0x01]), vec![0x30, 0x82, 0x02, 0x00]); 
        
        files.insert((input_support_aid.clone(), file_ids::EF_MYNUMBER.to_vec()), vec![0x01, 0x0C, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x30, 0x31, 0x32]); 
        files.insert((input_support_aid.clone(), file_ids::EF_ATTRIBUTES.to_vec()), hex::decode("301EDF22045461726FDF2305546F6B796FDF24083139393030313031DF250131").unwrap()); 

        files.insert((surface_aid.clone(), file_ids::EF_FACE_PHOTO.to_vec()), vec![0xDF, 0x27, 0x03, 0xAA, 0xBB, 0xCC]);

        pin_retries.insert((jpki_aid.clone(), file_ids::EF_AUTH_PIN.to_vec()), 3);
        pin_retries.insert((jpki_aid.clone(), file_ids::EF_SIGN_PIN.to_vec()), 5);
        pin_retries.insert((input_support_aid.clone(), file_ids::EF_INPUT_SUPPORT_PIN.to_vec()), 3);
        pin_retries.insert((surface_aid.clone(), file_ids::EF_SURFACE_PIN.to_vec()), 3);

        Self { files, current_ef: None, pin_retries }
    }
}

impl MockBackend for JpkiBackend {
    fn handle_apdu(&mut self, cmd: &ApduCommand, aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => {
                if cmd.p1 == 0x02 {
                    self.current_ef = Some(cmd.data.clone());
                    (vec![], 0x9000)
                } else { (vec![], 0x6A82) }
            },
            0x20 => { // VERIFY
                if let Some(ef) = &self.current_ef {
                    let key = (aid.to_vec(), ef.clone());
                    if cmd.data.is_empty() {
                         if let Some(&count) = self.pin_retries.get(&key) {
                             return (vec![], 0x63C0 | (count as u16));
                         }
                    }
                    let pin = String::from_utf8_lossy(&cmd.data);
                    let success = if ef == &file_ids::EF_AUTH_PIN && aid == file_ids::DF_JPKI { pin == "1234" }
                                 else if ef == &file_ids::EF_SIGN_PIN && aid == file_ids::DF_JPKI { pin == "Password123" }
                                 else if ef == &file_ids::EF_INPUT_SUPPORT_PIN && aid == file_ids::DF_INPUT_SUPPORT { pin == "1234" }
                                 else if ef == &file_ids::EF_SURFACE_PIN && aid == file_ids::DF_SURFACE { pin == "123456789012" }
                                 else { false };
                    if success { (vec![], 0x9000) }
                    else {
                        let count = self.pin_retries.get_mut(&key).map(|c| { if *c > 0 { *c -= 1; } *c }).unwrap_or(0);
                        (vec![], 0x63C0 | (count as u16))
                    }
                } else { (vec![], 0x6986) }
            },
            0xB0 => { // READ BINARY
                if let Some(ef) = &self.current_ef {
                    let key = (aid.to_vec(), ef.clone());
                    if let Some(data) = self.files.get(&key) {
                        let offset = ((cmd.p1 as usize) << 8) | (cmd.p2 as usize);
                        if offset >= data.len() { (vec![], 0x6B00) }
                        else { (data[offset..].to_vec(), 0x9000) }
                    } else { (vec![], 0x6A82) }
                } else { (vec![], 0x6986) }
            },
            0x2A => { // COMPUTE DIGITAL SIGNATURE
                (vec![0x55; 256], 0x9000)
            },
            _ => (vec![], 0x6D00),
        }
    }
}

// --- Drivers License Backend ---
pub struct DriversLicenseBackend {
    files: HashMap<Vec<u8>, Vec<u8>>,
    current_ef: Option<Vec<u8>>,
}

impl DriversLicenseBackend {
    pub fn new() -> Self {
        let mut files = HashMap::new();
        let ef01_data = vec![
            0x11, 0x09, 0x8a, 0x4f, 0x96, 0xb1, 0x20, 0x91, 0xbe, 0x98, 0x59, 
            0x13, 0x08, b'1', b'9', b'8', b'0', b'0', b'1', b'0', b'1', 
            0x17, 0x0C, b'1', b'2', b'3', b'4', b'5', b'6', b'7', b'8', b'9', b'0', b'1', b'2', 
            0x1A, 0x04, 0x97, 0x44, 0x97, 0xC7, 
            0x1C, 0x06, 0x8a, 0xe1, 0x8b, 0xbe, 0x93, 0x99 
        ];
        files.insert(vec![0x00, 0x01], ef01_data);
        files.insert(vec![0x00, 0x02], vec![0x41, 0x06, 0x8a, 0xe1, 0x8b, 0xbe, 0x93, 0x99]); 

        Self { files, current_ef: None }
    }
}

impl MockBackend for DriversLicenseBackend {
    fn handle_apdu(&mut self, cmd: &ApduCommand, _aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => {
                if cmd.p1 == 0x02 { self.current_ef = Some(cmd.data.clone()); (vec![], 0x9000) }
                else { (vec![], 0x6A82) }
            },
            0x20 => { // VERIFY
                let pin = String::from_utf8_lossy(&cmd.data);
                if pin == "0101" || pin == "0202" { (vec![], 0x9000) }
                else { (vec![], 0x63C2) }
            },
            0xB0 => {
                if let Some(ef) = &self.current_ef {
                    if let Some(data) = self.files.get(ef) {
                        let offset = ((cmd.p1 as usize) << 8) | (cmd.p2 as usize);
                        if offset >= data.len() { (vec![], 0x6B00) }
                        else { (data[offset..].to_vec(), 0x9000) }
                    } else { (vec![], 0x6A82) }
                } else { (vec![], 0x6986) }
            },
            _ => (vec![], 0x6D00),
        }
    }
}

// --- Residence Card Backend ---
pub struct ResidenceCardBackend {
    files: HashMap<Vec<u8>, Vec<u8>>,
    current_ef: Option<Vec<u8>>,
}

impl ResidenceCardBackend {
    pub fn new() -> Self {
        let mut files = HashMap::new();
        let addr_bytes = "東京都".as_bytes();
        let mut ef_addr = vec![0xD4, addr_bytes.len() as u8];
        ef_addr.extend_from_slice(addr_bytes);
        files.insert(vec![0x00, 0x01], ef_addr);

        let perm_bytes = "許可".as_bytes();
        let mut ef_perm = vec![0xD5, perm_bytes.len() as u8];
        ef_perm.extend_from_slice(perm_bytes);
        files.insert(vec![0x00, 0x02], ef_perm);

        files.insert(vec![0x00, 0x04], vec![0xD7, 0x01, b'0']);

        Self { files, current_ef: None }
    }
}

impl MockBackend for ResidenceCardBackend {
    fn handle_apdu(&mut self, cmd: &ApduCommand, _aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => {
                if cmd.p1 == 0x02 { self.current_ef = Some(cmd.data.clone()); (vec![], 0x9000) }
                else { (vec![], 0x6A82) }
            },
            0xB0 => {
                if let Some(ef) = &self.current_ef {
                    if let Some(data) = self.files.get(ef) {
                        let offset = ((cmd.p1 as usize) << 8) | (cmd.p2 as usize);
                        if offset >= data.len() { (vec![], 0x6B00) }
                        else { (data[offset..].to_vec(), 0x9000) }
                    } else { (vec![], 0x6A82) }
                } else { (vec![], 0x6986) }
            },
            _ => (vec![], 0x6D00),
        }
    }
}

// --- Passport Backend ---
pub struct PassportBackend {
    files: HashMap<Vec<u8>, Vec<u8>>,
    current_ef: Option<Vec<u8>>,
    password: String,
    pace_state: Option<PaceP256>,
    new_secure_session: Option<AesSecureMessaging>,
}

impl PassportBackend {
    pub fn new(password: &str) -> Self {
        let mut files = HashMap::new();
        files.insert(vec![0x01, 0x0E], vec![0x31, 0x10, 0x30, 0x0E, 0x04, 0x0C, 0x01, 0x02, 0x03, 0x04]); 
        files.insert(vec![0x01, 0x0F], vec![0x30, 0x05, 0x01, 0x02, 0x03]);
        files.insert(vec![0x01, 0x01], vec![0x61, 0x05, 0x5F, 0x1F, 0x02, 0x41, 0x42]);

        Self {
            files,
            current_ef: None,
            password: password.to_string(),
            pace_state: Some(PaceP256::new(password, PaceMappingType::GenericMapping, 16)),
            new_secure_session: None,
        }
    }
}

impl MockBackend for PassportBackend {
    fn get_secure_session(&mut self) -> Option<AesSecureMessaging> {
        self.new_secure_session.take()
    }

    fn handle_apdu(&mut self, cmd: &ApduCommand, _aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => {
                self.current_ef = Some(cmd.data.clone());
                (vec![], 0x9000)
            },
            0xB0 => {
                if let Some(ef) = &self.current_ef {
                    if let Some(data) = self.files.get(ef) {
                        let offset = ((cmd.p1 as usize) << 8) | (cmd.p2 as usize);
                        if offset >= data.len() { (vec![], 0x6B00) }
                        else { (data[offset..].to_vec(), 0x9000) }
                    } else { (vec![], 0x6A82) }
                } else { (vec![], 0x6986) }
            },
            0x84 => { // GET CHALLENGE
                (vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08], 0x9000)
            },
            0x88 => { // INTERNAL AUTH (AA)
                (vec![0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE], 0x9000)
            },
            0x22 => (vec![], 0x9000), // MSE
            0x86 => { // GEN AUTH
                if cmd.data.len() >= 2 && cmd.data[0] == 0x7C {
                    let inner_tag = if cmd.data.len() > 2 { cmd.data[2] } else { 0 };
                    match inner_tag {
                        0x00 => { // Get Nonce
                            let nonce = [0x11u8; 16];
                            let k_pi = crate::crypto::pace::derive_password_key(&self.password);
                            let encryptor = <Aes128CbcEnc as KeyIvInit>::new(&k_pi.into(), &[0u8; 16].into());
                            let mut nonce_buf = nonce.to_vec();
                            let _ = encryptor.encrypt_padded_mut::<NoPadding>(&mut nonce_buf, 16).unwrap();
                            if let Some(pace) = &mut self.pace_state { pace.set_encrypted_nonce(&nonce_buf); }
                            (build_tlv(0x80, &nonce_buf), 0x9000)
                        },
                        0x81 => { // Map
                            if let Some(pace) = &mut self.pace_state {
                                let server_pk = pace.perform_mapping_and_generate_key().unwrap();
                                pace.compute_shared_secret(&server_pk).unwrap();
                                (build_tlv(0x82, &server_pk), 0x9000)
                            } else { (vec![], 0x6A80) }
                        },
                        0x85 => { // Mutual Auth
                            if let Some(pace) = &mut self.pace_state {
                                let server_token = pace.perform_token_exchange(&[]).unwrap();
                                let session = pace.finalize_session().unwrap();
                                self.new_secure_session = Some(AesSecureMessaging::new(&session.k_enc, &session.k_mac, session.ssc).unwrap());
                                (build_tlv(0x86, &server_token), 0x9000)
                            } else { (vec![], 0x6A80) }
                        },
                        0x80 => { // Chip Auth
                            let pcd_pk_bytes = extract_tlv_value(&cmd.data, 0x80).unwrap_or_default();
                            if !pcd_pk_bytes.is_empty() {
                                let pcd_pk = PublicKey::from_sec1_bytes(&pcd_pk_bytes).unwrap();
                                let shared_point = pcd_pk.to_projective();
                                let shared_bytes = shared_point.to_affine().to_encoded_point(false).x().unwrap().to_vec();
                                let (k_enc, k_mac) = derive_session_keys_sha256(&shared_bytes, 16);
                                self.new_secure_session = Some(AesSecureMessaging::new(&k_enc, &k_mac, 0).unwrap());
                                (vec![], 0x9000)
                            } else { (vec![], 0x6A80) }
                        },
                        _ => (vec![], 0x6A88),
                    }
                } else { (vec![], 0x6A80) }
            }
            _ => (vec![], 0x6D00),
        }
    }
}

pub fn build_tlv(tag: u8, value: &[u8]) -> Vec<u8> {
    let mut out = vec![0x7C]; // Template
    let mut inner = vec![tag];
    if value.len() <= 127 { inner.push(value.len() as u8); }
    else { inner.push(0x81); inner.push(value.len() as u8); }
    inner.extend_from_slice(value);
    out.push(inner.len() as u8);
    out.extend_from_slice(&inner);
    out
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