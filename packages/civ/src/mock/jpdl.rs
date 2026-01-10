use std::collections::HashMap;
use crate::apdu::ApduCommand;
use crate::mock::common::MockBackend;
use sha2::{Sha256, Digest};
use p256::ecdsa::{SigningKey, Signature};
use signature::Signer;
use rand_core::OsRng;
use p256::elliptic_curve::sec1::ToEncodedPoint;

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
        let spki_der = der_wrap(0x30, &vec![
             der_wrap(0x30, &hex::decode("06072a8648ce3d020106052b8104000a").unwrap()), 
             der_wrap(0x03, &vec![vec![0x00], spki].concat()),
        ].concat());

        let tbs_cert = der_wrap(0x30, &vec![
             der_wrap(0xA0, &der_wrap(0x02, &vec![0x02])), 
             der_wrap(0x02, &vec![0x01]), 
             der_wrap(0x30, &hex::decode("06082a8648ce3d040302").unwrap()), 
             der_wrap(0x30, &vec![der_wrap(0x31, &der_wrap(0x30, &vec![der_wrap(0x06, &hex::decode("550403").unwrap()), der_wrap(0x0C, b"NPA Mock")].concat()))].concat()), 
             der_wrap(0x30, &vec![der_wrap(0x17, b"260101000000Z"), der_wrap(0x17, b"360101000000Z")].concat()), 
             der_wrap(0x30, &vec![der_wrap(0x31, &der_wrap(0x30, &vec![der_wrap(0x06, &hex::decode("550403").unwrap()), der_wrap(0x0C, b"NPA Mock")].concat()))].concat()), 
             spki_der,
        ].concat());

        let signature: Signature = signing_key.sign(&tbs_cert);
        let sig_der = signature.to_der();

        let certificate_der = der_wrap(0x30, &vec![
             tbs_cert,
             der_wrap(0x30, &hex::decode("06082a8648ce3d040302").unwrap()), 
             der_wrap(0x03, &vec![vec![0x00], sig_der.to_bytes().to_vec()].concat()), 
        ].concat());

        let ef01_data = vec![
            0x11, 0x09, 0x8a, 0x4f, 0x96, 0xb1, 0x20, 0x91, 0xbe, 0x98, 0x59, 
            0x13, 0x08, b'1', b'9', b'8', b'0', b'0', b'1', b'0', b'1', 
            0x17, 0x0C, b'1', b'2', b'3', b'4', b'5', b'6', b'7', b'8', b'9', b'0', b'1', b'2', 
            0x1A, 0x04, 0x97, 0x44, 0x97, 0xC7, 
            0x1C, 0x06, 0x8a, 0xe1, 0x8b, 0xbe, 0x93, 0x99 
        ];
        let ef02_data = vec![0x41, 0x06, 0x8a, 0xe1, 0x8b, 0xbe, 0x93, 0x99];

        files.insert(vec![0x00, 0x01], ef01_data.clone());
        files.insert(vec![0x00, 0x02], ef02_data.clone()); 

        // Generate EF07 (Hashes + Signature)
        // Format: Hash(EF01) + Hash(EF02) + Signature(Hash(EF01) + Hash(EF02)) ???
        // Actually JPDL EF07 format is specific. 
        // Typically it contains the signature over the hashes of the protected files.
        // Let's assume: [Hash01(32)] [Hash02(32)] [Signature(P-256 => 64)]
        
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

        Self { files, current_ef: None, signing_key, certificate_der }
    }

    pub fn get_public_key_bytes(&self) -> Vec<u8> {
        self.signing_key.verifying_key().to_encoded_point(false).as_bytes().to_vec()
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
                if cmd.p1 == 0x02 { self.current_ef = Some(cmd.data.clone()); (vec![], 0x9000) }
                else { (vec![], 0x6A82) }
            },
            0x20 => { // VERIFY
                let pin = String::from_utf8_lossy(&cmd.data);
                if pin == "123456" { (vec![], 0x9000) }
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
