pub mod common;
pub mod jpki;
pub mod passport;
pub mod jpdl;
pub mod jprc;
pub mod piv;
pub mod thai;
pub mod mykad;
pub mod jpdlmnc;

use std::collections::HashMap;
use crate::apdu::{file_ids, ApduCommand};
pub use self::common::{MockBackend, MockSecureSession};
pub use self::jpki::JpkiBackend;
pub use self::passport::PassportBackend;
pub use self::jpdl::DriversLicenseBackend;
pub use self::jprc::ResidenceCardBackend;
pub use self::piv::PivBackend;
pub use self::thai::ThaiBackend;
pub use self::mykad::MyKadBackend;
pub use self::jpdlmnc::MynaMenkyoBackend;

pub struct MockSmartCard {
    current_ap_aid: Option<Vec<u8>>,
    backends: HashMap<Vec<u8>, Box<dyn MockBackend>>,
    secure_session: Option<MockSecureSession>,
    pub demo_mode: bool,
}

impl MockSmartCard {
    pub fn new() -> Self {
        let mut card = Self {
            current_ap_aid: None,
            backends: HashMap::new(),
            secure_session: None,
            demo_mode: false,
        };
        card.add_backend(file_ids::DF_JPKI.to_vec(), Box::new(JpkiBackend::new()));
        card.add_backend(file_ids::DF_INPUT_SUPPORT.to_vec(), Box::new(JpkiBackend::new()));
        card.add_backend(file_ids::DF_SURFACE.to_vec(), Box::new(JpkiBackend::new()));
        card.add_backend(crate::piv::file_ids::DF_PIV.to_vec(), Box::new(PivBackend::new()));
        card.add_backend(crate::jpdl::file_ids::DF_DL.to_vec(), Box::new(DriversLicenseBackend::new()));
        card.add_backend(crate::jpdl::file_ids::DF_DL_PHOTO.to_vec(), Box::new(DriversLicenseBackend::new()));
        card.add_backend(crate::jprc::file_ids::DF1.to_vec(), Box::new(ResidenceCardBackend::new()));
        card.add_backend(crate::jprc::file_ids::DF2.to_vec(), Box::new(ResidenceCardBackend::new()));
        card.add_backend(crate::passport::file_ids::DF_ICAO.to_vec(), Box::new(PassportBackend::new("123456")));
        card.add_backend(vec![0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01], Box::new(ThaiBackend::new()));
        card.add_backend(vec![0xA0, 0x00, 0x00, 0x00, 0x74, 0x4A, 0x50, 0x4E, 0x00, 0x10], Box::new(MyKadBackend::new()));
        card.add_backend(vec![0xA0, 0x00, 0x00, 0x02, 0x31, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00], Box::new(MynaMenkyoBackend::new()));
        card.add_backend(vec![0xA0, 0x00, 0x00, 0x00, 0x00, 0x01], Box::new(LargeDataBackend::new()));
        card
    }

    pub fn add_backend(&mut self, aid: Vec<u8>, backend: Box<dyn MockBackend>) {
        self.backends.insert(aid, backend);
    }

    pub fn handle_apdu(&mut self, apdu_bytes: &[u8]) -> Vec<u8> {
        let cmd = match ApduCommand::from_bytes(apdu_bytes) {
            Ok(c) => c,
            Err(_) => return vec![0x6F, 0x00],
        };

        let cla = apdu_bytes[0];
        if (cla & 0x0C) != 0 {
            if let Some(mut session) = self.secure_session.take() {
                let res = match session.unwrap_command(&cmd) {
                    Ok(plain_cmd) => {
                        let (res_data, sw) = self.dispatch_plain_apdu(&plain_cmd);
                        match session.wrap_response(&res_data, (sw >> 8) as u8, (sw & 0xFF) as u8) {
                            Ok(mut wrapped) => {
                                wrapped.push(0x90);
                                wrapped.push(0x00);
                                wrapped
                            },
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
}

pub struct LargeDataBackend;
impl LargeDataBackend { pub fn new() -> Self { Self } }
impl MockBackend for LargeDataBackend {
    fn handle_apdu(&mut self, cmd: &ApduCommand, _aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => (vec![], 0x9000),
            0x10 => (cmd.data.clone(), 0x9000),
            0x11 => {
                let size = ((cmd.p1 as usize) << 8) | (cmd.p2 as usize);
                (vec![0xAB; size], 0x9000)
            }
            _ => (vec![], 0x6D00),
        }
    }
}
