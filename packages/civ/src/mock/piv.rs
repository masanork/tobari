use crate::apdu::ApduCommand;
use crate::mock::common::{der_wrap, extract_tlv_value, MockBackend};
use crate::piv::KeyReference;
use p256::ecdsa::{Signature as EcdsaSignature, SigningKey};
use rand_core::OsRng;
use signature::Signer;
use std::collections::HashMap;

pub struct PivBackend {
    files: HashMap<Vec<u8>, Vec<u8>>,
    pin: String,
    pin_verified: bool,
    signing_key: SigningKey,
}

impl PivBackend {
    pub fn new() -> Self {
        let signing_key = SigningKey::random(&mut OsRng);
        let verifying_key = signing_key.verifying_key();

        let spki = verifying_key.to_encoded_point(false).as_bytes().to_vec();
        let spki_der = der_wrap(
            0x30,
            &[
                der_wrap(
                    0x30,
                    &hex::decode("06072a8648ce3d020106082a8648ce3d030107").unwrap(),
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
                                der_wrap(0x0C, b"PIV Mock"),
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
                                der_wrap(0x0C, b"PIV Mock"),
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

        let signature: EcdsaSignature = signing_key.sign(&tbs_cert);
        let sig_der = signature.to_der();

        let cert = der_wrap(
            0x30,
            &[
                tbs_cert,
                der_wrap(0x30, &hex::decode("06082a8648ce3d040302").unwrap()),
                der_wrap(0x03, &[vec![0x00], sig_der.to_bytes().to_vec()].concat()),
            ]
            .concat(),
        );

        let mut files = HashMap::new();
        files.insert(vec![0x5F, 0xC1, 0x07], vec![0x53, 0x01, 0x00]);
        files.insert(
            vec![0x5F, 0xC1, 0x02],
            vec![0x53, 0x05, 0x30, 0x00, 0x00, 0x00, 0x00],
        );
        files.insert(vec![0x5F, 0xC1, 0x05], cert);

        Self {
            files,
            pin: "123456".to_string(),
            pin_verified: false,
            signing_key,
        }
    }
}

impl Default for PivBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl MockBackend for PivBackend {
    fn handle_apdu(&mut self, cmd: &ApduCommand, _aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0x20 => {
                // VERIFY
                if cmd.p2 == KeyReference::PivCardApplicationPin as u8 {
                    let mut pin_bytes = cmd.data.clone();
                    while pin_bytes.last() == Some(&0xFF) {
                        pin_bytes.pop();
                    }
                    let pin_str = String::from_utf8_lossy(&pin_bytes);
                    if pin_str == self.pin {
                        self.pin_verified = true;
                        (vec![], 0x9000)
                    } else {
                        (vec![], 0x63C3)
                    }
                } else {
                    (vec![], 0x6A88)
                }
            }
            0xCB => {
                // GET DATA
                if cmd.data.len() >= 5 && cmd.data[0] == 0x5C {
                    let tag = &cmd.data[2..5];
                    if let Some(data) = self.files.get(tag) {
                        (data.clone(), 0x9000)
                    } else {
                        (vec![], 0x6A82)
                    }
                } else {
                    (vec![], 0x6A80)
                }
            }
            0x87 => {
                // GENERAL AUTHENTICATE
                if !self.pin_verified {
                    return (vec![], 0x6982);
                }
                let challenge = extract_tlv_value(&cmd.data, 0x81).unwrap_or_default();
                if challenge.is_empty() {
                    return (vec![], 0x6A80);
                }
                let signature: EcdsaSignature = self.signing_key.sign(&challenge);
                let sig_bytes = signature.to_vec();
                let mut res = vec![0x7C];
                let mut inner = vec![0x82, sig_bytes.len() as u8];
                inner.extend(sig_bytes);
                res.push(inner.len() as u8);
                res.extend(inner);
                (res, 0x9000)
            }
            _ => (vec![], 0x6D00),
        }
    }
}
