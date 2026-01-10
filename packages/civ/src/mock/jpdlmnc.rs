use std::collections::HashMap;
use crate::apdu::ApduCommand;
use crate::mock::common::MockBackend;
use sha2::{Sha256, Digest};

pub struct MynaMenkyoBackend {
    files: HashMap<Vec<u8>, Vec<u8>>,
    current_ef: Option<Vec<u8>>,
    pin: String,
    pin_verified: bool,
}

impl MynaMenkyoBackend {
    pub fn new() -> Self {
        let mut files = HashMap::new();
        
        // WEF02: License Info (001B)
        // tags: C5 (Expiry), E7 (LicenseNo), 107 (Photo)
        let mut info_data = Vec::new();
        info_data.extend_from_slice(&[0xC5, 0x08]); info_data.extend_from_slice(b"20300101");
        info_data.extend_from_slice(&[0xE7, 0x0C]); info_data.extend_from_slice(b"123456789012");
        
        // Face Photo (Monochrome JPEG2000)
        let photo = vec![0xAA, 0xBB, 0xCC, 0xDD];
        info_data.extend_from_slice(&[0xDF, 0x07]); // Tag 107 (mapped to DF 07)
        info_data.push(photo.len() as u8);
        info_data.extend_from_slice(&photo);

        files.insert(vec![0x00, 0x1B], info_data.clone());

        // WEF03: Signature (001C)
        let mut sig_data = Vec::new();
        sig_data.extend_from_slice(&[0x81, 0x08]); // Tag 108
        sig_data.push(32); // Mock hash instead of RSA signature
        sig_data.extend_from_slice(&Sha256::digest(&info_data));
        
        files.insert(vec![0x00, 0x1C], sig_data);

        Self { 
            files, 
            current_ef: None,
            pin: "1234".to_string(),
            pin_verified: false,
        }
    }
}

impl Default for MynaMenkyoBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl MockBackend for MynaMenkyoBackend {
    fn handle_apdu(&mut self, cmd: &ApduCommand, _aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => { // SELECT
                if cmd.p1 == 0x02 {
                    self.current_ef = Some(cmd.data.clone());
                    (vec![], 0x9000)
                } else { (vec![], 0x6A82) }
            },
            0x20 => { // VERIFY
                if cmd.p2 == 0x82 {
                    let pin_str = String::from_utf8_lossy(&cmd.data);
                    if pin_str == self.pin {
                        self.pin_verified = true;
                        (vec![], 0x9000)
                    } else {
                        (vec![], 0x63C9)
                    }
                } else { (vec![], 0x6A86) }
            },
            0xB0 => { // READ BINARY
                if !self.pin_verified {
                    return (vec![], 0x6982);
                }
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
