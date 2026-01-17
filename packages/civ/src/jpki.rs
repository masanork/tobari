use crate::apdu::{
    file_ids, ApduCommand, CLA_ISO, INS_COMPUTE_DIGITAL_SIGNATURE, INS_READ_BINARY,
    INS_SELECT_FILE, INS_VERIFY,
};
use crate::errors::{CivError, Result};
use crate::models::{CitizenIdentity, IdentityController};
use crate::reader::CardReader;
use crate::utils::parse_ber_tlv;
use crate::jpki_utils::{BasicInfo, parse_basic_info, extract_face_photo};
use async_trait::async_trait;

/// High-level JPKI Controller
pub struct JpkiController<R: CardReader> {
    reader: R,
    auth_pin: Option<String>,
    sign_pin: Option<String>,
    last_verified: bool,
}

impl<R: CardReader> JpkiController<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            auth_pin: None,
            sign_pin: None,
            last_verified: false,
        }
    }

    pub async fn select_jpki_ap(&mut self) -> Result<()> {
        let apdu =
            ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C).with_data(&file_ids::DF_JPKI);
        Self::check_sw(&self.reader.transmit(&apdu.to_bytes()).await?)
    }

    pub async fn select_input_support_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(&file_ids::DF_INPUT_SUPPORT);
        Self::check_sw(&self.reader.transmit(&apdu.to_bytes()).await?)
    }

    pub async fn select_surface_ap(&mut self) -> Result<()> {
        let apdu =
            ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C).with_data(&file_ids::DF_SURFACE);
        Self::check_sw(&self.reader.transmit(&apdu.to_bytes()).await?)
    }

    pub async fn verify_pin(&mut self, pin_ef: &[u8], pin: &str) -> Result<()> {
        let select_pin = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(pin_ef);
        self.reader.transmit(&select_pin.to_bytes()).await?;
        let verify = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80).with_data(pin.as_bytes());
        Self::check_sw(&self.reader.transmit(&verify.to_bytes()).await?)
    }

    pub async fn get_auth_pin_retries(&mut self) -> Result<u8> {
        self.select_jpki_ap().await?;
        self.get_pin_retry_count(&file_ids::EF_AUTH_PIN).await
    }

    pub async fn get_sign_pin_retries(&mut self) -> Result<u8> {
        self.select_jpki_ap().await?;
        self.get_pin_retry_count(&file_ids::EF_SIGN_PIN).await
    }

    pub async fn get_input_support_pin_retries(&mut self) -> Result<u8> {
        self.select_input_support_ap().await?;
        self.get_pin_retry_count(&file_ids::EF_INPUT_SUPPORT_PIN).await
    }

    async fn get_pin_retry_count(&mut self, pin_ef: &[u8]) -> Result<u8> {
        let select_pin = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(pin_ef);
        Self::check_sw(&self.reader.transmit(&select_pin.to_bytes()).await?)?;
        let res = self.reader.transmit(&ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80).to_bytes()).await?;
        self.interpret_retry_sw(&res)
    }

    fn interpret_retry_sw(&self, res: &[u8]) -> Result<u8> {
        if res.len() < 2 { return Err(CivError::Communication("Response too short".to_string())); }
        let sw1 = res[res.len() - 2];
        let sw2 = res[res.len() - 1];
        if sw1 == 0x90 && sw2 == 0x00 { return Ok(255); }
        if sw1 == 0x63 && (sw2 & 0xF0) == 0xC0 { return Ok(sw2 & 0x0F); }
        if sw1 == 0x69 && sw2 == 0x83 { return Ok(0); }
        Err(CivError::ApduError(sw1, sw2))
    }

    pub async fn compute_auth_signature(&mut self, pin: &str, data: &[u8]) -> Result<Vec<u8>> {
        self.select_jpki_ap().await?;
        self.verify_pin(&file_ids::EF_AUTH_PIN, pin).await?;
        self.select_ef(&[0x00, 0x17]).await?;
        self.sign_data(data).await
    }

    pub async fn compute_digital_signature(&mut self, password: &str, data: &[u8]) -> Result<Vec<u8>> {
        self.select_jpki_ap().await?;
        self.verify_pin(&file_ids::EF_SIGN_PIN, password).await?;
        self.select_ef(&[0x00, 0x1A]).await?;
        self.sign_data(data).await
    }

    pub async fn sign_data(&mut self, data: &[u8]) -> Result<Vec<u8>> {
        use sha2::Digest;
        let hash = sha2::Sha256::digest(data);
        let mut digest_info = vec![
            0x30, 0x31, 0x30, 0x0D, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02,
            0x01, 0x05, 0x00, 0x04, 20,
        ];
        digest_info.extend_from_slice(&hash);
        let cmd = ApduCommand::new(0x00, INS_COMPUTE_DIGITAL_SIGNATURE, 0x00, 0x80)
            .with_data(&digest_info)
            .with_le(0x00);
        let res = self.reader.transmit(&cmd.to_bytes()).await?;
        Self::check_sw(&res)?;
        Ok(res[0..res.len() - 2].to_vec())
    }

    pub async fn read_auth_cert(&mut self) -> Result<Vec<u8>> {
        self.select_jpki_ap().await?;
        self.read_ef_full(&[0x00, 0x0A]).await
    }

    pub async fn read_sign_cert(&mut self) -> Result<Vec<u8>> {
        self.select_jpki_ap().await?;
        self.read_ef_full(&[0x00, 0x01]).await
    }

    pub async fn read_mynumber(&mut self, pin: &str) -> Result<String> {
        self.select_input_support_ap().await?;
        self.verify_pin(&file_ids::EF_INPUT_SUPPORT_PIN, pin).await?;
        let data = self.read_ef_full(&file_ids::EF_MYNUMBER).await?;

        let tlvs = parse_ber_tlv(&data).unwrap_or_default();
        fn find_mynumber_recursive(tlvs: &[crate::utils::BerTlv]) -> Option<String> {
            for tlv in tlvs {
                if tlv.tag == 0x01 && tlv.value.len() == 12 && tlv.value.iter().all(|&b| b.is_ascii_digit()) {
                    return Some(tlv.as_utf8());
                }
                if let Some(found) = find_mynumber_recursive(&tlv.children) { return Some(found); }
            }
            None
        }

        if let Some(num) = find_mynumber_recursive(&tlvs) { return Ok(num); }
        let s = String::from_utf8_lossy(&data).to_string();
        let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.len() == 12 { return Ok(digits); }

        Err(CivError::NotFound("MyNumber not found".to_string()))
    }

    pub async fn read_attributes(&mut self, pin: &str) -> Result<BasicInfo> {
        self.select_input_support_ap().await?;
        self.verify_pin(&file_ids::EF_INPUT_SUPPORT_PIN, pin).await?;
        let attr_data = self.read_ef_full(&file_ids::EF_ATTRIBUTES).await?;
        parse_basic_info(&attr_data)
    }

    pub async fn read_face_photo(&mut self, my_number: &str) -> Result<Vec<u8>> {
        self.select_surface_ap().await?;
        self.verify_pin(&file_ids::EF_SURFACE_PIN, my_number).await?;
        let data = self.read_ef_full(&file_ids::EF_FACE_PHOTO).await?;
        
        if let Some(photo) = extract_face_photo(&data) {
            Ok(photo)
        } else if data.len() > 1000 {
            Ok(data)
        } else {
            Err(CivError::NotFound("Face photo not found".to_string()))
        }
    }

    pub async fn read_ef_full(&mut self, ef_id: &[u8]) -> Result<Vec<u8>> {
        self.select_ef(ef_id).await?;
        let mut data = Vec::new();
        let mut offset: u16 = 0;
        loop {
            let res = self.reader.transmit(&ApduCommand::new(CLA_ISO, INS_READ_BINARY, (offset >> 8) as u8, (offset & 0xFF) as u8).with_le(0x00).to_bytes()).await?;
            if res.len() < 2 { return Err(CivError::Communication("Too short".to_string())); }
            let (sw1, sw2) = (res[res.len() - 2], res[res.len() - 1]);
            if (sw1 == 0x90 && sw2 == 0x00) || (sw1 == 0x62 && sw2 == 0x82) {}
            else if sw1 == 0x6B && sw2 == 0x00 { break; }
            else { return Err(CivError::from_sw(sw1, sw2)); }
            let chunk = &res[0..res.len() - 2];
            if chunk.is_empty() { break; }
            data.extend_from_slice(chunk);
            offset += chunk.len() as u16;
            if chunk.len() < 256 { break; }
        }
        Ok(data)
    }

    pub async fn select_ef(&mut self, fid: &[u8]) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(fid);
        Self::check_sw(&self.reader.transmit(&apdu.to_bytes()).await?)
    }

    fn check_sw(res: &[u8]) -> Result<()> {
        if res.len() < 2 { return Err(CivError::Communication("Too short".to_string())); }
        let (sw1, sw2) = (res[res.len() - 2], res[res.len() - 1]);
        if sw1 == 0x90 && sw2 == 0x00 { Ok(()) } else { Err(CivError::from_sw(sw1, sw2)) }
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl<R: CardReader + Send> IdentityController for JpkiController<R> {
    async fn provide_pin(&mut self, pin_type: &str, pin: &str) -> Result<()> {
        match pin_type {
            "auth" => {
                self.auth_pin = Some(pin.to_string());
                Ok(())
            },
            "sign" => {
                self.sign_pin = Some(pin.to_string());
                Ok(())
            },
            _ => Err(CivError::InvalidData(format!("Unknown JPKI PIN: {}", pin_type)))
        }
    }

    async fn verify(&mut self) -> Result<bool> {
        self.last_verified = true;
        Ok(true)
    }

    async fn read_identity(&mut self) -> Result<CitizenIdentity> {
        let pin = self.auth_pin.clone().unwrap_or_default();
        let info = self.read_attributes(&pin).await?;
        let my_number = self.read_mynumber(&pin).await?;
        let photo_data = self.read_face_photo(&my_number).await.ok();

        Ok(CitizenIdentity {
            full_name: info.name,
            surname: None, given_names: None, full_name_kana: None,
            address: Some(info.address),
            birth_date: crate::utils::DateUtils::parse_yyyymmdd(&info.birth_date).unwrap_or(info.birth_date),
            gender: info.gender,
            identity_number: my_number,
            card_type: "MyNumberCard".to_string(),
            issuing_authority: Some("JPN".to_string()),
            expiration_date: None,
            photo_data,
            verified: self.last_verified,
            attributes: std::collections::HashMap::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mock::{JpkiBackend, MockSmartCard};
    use crate::test_utils::TestReader;
    use std::sync::{Arc, Mutex};

    fn setup_jpki_mock(reader: &TestReader) -> Arc<Mutex<MockSmartCard>> {
        let mut mock = MockSmartCard::new();
        mock.add_backend(file_ids::DF_JPKI.to_vec(), Box::new(JpkiBackend::new()));
        mock.add_backend(file_ids::DF_INPUT_SUPPORT.to_vec(), Box::new(JpkiBackend::new()));
        mock.add_backend(file_ids::DF_SURFACE.to_vec(), Box::new(JpkiBackend::new()));
        let mock = Arc::new(Mutex::new(mock));
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| mock_clone.lock().unwrap().handle_apdu(apdu));
        mock
    }

    #[tokio::test]
    async fn test_read_attributes() {
        let reader = TestReader::new();
        let _mock = setup_jpki_mock(&reader);
        let mut controller = JpkiController::new(reader.clone());
        let res: Result<BasicInfo> = controller.read_attributes("1234").await;
        assert!(res.is_ok());
        assert_eq!(res.unwrap().name, "Taro");
    }
}