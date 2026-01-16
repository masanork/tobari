use crate::apdu::{
    file_ids, ApduCommand, CLA_ISO, INS_COMPUTE_DIGITAL_SIGNATURE, INS_READ_BINARY,
    INS_SELECT_FILE, INS_VERIFY,
};
use crate::errors::{CivError, Result};
use crate::models::{CitizenIdentity, IdentityController};
use crate::reader::CardReader;
use crate::utils::{parse_ber_tlv, BerTlv};

/// High-level JPKI Controller
pub struct JpkiController<R: CardReader> {
    reader: R,
    auth_pin: Option<String>,
    sign_pin: Option<String>,
    last_verified: bool,
}

use serde::Serialize;
use std::fmt;

#[derive(Debug, Default, Serialize)]
pub struct BasicInfo {
    pub name: String,
    pub address: String,
    pub birth_date: String,
    pub gender: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub face_photo: Option<String>, // Base64 encoded
}

impl fmt::Display for BasicInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Name: {}\nAddress: {}\nDOB: {}\nGender: {}\nHas Photo: {}",
            self.name,
            self.address,
            self.birth_date,
            self.gender,
            self.face_photo.is_some()
        )
    }
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
        self.get_pin_retry_count(&file_ids::EF_INPUT_SUPPORT_PIN)
            .await
    }

    pub async fn get_surface_pin_retries(&mut self) -> Result<u8> {
        self.select_surface_ap().await?;
        self.get_pin_retry_count(&file_ids::EF_SURFACE_PIN).await
    }

    async fn get_pin_retry_count(&mut self, pin_ef: &[u8]) -> Result<u8> {
        let select_pin = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(pin_ef);
        Self::check_sw(&self.reader.transmit(&select_pin.to_bytes()).await?)?;
        self.get_status_at_p2(0x80).await
    }

    async fn get_status_at_p2(&mut self, p2: u8) -> Result<u8> {
        let res = self
            .reader
            .transmit(&ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, p2).to_bytes())
            .await?;
        self.interpret_retry_sw(&res)
    }

    fn interpret_retry_sw(&self, res: &[u8]) -> Result<u8> {
        if res.len() < 2 {
            return Err(CivError::Communication("Response too short".to_string()));
        }
        let sw1 = res[res.len() - 2];
        let sw2 = res[res.len() - 1];
        if sw1 == 0x90 && sw2 == 0x00 {
            return Ok(255);
        }
        if sw1 == 0x63 && (sw2 & 0xF0) == 0xC0 {
            return Ok(sw2 & 0x0F);
        }
        if sw1 == 0x69 && sw2 == 0x83 {
            return Ok(0);
        }
        if sw1 == 0x69 && (sw2 == 0x86 || sw2 == 0x81) {
            return Err(CivError::AccessDenied(format!(
                "Access Denied (SW: {:02X}{:02X})",
                sw1, sw2
            )));
        }
        Err(CivError::ApduError(sw1, sw2))
    }

    pub async fn compute_auth_signature(&mut self, pin: &str, data: &[u8]) -> Result<Vec<u8>> {
        self.select_jpki_ap().await?;
        self.verify_pin(&file_ids::EF_AUTH_PIN, pin).await?;
        self.select_ef(&[0x00, 0x17]).await?;
        self.sign_data(data).await
    }

    pub async fn compute_digital_signature(
        &mut self,
        password: &str,
        data: &[u8],
    ) -> Result<Vec<u8>> {
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
            0x01, 0x05, 0x00, 0x04, 0x20,
        ];
        digest_info.extend_from_slice(&hash);
        // Align with signer-macos: CLA=0x00, P2=0x80
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
        self.verify_pin(&file_ids::EF_INPUT_SUPPORT_PIN, pin)
            .await?;
        let data = self.read_ef_full(&file_ids::EF_MYNUMBER).await?;

        let tlvs = parse_ber_tlv(&data).unwrap_or_default();
        fn find_mynumber_recursive(tlvs: &[crate::utils::BerTlv]) -> Option<String> {
            for tlv in tlvs {
                if tlv.tag == 0x01
                    && tlv.value.len() == 12
                    && tlv.value.iter().all(|&b| b.is_ascii_digit())
                {
                    return Some(tlv.as_utf8());
                }
                if let Some(found) = find_mynumber_recursive(&tlv.children) {
                    return Some(found);
                }
            }
            None
        }

        if let Some(num) = find_mynumber_recursive(&tlvs) {
            return Ok(num);
        }

        if data.len() >= 12 {
            let s = String::from_utf8_lossy(&data).to_string();
            let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
            if digits.len() == 12 {
                return Ok(digits);
            }
        }

        Err(CivError::NotFound(
            "MyNumber not found in EF 00 01".to_string(),
        ))
    }

    pub async fn read_attributes(&mut self, pin: &str) -> Result<BasicInfo> {
        self.select_input_support_ap().await?;
        self.verify_pin(&file_ids::EF_INPUT_SUPPORT_PIN, pin)
            .await?;
        let attr_data = self.read_ef_full(&file_ids::EF_ATTRIBUTES).await?;
        debug_log(&format!(
            "JPKI EF_ATTRIBUTES size: {} bytes",
            attr_data.len()
        ));
        if std::env::var("TOBARI_DEBUG").ok().as_deref() == Some("1") {
            let hex = attr_data
                .iter()
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join("");
            println!("DEBUG: JPKI EF_ATTRIBUTES hex: {}", hex);
        }
        Self::parse_basic_info(&attr_data)
    }

    pub async fn read_face_photo(&mut self, my_number: &str) -> Result<Vec<u8>> {
        if my_number.len() != 12 {
            return Err(CivError::InvalidData(
                "Invalid My Number length.".to_string(),
            ));
        }
        
        self.select_surface_ap().await?;
        // Use Surface PIN EF (00 13) for verification with 12-digit My Number.
        // This matches signer-macos implementation.
        // Note: verify_pin now uses P2=0x00 (verify current EF) which helps avoid context issues.
        self.verify_pin(&file_ids::EF_SURFACE_PIN, my_number).await?;

        let data = self.read_ef_full(&file_ids::EF_FACE_PHOTO).await?;
        debug_log(&format!(
            "JPKI EF_FACE_PHOTO size: {} bytes",
            data.len()
        ));
        
        if let Some(photo) = extract_face_photo(&data) {
            Ok(photo)
        } else if data.len() > 1000 {
            debug_log("JPKI EF_FACE_PHOTO: DF27 not found, returning raw payload");
            Ok(data)
        } else {
            Err(CivError::NotFound(
                "Face photo (tag DF27) not found.".to_string(),
            ))
        }
    }

    pub async fn read_face_photo_with_pin(&mut self, pin: &str) -> Result<Vec<u8>> {
        self.select_surface_ap().await?;
        self.verify_pin(&file_ids::EF_SURFACE_PIN, pin).await?;

        let data = self.read_ef_full(&file_ids::EF_FACE_PHOTO).await?;
        debug_log(&format!(
            "JPKI EF_FACE_PHOTO size: {} bytes",
            data.len()
        ));
        if std::env::var("TOBARI_DEBUG").ok().as_deref() == Some("1") {
            let hex = data
                .iter()
                .take(64)
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join("");
            println!("DEBUG: JPKI EF_FACE_PHOTO head64: {}", hex);
        }

        if let Some(photo) = extract_face_photo(&data) {
            Ok(photo)
        } else if data.len() > 1000 {
            debug_log("JPKI EF_FACE_PHOTO: DF27 not found, returning raw payload");
            Ok(data)
        } else {
            Err(CivError::NotFound(
                "Face photo (tag DF27) not found.".to_string(),
            ))
        }
    }

    fn parse_basic_info(data: &[u8]) -> Result<BasicInfo> {
        let mut info = BasicInfo::default();
        let tlvs = parse_jpki_flat_tlv(data);
        fn collect_tags(tlvs: &[BerTlv], map: &mut std::collections::HashMap<u32, String>) {
            for tlv in tlvs {
                if tlv.tag == 0xDF20 || tlv.tag == 0xFF20 {
                    let nested = parse_jpki_flat_tlv(&tlv.value);
                    collect_tags(&nested, map);
                }
                let value = String::from_utf8_lossy(&tlv.value).to_string();
                map.insert(tlv.tag, value);
            }
        }
        let mut tag_map = std::collections::HashMap::new();
        collect_tags(&tlvs, &mut tag_map);
        debug_log(&format!(
            "JPKI EF_ATTRIBUTES tags: {}",
            tag_map
                .keys()
                .map(|k| format!("{:X}", k))
                .collect::<Vec<_>>()
                .join(",")
        ));
        if let Some(v) = tag_map.get(&0xDF22) {
            debug_log(&format!("JPKI DF22(name) raw: {}", v));
        }
        if let Some(v) = tag_map.get(&0xDF23) {
            debug_log(&format!("JPKI DF23(address) raw: {}", v));
        }
        if let Some(v) = tag_map.get(&0xDF24) {
            debug_log(&format!("JPKI DF24(birth) raw: {}", v));
        }
        if let Some(v) = tag_map.get(&0xDF25) {
            debug_log(&format!("JPKI DF25(gender) raw: {}", v));
        }
        if let Some(v) = tag_map.get(&0xDF22) {
            info.name = v.clone();
        }
        if let Some(v) = tag_map.get(&0xDF23) {
            info.address = v.clone();
        }
        if let Some(v) = tag_map.get(&0xDF24) {
            info.birth_date = v.clone();
        }
        if let Some(v) = tag_map.get(&0xDF25) {
            info.gender = v.clone();
        }
        Ok(info)
    }

    pub async fn read_ef_full(&mut self, ef_id: &[u8]) -> Result<Vec<u8>> {
        self.select_ef(ef_id).await?;
        let mut data = Vec::new();
        let mut offset: u16 = 0;
        loop {
            let p1 = (offset >> 8) as u8;
            let p2 = (offset & 0xFF) as u8;
            let res = self
                .reader
                .transmit(
                    &ApduCommand::new(CLA_ISO, INS_READ_BINARY, p1, p2)
                        .with_le(0x00)
                        .to_bytes(),
                )
                .await?;
            if res.len() < 2 {
                return Err(CivError::Communication("Response too short".to_string()));
            }
            let (sw1, sw2) = (res[res.len() - 2], res[res.len() - 1]);
            if (sw1 == 0x90 && sw2 == 0x00) || (sw1 == 0x62 && sw2 == 0x82) {
            } else if sw1 == 0x6B && sw2 == 0x00 {
                break;
            } else {
                return Err(CivError::from_sw(sw1, sw2));
            }
            let chunk = &res[0..res.len() - 2];
            if chunk.is_empty() {
                break;
            }
            data.extend_from_slice(chunk);
            offset += chunk.len() as u16;
            if chunk.len() < 256 {
                break;
            }
        }
        Ok(data)
    }

    pub async fn select_ef(&mut self, fid: &[u8]) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(fid);
        Self::check_sw(&self.reader.transmit(&apdu.to_bytes()).await?)
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

fn parse_jpki_flat_tlv(data: &[u8]) -> Vec<BerTlv> {
    let mut tlvs = Vec::new();
    let mut i = 0;

    while i < data.len() {
        let first_tag_byte = data[i];
        if first_tag_byte == 0x00 {
            i += 1;
            continue;
        }
        if first_tag_byte == 0xFF {
            if i + 1 >= data.len() || data[i + 1] == 0xFF {
                i += 1;
                continue;
            }
        }

        let mut tag: u32 = first_tag_byte as u32;
        i += 1;

        if (first_tag_byte & 0x1F) == 0x1F {
            while i < data.len() {
                let next_byte = data[i];
                tag = (tag << 8) | (next_byte as u32);
                i += 1;
                if (next_byte & 0x80) == 0 {
                    break;
                }
            }
        }

        if i >= data.len() {
            break;
        }
        let first_len_byte = data[i];
        i += 1;

        let mut len: usize = 0;
        if first_len_byte <= 0x7F {
            len = first_len_byte as usize;
        } else {
            let len_bytes_count = (first_len_byte & 0x7F) as usize;
            for _ in 0..len_bytes_count {
                if i >= data.len() {
                    break;
                }
                len = (len << 8) | (data[i] as usize);
                i += 1;
            }
        }

        if i + len > data.len() {
            let remaining = data.len().saturating_sub(i);
            let value = data[i..i + remaining].to_vec();
            tlvs.push(BerTlv {
                tag,
                value,
                children: Vec::new(),
            });
            break;
        }

        let value = data[i..i + len].to_vec();
        tlvs.push(BerTlv {
            tag,
            value,
            children: Vec::new(),
        });
        i += len;
    }

    tlvs
}

fn extract_face_photo(data: &[u8]) -> Option<Vec<u8>> {
    let mut i = 0;
    let mut logged = 0;
    while i + 2 <= data.len() {
        let b1 = data[i];
        let b2 = data[i + 1];
        if (b1 == 0xFF && b2 == 0xFF) || (b1 == 0x00 && b2 == 0x00) {
            i += 1;
            continue;
        }

        let tag = ((b1 as u16) << 8) | (b2 as u16);
        i += 2;
        if i >= data.len() {
            break;
        }

        let mut value_len = data[i] as usize;
        i += 1;

        if value_len == 0x81 {
            if i >= data.len() {
                break;
            }
            value_len = data[i] as usize;
            i += 1;
        } else if value_len == 0x82 {
            if i + 1 >= data.len() {
                break;
            }
            value_len = ((data[i] as usize) << 8) | (data[i + 1] as usize);
            i += 2;
        } else if value_len == 0x83 {
            if i + 2 >= data.len() {
                break;
            }
            value_len = ((data[i] as usize) << 16) | ((data[i + 1] as usize) << 8) | (data[i + 2] as usize);
            i += 3;
        }

        if i + value_len > data.len() {
            break;
        }

        if std::env::var("TOBARI_DEBUG").ok().as_deref() == Some("1") && logged < 20 {
            debug_log(&format!(
                "JPKI EF_FACE_PHOTO tag 0x{:04X} len {}",
                tag, value_len
            ));
            logged += 1;
        }

        if tag == 0xDF27 {
            return Some(data[i..i + value_len].to_vec());
        }

        if tag == 0xDF20 || tag == 0xFF20 || tag == 0xDF21 || tag == 0xFF21 {
            debug_log(&format!(
                "JPKI EF_FACE_PHOTO: descending into wrapper 0x{:04X} ({} bytes)",
                tag, value_len
            ));
            if let Some(found) = extract_face_photo(&data[i..i + value_len]) {
                return Some(found);
            }
        }

        i += value_len;
    }

    // Fallback: scan for DF27 tag directly inside the buffer.
    let mut j = 0;
    while j + 3 <= data.len() {
        if data[j] == 0xDF && data[j + 1] == 0x27 {
            let mut len = data[j + 2] as usize;
            let mut k = j + 3;
            if len == 0x81 {
                if k >= data.len() { break; }
                len = data[k] as usize;
                k += 1;
            } else if len == 0x82 {
                if k + 1 >= data.len() { break; }
                len = ((data[k] as usize) << 8) | (data[k + 1] as usize);
                k += 2;
            } else if len == 0x83 {
                if k + 2 >= data.len() { break; }
                len = ((data[k] as usize) << 16) | ((data[k + 1] as usize) << 8) | (data[k + 2] as usize);
                k += 3;
            }
            if k + len <= data.len() {
                debug_log(&format!("JPKI DF27 found by scan at offset {}", j));
                return Some(data[k..k + len].to_vec());
            }
        }
        j += 1;
    }

    // Fallback: scan for JP2/J2K signatures inside the buffer.
    if let Some(offset) = data.windows(12).position(|w| {
        w == [0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20, 0x0D, 0x0A, 0x87, 0x0A]
    }) {
        return Some(data[offset..].to_vec());
    }
    if let Some(offset) = data.windows(2).position(|w| w == [0xFF, 0x4F]) {
        return Some(data[offset..].to_vec());
    }

    debug_log("JPKI EF_FACE_PHOTO: DF27/JP2/J2K not found");
    None
}

fn debug_log(message: &str) {
    if std::env::var("TOBARI_DEBUG").ok().as_deref() == Some("1") {
        println!("DEBUG: {}", message);
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
impl<R: CardReader> IdentityController for JpkiController<R> {
    async fn provide_pin(&mut self, pin_type: &str, pin: &str) -> Result<()> {
        match pin_type {
            "auth" => self.auth_pin = Some(pin.to_string()),
            "sign" => self.sign_pin = Some(pin.to_string()),
            _ => {
                return Err(CivError::InvalidData(format!(
                    "Unknown PIN type for JPKI: {}",
                    pin_type
                )))
            }
        }
        Ok(())
    }

    async fn verify(&mut self) -> Result<bool> {
        self.last_verified = true;
        Ok(true)
    }

    async fn read_identity(&mut self) -> Result<CitizenIdentity> {
        let pin = self.auth_pin.clone().unwrap_or_default();
        let info = self.read_attributes(&pin).await?;
        let my_number = self.read_mynumber(&pin).await?;

        let formatted_dob = crate::utils::DateUtils::parse_yyyymmdd(&info.birth_date)
            .unwrap_or(info.birth_date.clone());

        let mut photo_data = None;
        if !my_number.is_empty() {
            if let Ok(photo) = self.read_face_photo(&my_number).await {
                photo_data = Some(photo);
            }
        }

        Ok(CitizenIdentity {
            full_name: info.name,
            surname: None, // JPKI doesn't explicitly separate them in basic 4 info
            given_names: None,
            full_name_kana: None, // Available in Attributes AP but not Basic 4 AP
            address: Some(info.address),
            birth_date: formatted_dob,
            gender: info.gender,
            identity_number: my_number,
            card_type: "MyNumberCard".to_string(),
            issuing_authority: Some("JPN".to_string()),
            expiration_date: None,
            photo_data,
            verified: false, // Updated by verify()
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
        let backend = Box::new(JpkiBackend::new());
        mock.add_backend(file_ids::DF_JPKI.to_vec(), backend);

        let backend = Box::new(JpkiBackend::new());
        mock.add_backend(file_ids::DF_INPUT_SUPPORT.to_vec(), backend);

        let backend = Box::new(JpkiBackend::new());
        mock.add_backend(file_ids::DF_SURFACE.to_vec(), backend);

        let mock = Arc::new(Mutex::new(mock));
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| mock_clone.lock().unwrap().handle_apdu(apdu));
        mock
    }

    #[tokio::test]
    async fn test_select_jpki_ap() {
        let reader = TestReader::new();
        let _mock = setup_jpki_mock(&reader);
        let mut controller = JpkiController::new(reader.clone());
        assert!(controller.select_jpki_ap().await.is_ok());
    }

    #[tokio::test]
    async fn test_read_mynumber() {
        let reader = TestReader::new();
        let _mock = setup_jpki_mock(&reader);
        let mut controller = JpkiController::new(reader.clone());
        let res = controller.read_mynumber("1234").await;
        assert!(res.is_ok());
        assert_eq!(res.unwrap(), "123456789012");
    }

    #[tokio::test]
    async fn test_read_attributes() {
        let reader = TestReader::new();
        let _mock = setup_jpki_mock(&reader);
        let mut controller = JpkiController::new(reader.clone());
        let res = controller.read_attributes("1234").await;
        assert!(res.is_ok());
        let info = res.unwrap();
        assert_eq!(info.name, "Taro");
        assert_eq!(info.birth_date, "19900101");
    }

    #[tokio::test]
    async fn test_compute_auth_signature() {
        let reader = TestReader::new();
        let _mock = setup_jpki_mock(&reader);
        let mut controller = JpkiController::new(reader.clone());
        let data = b"test data";
        let res = controller.compute_auth_signature("1234", data).await;
        assert!(res.is_ok());
        assert_eq!(res.unwrap().len(), 256);
    }

    #[tokio::test]
    async fn test_pin_retries() {
        let reader = TestReader::new();
        let _mock = setup_jpki_mock(&reader);
        let mut controller = JpkiController::new(reader.clone());

        let retries = controller.get_auth_pin_retries().await.unwrap();
        assert_eq!(retries, 3);

        let _ = controller.verify_pin(&file_ids::EF_AUTH_PIN, "wrong").await;

        let retries = controller.get_auth_pin_retries().await.unwrap();
        assert_eq!(retries, 2);
    }

    #[tokio::test]

    async fn test_read_ef_full_eof() {
        let reader = TestReader::new();

        // Succeed at SELECT

        reader.push_response(&[0x90, 0x00]);

        // EOF after first byte at READ BINARY

        reader.push_response(&[0x01, 0x62, 0x82]);

        let mut controller = JpkiController::new(reader.clone());

        let res = controller.read_ef_full(&[0x00, 0x01]).await;

        assert_eq!(res.unwrap(), vec![0x01]);
    }

    #[tokio::test]

    async fn test_read_mynumber_tlv() {
        let reader = TestReader::new();

        // Tag 0x01 is MyNumber, 12 digits

        let mut data = vec![0x01, 12];

        data.extend_from_slice(b"987654321098");

        reader.push_response(&[0x90, 0x00]); // Select Support AP

        reader.push_response(&[0x90, 0x00]); // Select PIN EF

        reader.push_response(&[0x90, 0x00]); // Verify PIN

        reader.push_response(&[0x90, 0x00]); // Select MyNumber EF

        let mut read_res = data;
        read_res.extend_from_slice(&[0x90, 0x00]);

        reader.push_response(&read_res); // Read Binary

        let mut controller = JpkiController::new(reader.clone());

        let num = controller.read_mynumber("1234").await.unwrap();

        assert_eq!(num, "987654321098");
    }

    #[tokio::test]

    async fn test_read_identity_full_flow() {
        let reader = TestReader::new();

        // 1. read_attributes

        reader.push_response(&[0x90, 0x00]); // select ap

        reader.push_response(&[0x90, 0x00]); // select ef pin

        reader.push_response(&[0x90, 0x00]); // verify pin

        reader.push_response(&[0x90, 0x00]); // select ef attr

        let mut attr = vec![0xDF, 0x22, 0x01, b'A', 0x90, 0x00];

        reader.push_response(&attr);

        // 2. read_mynumber

        reader.push_response(&[0x90, 0x00]); // select ap

        reader.push_response(&[0x90, 0x00]); // select ef pin

        reader.push_response(&[0x90, 0x00]); // verify pin

        reader.push_response(&[0x90, 0x00]); // select ef num

        let mut num = b"123456789012".to_vec();
        num.extend_from_slice(&[0x90, 0x00]);

        reader.push_response(&num);

        // 3. read_face_photo

        reader.push_response(&[0x90, 0x00]); // select ap

        reader.push_response(&[0x90, 0x00]); // select ef pin

        reader.push_response(&[0x90, 0x00]); // verify pin

        reader.push_response(&[0x90, 0x00]); // select ef photo

        let mut photo = vec![0xDF, 0x27, 0x01, 0xFF, 0x90, 0x00];

        reader.push_response(&photo);

        let mut controller = JpkiController::new(reader.clone());

        let res = controller.read_identity().await.unwrap();

        assert_eq!(res.identity_number, "123456789012");
    }
}
