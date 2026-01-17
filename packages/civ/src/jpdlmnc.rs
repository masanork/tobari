use crate::apdu::{ApduCommand, CLA_ISO, INS_READ_BINARY, INS_SELECT_FILE, INS_VERIFY};
use crate::errors::{CivError, Result};
use crate::models::{CitizenIdentity, IdentityController};
use crate::reader::CardReader;
use crate::utils::parse_ber_tlv;

/// My Number Drivers License (MyNa-Menkyo) Application Controller
pub struct MynaMenkyoController<R: CardReader> {
    reader: R,
    pin: Option<String>,
    last_verified: bool,
}

pub mod file_ids {
    /// MyNa-Menkyo Instance AID
    pub const AID_MYNA_MENKYO: [u8; 16] = [
        0xA0, 0x00, 0x00, 0x02, 0x31, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00,
    ];

    pub const EF_LICENSE_INFO: [u8; 2] = [0x00, 0x1B];
    pub const EF_SIGNATURE: [u8; 2] = [0x00, 0x1C];
}

impl<R: CardReader> MynaMenkyoController<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            pin: None,
            last_verified: false,
        }
    }

    /// Select MyNa-Menkyo Application
    pub async fn select_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(&file_ids::AID_MYNA_MENKYO);

        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    /// Verify PIN (P2=0x82)
    pub async fn verify_pin(&mut self, pin: &str) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x82).with_data(pin.as_bytes());

        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    /// Read License Info (EF 00 1B)
    pub async fn read_license_info(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_LICENSE_INFO).await
    }

    /// Read Signature (EF 00 1C)
    pub async fn read_signature(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_SIGNATURE).await
    }

    pub(crate) async fn read_file(&mut self, file_id: &[u8]) -> Result<Vec<u8>> {
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(file_id);
        let res_sel = self.reader.transmit(&select.to_bytes()).await?;
        Self::check_sw(&res_sel)?;

        let mut data = Vec::new();
        let mut offset: u16 = 0;
        loop {
            let read = ApduCommand::new(
                CLA_ISO,
                INS_READ_BINARY,
                (offset >> 8) as u8,
                (offset & 0xFF) as u8,
            )
            .with_le(0x00);
            let res = self.reader.transmit(&read.to_bytes()).await?;
            if res.len() < 2 {
                return Err(CivError::Communication("Response too short".to_string()));
            }
            let sw1 = res[res.len() - 2];
            let sw2 = res[res.len() - 1];
            let chunk = &res[0..res.len() - 2];
            if !chunk.is_empty() {
                data.extend_from_slice(chunk);
                offset += chunk.len() as u16;
            }
            if sw1 == 0x90 && sw2 == 0x00 {
                if chunk.len() < 256 {
                    break;
                }
            } else if sw1 == 0x6B || (sw1 == 0x62 && sw2 == 0x82) {
                break;
            } else {
                return Err(CivError::from_sw(sw1, sw2));
            }
            if offset > 8192 {
                break;
            }
        }
        Ok(data)
    }

    fn check_sw(res: &[u8]) -> Result<()> {
        if res.len() < 2 {
            return Err(CivError::Communication("Response too short".to_string()));
        }
        let sw1 = res[res.len() - 2];
        let sw2 = res[res.len() - 1];
        if sw1 == 0x90 && sw2 == 0x00 {
            Ok(())
        } else {
            Err(CivError::from_sw(sw1, sw2))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mock::{MockSmartCard, MynaMenkyoBackend};
    use crate::test_utils::TestReader;
    use std::sync::{Arc, Mutex};

    fn setup_myna_mock(reader: &TestReader) -> Arc<Mutex<MockSmartCard>> {
        let mut mock = MockSmartCard::new();
        mock.add_backend(
            vec![
                0xA0, 0x00, 0x00, 0x02, 0x31, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00,
            ],
            Box::new(MynaMenkyoBackend::new()),
        );
        let mock = Arc::new(Mutex::new(mock));
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| mock_clone.lock().unwrap().handle_apdu(apdu));
        mock
    }

    #[tokio::test]
    async fn test_verify_pin_error() {
        let reader = TestReader::new();
        let _mock = setup_myna_mock(&reader);
        let mut controller = MynaMenkyoController::new(reader.clone());

        assert!(controller.verify_pin("wrong").await.is_err());
    }

    #[tokio::test]
    async fn test_read_data_error() {
        let reader = TestReader::new();
        let mut controller = MynaMenkyoController::new(reader.clone());
        reader.set_failure(0x6A, 0x82);
        assert!(controller.read_license_info().await.is_err());
    }

    #[tokio::test]
    async fn test_read_identity_success() {
        let reader = TestReader::new();
        // 1. Select
        reader.push_response(&[0x90, 0x00]);
        // 2. Read License Info (EF 00 1B)
        // Tag C5: Expire, E7: Num, DF07: Photo
        let mut data = Vec::new();
        data.extend_from_slice(&[0xC5, 0x08]);
        data.extend_from_slice(b"20300101");
        data.extend_from_slice(&[0xE7, 0x0C]);
        data.extend_from_slice(b"123456789012");
        data.extend_from_slice(&[0xDF, 0x07, 0x01, 0xFF]);
        let mut res = data;
        res.extend_from_slice(&[0x90, 0x00]);

        reader.push_response(&[0x90, 0x00]); // Select EF 00 1B
        reader.push_response(&res); // Read Binary

        let mut controller = MynaMenkyoController::new(reader.clone());
        let id = controller.read_identity().await.unwrap();
        assert_eq!(id.identity_number, "123456789012");
        assert_eq!(id.expiration_date.unwrap(), "20300101");
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
impl<R: CardReader + Send> IdentityController for MynaMenkyoController<R> {
    async fn provide_pin(&mut self, _pin_type: &str, pin: &str) -> Result<()> {
        self.pin = Some(pin.to_string());
        Ok(())
    }

    async fn verify(&mut self) -> Result<bool> {
        self.select_ap().await?;
        if let Some(p) = self.pin.clone() {
            self.verify_pin(&p).await?;
        }
        // TODO: Signature verification
        self.last_verified = true;
        Ok(true)
    }

    async fn read_identity(&mut self) -> Result<CitizenIdentity> {
        self.select_ap().await?;
        if let Some(p) = self.pin.clone() {
            self.verify_pin(&p).await?;
        }

        let raw_data = self.read_license_info().await?;
        let tlvs = match parse_ber_tlv(&raw_data) {
            Ok(t) => t,
            Err(e) => {
                println!("DEBUG: Parse Error: {}", e);
                return Err(CivError::InvalidData(format!("TLV Parse Error: {}", e)));
            }
        };

        let mut identity = CitizenIdentity {
            card_type: "MyNaMenkyo".to_string(),
            issuing_authority: Some("JPN".to_string()),
            ..Default::default()
        };

        for tlv in tlvs {
            match tlv.tag {
                0xC5 => identity.expiration_date = Some(tlv.as_utf8()),
                0xE7 => identity.identity_number = tlv.as_utf8(),
                0xDF07 => identity.photo_data = Some(tlv.value.to_vec()),
                _ => {}
            }
        }

        identity.verified = self.last_verified;
        Ok(identity)
    }
}
