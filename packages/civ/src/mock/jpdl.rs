use crate::apdu::ApduCommand;
use crate::mock::common::MockBackend;
use p256::ecdsa::{Signature, SigningKey};
use rand_core::OsRng;
use sha2::{Digest, Sha256};
use signature::Signer;
use std::collections::HashMap;

pub struct DriversLicenseBackend {
    files: HashMap<Vec<u8>, Vec<u8>>,
    current_ef: Option<Vec<u8>>,
    signing_key: SigningKey,
    certificate_der: Vec<u8>,
}

impl DriversLicenseBackend {
    pub fn new() -> Self {
        let mut files = HashMap::new();
        // Generate Key Pair
        let signing_key = SigningKey::random(&mut OsRng);
        let verifying_key = signing_key.verifying_key();

        // Generate Self-Signed Certificate
        use crate::mock::common::der_wrap;
        let spki = verifying_key.to_encoded_point(false).as_bytes().to_vec();
        let spki_der = der_wrap(
            0x30,
            &[
                der_wrap(
                    0x30,
                    &hex::decode("06072a8648ce3d020106052b8104000a").unwrap(),
                ),
                der_wrap(0x03, &[vec![0x00], spki].concat()),
            ]
            .concat(),
        );

        let tbs_cert = der_wrap(
            0x30,
            &[
                der_wrap(0xA0, &der_wrap(0x02, &[0x02])),
                der_wrap(0x02, &[0x01]),
                der_wrap(0x30, &hex::decode("06082a8648ce3d040302").unwrap()),
                der_wrap(
                    0x30,
                    &[der_wrap(
                        0x31,
                        &der_wrap(
                            0x30,
                            &[
                                der_wrap(0x06, &hex::decode("550403").unwrap()),
                                der_wrap(0x0C, b"NPA Mock"),
                            ]
                            .concat(),
                        ),
                    )]
                    .concat(),
                ),
                der_wrap(
                    0x30,
                    &[
                        der_wrap(0x17, b"260101000000Z"),
                        der_wrap(0x17, b"360101000000Z"),
                    ]
                    .concat(),
                ),
                der_wrap(
                    0x30,
                    &[der_wrap(
                        0x31,
                        &der_wrap(
                            0x30,
                            &[
                                der_wrap(0x06, &hex::decode("550403").unwrap()),
                                der_wrap(0x0C, b"NPA Mock"),
                            ]
                            .concat(),
                        ),
                    )]
                    .concat(),
                ),
                spki_der,
            ]
            .concat(),
        );

        let signature: Signature = signing_key.sign(&tbs_cert);
        let sig_der = signature.to_der();

        let certificate_der = der_wrap(
            0x30,
            &[
                tbs_cert,
                der_wrap(0x30, &hex::decode("06082a8648ce3d040302").unwrap()),
                der_wrap(0x03, &[vec![0x00], sig_der.to_bytes().to_vec()].concat()),
            ]
            .concat(),
        );

        // Raw JIS X 0208 for "外務 太郎" (Gaimu Taro)
        // 外: 3330, 務: 4C31, Space: 2121, 太: 423E, 郎: 4F39
        let name_jis = vec![0x33, 0x30, 0x4C, 0x31, 0x21, 0x21, 0x42, 0x3E, 0x4F, 0x39];
        
        // Raw JIS X 0208 for "優良" (Yuuryou)
        // 優: 4D25, 良: 4E49
        let color_jis = vec![0x4D, 0x25, 0x4E, 0x49];
        
        // Raw JIS X 0208 for "眼鏡等" (Megane Tou)
        // 眼: 3463, 鏡: 3640, 等: 4579
        let condition_jis = vec![0x34, 0x63, 0x36, 0x40, 0x45, 0x79];

        // Dates (Gengou): 1980-01-01 -> Showa(3) 55 01 01 -> "3550101"
        let birth_date = b"3550101".to_vec();
        
        // Tags based on TRETJapanNFCReader
        // 12: Name, 16: Birth, 17: Address, 1A: Color, 1C: Condition
        // Note: Address is missing in this minimal mock, using Name for simplicity or empty.
        
        let mut ef01_data = Vec::new();
        // Name (12)
        ef01_data.push(0x12);
        ef01_data.push(name_jis.len() as u8);
        ef01_data.extend_from_slice(&name_jis);
        
        // Birth (16)
        ef01_data.push(0x16);
        ef01_data.push(birth_date.len() as u8);
        ef01_data.extend_from_slice(&birth_date);
        
        // Address (17) - Empty or reuse Name for test (just valid JIS)
        ef01_data.push(0x17);
        ef01_data.push(name_jis.len() as u8);
        ef01_data.extend_from_slice(&name_jis); // Reuse "Gaimu Taro" as address for now
        
        // Color (1A)
        ef01_data.push(0x1A);
        ef01_data.push(color_jis.len() as u8);
        ef01_data.extend_from_slice(&color_jis);
        
        // Condition (1C)
        ef01_data.push(0x1C);
        ef01_data.push(condition_jis.len() as u8);
        ef01_data.extend_from_slice(&condition_jis);

        let ef02_data = vec![0x41, 0x06, 0x34, 0x63, 0x36, 0x40, 0x45, 0x79]; // "眼鏡等" as Honseki for test

        files.insert(vec![0x00, 0x01], ef01_data.clone());
        files.insert(vec![0x00, 0x02], ef02_data.clone());

        // Generate EF07 (Hashes + Signature)
        let hash01 = Sha256::digest(&ef01_data);
        let hash02 = Sha256::digest(&ef02_data);

        let mut data_to_sign = Vec::new();
        data_to_sign.extend_from_slice(&hash01);
        data_to_sign.extend_from_slice(&hash02);

        let signature: Signature = signing_key.sign(&data_to_sign);
        let sig_bytes = signature.to_vec(); // P-256 fixed size

        let mut ef07 = Vec::new();
        ef07.extend_from_slice(&hash01);
        ef07.extend_from_slice(&hash02);
        ef07.extend_from_slice(&sig_bytes);

        files.insert(vec![0x00, 0x07], ef07);

        Self {
            files,
            current_ef: None,
            signing_key,
            certificate_der,
        }
    }
}

impl Default for DriversLicenseBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl DriversLicenseBackend {
    pub fn get_public_key_bytes(&self) -> Vec<u8> {
        self.signing_key
            .verifying_key()
            .to_encoded_point(false)
            .as_bytes()
            .to_vec()
    }

    pub fn get_certificate_der(&self) -> Vec<u8> {
        self.certificate_der.clone()
    }

    pub fn corrupt_data(&mut self) {
        if let Some(data) = self.files.get_mut(&vec![0x00, 0x01]) {
            if !data.is_empty() {
                data[0] ^= 0xFF;
            }
        }
    }
}

impl MockBackend for DriversLicenseBackend {
    fn handle_apdu(&mut self, cmd: &ApduCommand, _aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => {
                if cmd.p1 == 0x04 {
                    // Select DF (AID)
                    // Reset current EF
                    self.current_ef = None;
                    (vec![], 0x9000)
                } else if cmd.p1 == 0x00 && cmd.p2 == 0x00 {
                    // Select MF
                    self.current_ef = None;
                    (vec![], 0x9000)
                } else if cmd.p1 == 0x02 {
                    // Select EF
                    self.current_ef = Some(cmd.data.clone());
                    (vec![], 0x9000)
                } else {
                    (vec![], 0x6A82)
                }
            }
            0x20 => {
                // VERIFY
                let pin = String::from_utf8_lossy(&cmd.data);
                if pin == "123456" {
                    (vec![], 0x9000)
                } else {
                    (vec![], 0x63C2)
                }
            }
            0xB0 => {
                if let Some(ef) = &self.current_ef {
                    if let Some(data) = self.files.get(ef) {
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
            _ => (vec![], 0x6D00),
        }
    }
}
