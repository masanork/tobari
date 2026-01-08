use std::collections::HashMap;
use crate::apdu::file_ids;

pub struct MockJpki {
    current_ap: String, // Hex AID
    current_ef: String, // Hex FID
    files: HashMap<(String, String), Vec<u8>>,
    pin_retries: HashMap<String, u8>,
}

impl MockJpki {
    pub fn new() -> Self {
        let mut files = HashMap::new();
        let jpki_aid = hex::encode(file_ids::DF_JPKI);
        let input_support_aid = hex::encode(file_ids::DF_INPUT_SUPPORT);
        let surface_aid = hex::encode(file_ids::DF_SURFACE);

        // JPKI AP Files
        files.insert((jpki_aid.clone(), "000A".to_string()), vec![0x30, 0x82, 0x01, 0x00]); // Auth Cert
        files.insert((jpki_aid.clone(), "0001".to_string()), vec![0x30, 0x82, 0x02, 0x00]); // Sign Cert
        
        // Input Support AP Files
        files.insert((input_support_aid.clone(), "0001".to_string()), vec![0x01, 0x0C, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x30, 0x31, 0x32]); 
        files.insert((input_support_aid.clone(), "0002".to_string()), hex::decode("301EDF22045461726FDF2305546F6B796FDF24083139393030313031DF250131").unwrap());

        // Surface AP Files
        files.insert((surface_aid.clone(), "0002".to_string()), vec![0xDF, 0x27, 0x03, 0xAA, 0xBB, 0xCC]);

        let mut pin_retries = HashMap::new();
        pin_retries.insert(hex::encode(file_ids::EF_AUTH_PIN), 3);
        pin_retries.insert(hex::encode(file_ids::EF_SIGN_PIN), 5);
        pin_retries.insert(hex::encode(file_ids::EF_INPUT_SUPPORT_PIN), 3);
        pin_retries.insert(hex::encode(file_ids::EF_SURFACE_PIN), 3);

        Self {
            current_ap: String::new(),
            current_ef: String::new(),
            files,
            pin_retries,
        }
    }

    pub fn handle_apdu(&mut self, apdu: &[u8]) -> Vec<u8> {
        if apdu.len() < 4 { return vec![0x6F, 0x00]; }
        let ins = apdu[1];
        let p1 = apdu[2];
        let p2 = apdu[3];
        let lc = if apdu.len() > 4 { apdu[4] as usize } else { 0 };
        let data = if apdu.len() >= 5 + lc { &apdu[5..5 + lc] } else { &[] };

        match ins {
            0xA4 => { // SELECT
                if p1 == 0x04 { // SELECT AP (AID)
                    self.current_ap = hex::encode(data);
                    self.current_ef = String::new();
                    vec![0x90, 0x00]
                } else if p1 == 0x02 { // SELECT EF (FID)
                    self.current_ef = hex::encode(data);
                    vec![0x90, 0x00]
                } else {
                    vec![0x6A, 0x81]
                }
            },
            0x20 => { // VERIFY
                if lc == 0 {
                    if let Some(&count) = self.pin_retries.get(&self.current_ef) {
                        return vec![0x63, 0xC0 | count];
                    }
                    return vec![0x69, 0x86];
                }
                let pin = String::from_utf8_lossy(data);
                let success = if self.current_ef == hex::encode(file_ids::EF_AUTH_PIN) {
                    pin == "1234"
                } else if self.current_ef == hex::encode(file_ids::EF_SIGN_PIN) {
                    pin == "Password123"
                } else if self.current_ef == hex::encode(file_ids::EF_INPUT_SUPPORT_PIN) {
                    pin == "1234"
                } else if self.current_ef == hex::encode(file_ids::EF_SURFACE_PIN) {
                    pin == "123456789012"
                } else {
                    false
                };

                if success {
                    vec![0x90, 0x00]
                } else {
                    if let Some(count) = self.pin_retries.get_mut(&self.current_ef) {
                        if *count > 0 { *count -= 1; }
                        vec![0x63, 0xC0 | *count]
                    } else {
                        vec![0x63, 0xC0]
                    }
                }
            },
            0xB0 => { // READ BINARY
                let key = (self.current_ap.clone(), self.current_ef.clone());
                if let Some(content) = self.files.get(&key) {
                    let offset = ((p1 as usize) << 8) | (p2 as usize);
                    if offset >= content.len() { return vec![0x6B, 0x00]; }
                    let mut resp = content[offset..].to_vec();
                    resp.extend_from_slice(&[0x90, 0x00]);
                    resp
                } else {
                    vec![0x6A, 0x82]
                }
            },
            0x2A => { // COMPUTE DIGITAL SIGNATURE
                let mut sig = vec![0x55; 256];
                sig.extend_from_slice(&[0x90, 0x00]);
                sig
            },
            _ => vec![0x6D, 0x00],
        }
    }
}
