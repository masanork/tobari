use crate::apdu::{file_ids, ApduCommand};
use crate::mock::common::MockBackend;
use std::collections::HashMap;

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
        files.insert(
            (jpki_aid.clone(), vec![0x00, 0x0A]),
            vec![0x30, 0x82, 0x01, 0x00],
        );
        files.insert(
            (jpki_aid.clone(), vec![0x00, 0x01]),
            vec![0x30, 0x82, 0x02, 0x00],
        );
        files.insert(
            (input_support_aid.clone(), file_ids::EF_MYNUMBER.to_vec()),
            vec![
                0x01, 0x0C, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x30, 0x31, 0x32,
            ],
        );
        files.insert(
            (input_support_aid.clone(), file_ids::EF_ATTRIBUTES.to_vec()),
            hex::decode("301EDF22045461726FDF2305546F6B796FDF24083139393030313031DF250131")
                .unwrap(),
        );
        files.insert(
            (surface_aid.clone(), file_ids::EF_FACE_PHOTO.to_vec()),
            vec![0xDF, 0x27, 0x03, 0xAA, 0xBB, 0xCC],
        );
        pin_retries.insert((jpki_aid.clone(), file_ids::EF_AUTH_PIN.to_vec()), 3);
        pin_retries.insert((jpki_aid.clone(), file_ids::EF_SIGN_PIN.to_vec()), 5);
        pin_retries.insert(
            (
                input_support_aid.clone(),
                file_ids::EF_INPUT_SUPPORT_PIN.to_vec(),
            ),
            3,
        );
        pin_retries.insert((surface_aid.clone(), file_ids::EF_SURFACE_PIN.to_vec()), 3);
        Self {
            files,
            current_ef: None,
            pin_retries,
        }
    }
}

impl Default for JpkiBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl MockBackend for JpkiBackend {
    fn handle_apdu(&mut self, cmd: &ApduCommand, aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => {
                if cmd.p1 == 0x02 {
                    self.current_ef = Some(cmd.data.clone());
                    (vec![], 0x9000)
                } else {
                    (vec![], 0x6A82)
                }
            }
            0x20 => {
                // VERIFY
                if let Some(ef) = &self.current_ef {
                    let key = (aid.to_vec(), ef.clone());
                    if cmd.data.is_empty() {
                        if let Some(&count) = self.pin_retries.get(&key) {
                            return (vec![], 0x63C0 | (count as u16));
                        }
                    }
                    let pin = String::from_utf8_lossy(&cmd.data);
                    let success = if ef == &file_ids::EF_AUTH_PIN && aid == file_ids::DF_JPKI {
                        pin == "1234"
                    } else if ef == &file_ids::EF_SIGN_PIN && aid == file_ids::DF_JPKI {
                        pin == "123456"
                    } else if ef == &file_ids::EF_INPUT_SUPPORT_PIN
                        && aid == file_ids::DF_INPUT_SUPPORT
                    {
                        pin == "1234"
                    } else if ef == &file_ids::EF_SURFACE_PIN && aid == file_ids::DF_SURFACE {
                        pin == "1234" || pin == "123456789012"
                    } else {
                        false
                    };
                    if success {
                        (vec![], 0x9000)
                    } else {
                        let count = self
                            .pin_retries
                            .get_mut(&key)
                            .map(|c| {
                                if *c > 0 {
                                    *c -= 1;
                                }
                                *c
                            })
                            .unwrap_or(0);
                        (vec![], 0x63C0 | (count as u16))
                    }
                } else {
                    (vec![], 0x6986)
                }
            }
            0xB0 => {
                // READ BINARY
                if let Some(ef) = &self.current_ef {
                    let key = (aid.to_vec(), ef.clone());
                    if let Some(data) = self.files.get(&key) {
                        let offset = ((cmd.p1 as usize) << 8) | (cmd.p2 as usize);
                        if offset >= data.len() {
                            (vec![], 0x6B00)
                        } else {
                            (data[offset..].to_vec(), 0x9000)
                        }
                    } else {
                        (vec![], 0x6A82)
                    }
                } else {
                    (vec![], 0x6986)
                }
            }
            0x2A => {
                // COMPUTE DIGITAL SIGNATURE
                (vec![0x55; 256], 0x9000)
            }
            _ => (vec![], 0x6D00),
        }
    }
}
