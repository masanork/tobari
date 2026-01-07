use crate::apdu::{ApduCommand, file_ids, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY, INS_VERIFY, INS_COMPUTE_DIGITAL_SIGNATURE};
use crate::reader::CardReader;
use crate::utils::parse_ber_tlv;
use anyhow::{Result, Context};

/// High-level JPKI Controller
pub struct JpkiController<R: CardReader> {
    reader: R,
}

use std::fmt;

use serde::Serialize;

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
        write!(f, "Name: {}\nAddress: {}\nDOB: {}\nGender: {}\nHas Photo: {}", 
            self.name, self.address, self.birth_date, self.gender, self.face_photo.is_some())
    }
}

impl<R: CardReader> JpkiController<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }

    /// Select the JPKI Application (DF)
    pub async fn select_jpki_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(&file_ids::DF_JPKI);
        
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res).context("Failed to select JPKI AP")
    }

    /// Select the Card Surface Input Support Application (DF)
    pub async fn select_input_support_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(&file_ids::DF_INPUT_SUPPORT);
        
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res).context("Failed to select Input Support AP")
    }

    /// Select the Face Recognition Application (DF)
    pub async fn select_face_recognition_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(&file_ids::DF_FACE_RECOGNITION);

        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res).context("Failed to select Face Recognition AP")
    }

    /// Select Authentication Private Key (EF 00 17)
    pub async fn select_auth_private_key(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(&[0x00, 0x17]);
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res).context("Failed to select Auth Private Key")
    }

    /// Select Digital Signature Private Key (EF 00 1A)
    pub async fn select_sign_private_key(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(&[0x00, 0x1A]);
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res).context("Failed to select Signature Private Key")
    }

    /// Verify PIN
    /// pin_ef: Usually 0x0018 (Auth) or 0x001B (Sign) or 0x0011 (Input Support)
    /// pin: The pin string (e.g. "1234")
    pub async fn verify_pin(&mut self, pin_ef: &[u8], pin: &str) -> Result<()> {
        let select_pin = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(pin_ef);
        let res_sel = self.reader.transmit(&select_pin.to_bytes()).await?;
        Self::check_sw(&res_sel).context("Failed to select PIN EF")?;

        let pin_bytes = pin.as_bytes();
        let verify = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80)
            .with_data(pin_bytes);
        
        let res = self.reader.transmit(&verify.to_bytes()).await?;
        Self::check_sw(&res).context("PIN Verification Failed")
    }

    /// Get Retry Count for JPKI Authentication PIN (4 digits)
    pub async fn get_auth_pin_retries(&mut self) -> Result<u8> {
        self.select_jpki_ap().await?;
        self.get_pin_retry_count(&file_ids::EF_AUTH_PIN).await
    }

    /// Get Retry Count for JPKI Signature PIN (6-16 digits)
    pub async fn get_sign_pin_retries(&mut self) -> Result<u8> {
        self.select_jpki_ap().await?;
        self.get_pin_retry_count(&file_ids::EF_SIGN_PIN).await
    }

    /// Get Retry Count for Input Support PIN (4 digits)
    pub async fn get_input_support_pin_retries(&mut self) -> Result<u8> {
        self.select_input_support_ap().await?;
        self.get_pin_retry_count(&file_ids::EF_INPUT_SUPPORT_PIN).await
    }

    /// Get PIN Retry Count (Internal Helper)
    /// Assumes the correct AP is already selected.
    async fn get_pin_retry_count(&mut self, pin_ef: &[u8]) -> Result<u8> {
        let select_pin = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(pin_ef);
        let res_sel = self.reader.transmit(&select_pin.to_bytes()).await?;
        Self::check_sw(&res_sel).context("Failed to select PIN EF")?;

        let verify = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80);
        let res = self.reader.transmit(&verify.to_bytes()).await?;
        
        if res.len() >= 2 {
            let sw1 = res[res.len()-2];
            let sw2 = res[res.len()-1];
            
            if sw1 == 0x63 && (sw2 & 0xF0) == 0xC0 {
                return Ok(sw2 & 0x0F);
            }
            if sw1 == 0x90 && sw2 == 0x00 {
                return Ok(255); // Verified/Unlimited
            }
        }
        
        Err(anyhow::anyhow!("Unknown PIN Status SW: {:02X}{:02X}", 
            if res.len()>=2 { res[res.len()-2] } else {0},
            if res.len()>=2 { res[res.len()-1] } else {0}
        ))
    }

    /// Compute "User Authentication" Signature (Login, etc.)
    pub async fn compute_auth_signature(&mut self, pin: &str, data: &[u8]) -> Result<Vec<u8>> {
        self.select_jpki_ap().await?;
        self.verify_pin(&file_ids::EF_AUTH_PIN, pin).await.context("Auth PIN Verify Failed")?;
        self.select_auth_private_key().await?;
        self.sign_data(data).await.context("Failed to compute Auth signature")
    }

    /// Compute "Digital Signature" (Legally binding)
    pub async fn compute_digital_signature(&mut self, password: &str, data: &[u8]) -> Result<Vec<u8>> {
        self.select_jpki_ap().await?;
        self.verify_pin(&file_ids::EF_SIGN_PIN, password).await.context("Sign PIN Verify Failed")?;
        self.select_sign_private_key().await?;
        self.sign_data(data).await.context("Failed to compute Digital signature")
    }

    /// Sign data using the currently selected private key.
    pub async fn sign_data(&mut self, data: &[u8]) -> Result<Vec<u8>> {
        use sha2::Digest;
        let mut hasher = sha2::Sha256::new();
        hasher.update(data);
        let hash = hasher.finalize();

        let mut digest_info = vec![
            0x30, 0x31, 0x30, 0x0D, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 
            0x05, 0x00, 0x04, 0x20
        ];
        digest_info.extend_from_slice(&hash);

        self.compute_signature(&digest_info).await
    }

    /// Compute Digital Signature (Low Level)
    pub async fn compute_signature(&mut self, data: &[u8]) -> Result<Vec<u8>> {
        let cla = 0x80; 
        let cmd = ApduCommand::new(cla, INS_COMPUTE_DIGITAL_SIGNATURE, 0x00, 0x80)
            .with_data(data)
            .with_le(0x00);
        
        let res = self.reader.transmit(&cmd.to_bytes()).await?;
        Self::check_sw(&res)?;
        Ok(res[0..res.len()-2].to_vec())
    }

    /// Read the Authentication Certificate
    pub async fn read_auth_cert(&mut self) -> Result<Vec<u8>> {
        self.select_jpki_ap().await?;
        self.read_ef_full(&[0x00, 0x0A]).await.context("Failed to read Auth Certificate")
    }

    /// Read the Digital Signature Certificate
    pub async fn read_sign_cert(&mut self) -> Result<Vec<u8>> {
        self.select_jpki_ap().await?;
        self.read_ef_full(&[0x00, 0x01]).await.context("Failed to read Signature Certificate")
    }

    /// Read My Number (Individual Number)
    pub async fn read_mynumber(&mut self, pin: &str) -> Result<String> {
        self.select_input_support_ap().await?;
        self.verify_pin(&file_ids::EF_INPUT_SUPPORT_PIN, pin).await?;

        let data = self.read_ef_full(&file_ids::EF_MYNUMBER).await?;
        let tlvs = parse_ber_tlv(&data);
        
        fn find_mynumber_recursive(tlvs: &[crate::utils::BerTlv]) -> Option<String> {
            for tlv in tlvs {
                if tlv.tag == 0x01 && tlv.value.len() == 12 {
                    if tlv.value.iter().all(|&b| b.is_ascii_digit()) {
                        return Some(tlv.as_utf8());
                    }
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

        for i in 0..=data.len().saturating_sub(12) {
             let slice = &data[i..i+12];
             if slice.iter().all(|&b| b.is_ascii_digit()) {
                 return Ok(String::from_utf8_lossy(slice).into_owned());
             }
        }

        Err(anyhow::anyhow!("Individual Number not found"))
    }

    /// Read Basic 4 Information
    pub async fn read_attributes(&mut self, pin: &str, expiration: Option<&str>, security_code: Option<&str>) -> Result<BasicInfo> {
        self.select_input_support_ap().await?;
        self.verify_pin(&file_ids::EF_INPUT_SUPPORT_PIN, pin).await?;

        let mut exp_digits = String::new();
        let mut sc_digits = String::new();

        if let (Some(exp), Some(sc)) = (expiration, security_code) {
             exp_digits = exp.to_string();
             sc_digits = sc.to_string();
        } else {
            let surface_info_data = self.read_ef_full(&file_ids::EF_SURFACE_INFO).await
                .context("Failed to read Surface Info")?;
            
            let contains_candidates = |data: &[u8]| -> bool {
                 let s = String::from_utf8_lossy(data);
                 let mut digits = String::new();
                 for c in s.chars() {
                     if c.is_ascii_digit() { digits.push(c); } else { digits.push(' '); }
                 }
                 digits.split_whitespace().any(|chunk| chunk.len() == 8 && chunk.starts_with("20"))
            };

            let mut final_surface_data = surface_info_data;
            if !contains_candidates(&final_surface_data) {
                 if let Ok(data6) = self.read_ef_full(&file_ids::EF_SURFACE_INFO_B).await {
                     if contains_candidates(&data6) { final_surface_data = data6; }
                 }
            }

            let mut groups = Vec::new();
            let mut current = String::new();
            for &b in &final_surface_data {
                if (0x30..=0x39).contains(&b) { current.push(b as char); }
                else if !current.is_empty() { groups.push(current.clone()); current.clear(); }
            }
            if !current.is_empty() { groups.push(current); }

            let mut date_found_idx = None;
            for (idx, group) in groups.iter().enumerate() {
                if group.len() >= 8 && group.starts_with("20") {
                    exp_digits = group[0..8].to_string();
                    date_found_idx = Some(idx);
                    break;
                }
            }

            if exp_digits.is_empty() {
                for i in 0..groups.len() {
                    if groups[i].len() == 4 && groups[i].starts_with("20") && i + 2 < groups.len() {
                        if let (Ok(m), Ok(d)) = (groups[i+1].parse::<u8>(), groups[i+2].parse::<u8>()) {
                            if m <= 12 && d <= 31 {
                                exp_digits = format!("{}{:02}{:02}", groups[i], m, d);
                                date_found_idx = Some(i + 2);
                                break;
                            }
                        }
                    }
                }
            }
            
             if let Some(last_used_idx) = date_found_idx {
                if groups[date_found_idx.unwrap()].len() >= 12 {
                     sc_digits = groups[date_found_idx.unwrap()][8..12].to_string();
                } else {
                     for group in groups.iter().skip(last_used_idx + 1) {
                        if group.len() == 4 { sc_digits = group.clone(); break; }
                    }
                }
            }
        }

        let attr_data = self.read_ef_full(&file_ids::EF_ATTRIBUTES).await.context("Failed to read Attributes EF")?;
        let mut info = Self::parse_basic_info(&attr_data)?;

        let mut photo_data_opt = None;
        if let Ok(data) = self.read_ef_full(&file_ids::EF_FACE_PHOTO).await {
             photo_data_opt = Some(data);
        }

        if photo_data_opt.is_none() && info.birth_date.len() == 8 && exp_digits.len() == 8 && sc_digits.len() == 4 {
            let dob_yymmdd = &info.birth_date[2..8];
            let b_number = format!("{}{}{}", dob_yymmdd, exp_digits, sc_digits);
            if let Ok(data) = self.read_face_photo_with_b_number(&b_number).await {
                photo_data_opt = Some(data);
            }
        }

        if let Some(raw_data) = photo_data_opt {
            if let Some(img_payload) = Self::extract_image_data(&raw_data) {
                info.face_photo = Some(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, img_payload));
            }
        }

        Ok(info)
    }

    /// TLV構造を解析して画像データの開始位置を特定する
    fn extract_image_data(data: &[u8]) -> Option<&[u8]> {
        let tlvs = parse_ber_tlv(data);
        
        fn find_image_recursive<'a>(tlvs: &[crate::utils::BerTlv<'a>]) -> Option<&'a [u8]> {
            for tlv in tlvs {
                let val = tlv.value;
                if val.len() > 100 && (val.starts_with(&[0xFF, 0xD8]) || val.starts_with(&[0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50]) || val.starts_with(&[0xFF, 0x4F])) {
                    return Some(val);
                }
                if let Some(found) = find_image_recursive(&tlv.children) { return Some(found); }
            }
            None
        }

        if let Some(p) = find_image_recursive(&tlvs) { return Some(p); }

        let len = data.len();
        for i in 0..len.min(512) {
            if data[i] == 0xFF && i + 1 < len && data[i+1] == 0xD8 { return Some(&data[i..]); }
            if data[i] == 0xFF && i + 1 < len && data[i+1] == 0x4F { return Some(&data[i..]); }
            if i + 12 < len && data[i] == 0x00 && data[i+1] == 0x00 && data[i+2] == 0x00 && data[i+3] == 0x0C && data[i+4] == 0x6A && data[i+5] == 0x50 { return Some(&data[i..]); }
        }
        None
    }

    /// Helper to read a full EF by looping READ BINARY
    pub async fn read_ef_full(&mut self, ef_id: &[u8]) -> Result<Vec<u8>> {
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(ef_id);
        let res_sel = self.reader.transmit(&select.to_bytes()).await?;
        Self::check_sw(&res_sel)?;

        let mut data = Vec::new();
        let mut offset: u16 = 0;
        loop {
            let p1 = (offset >> 8) as u8;
            let p2 = (offset & 0xFF) as u8;
            let read = ApduCommand::new(CLA_ISO, INS_READ_BINARY, p1, p2).with_le(0x00);
            let res = self.reader.transmit(&read.to_bytes()).await?;
            let len = res.len();
            if len < 2 { return Err(anyhow::anyhow!("Response too short")); }
            let sw1 = res[len - 2];
            let sw2 = res[len - 1];

            if sw1 == 0x90 && sw2 == 0x00 { } 
            else if sw1 == 0x62 && sw2 == 0x82 { } 
            else if sw1 == 0x6B && sw2 == 0x00 { break; }
            else { return Err(anyhow::anyhow!("Read Binary Error: SW={:02X}{:02X}", sw1, sw2)); }

            let chunk = &res[0..len-2];
            if chunk.is_empty() { break; }
            data.extend_from_slice(chunk);
            offset += chunk.len() as u16;
            if chunk.len() < 256 { break; }
        }
        Ok(data)
    }

    async fn read_face_photo_with_b_number(&mut self, b_number: &str) -> Result<Vec<u8>> {
        let aids: [([u8; 10], &str); 1] = [
            ([0xD3, 0x92, 0x10, 0x00, 0x31, 0x00, 0x01, 0x01, 0x04, 0x01], "Face Auth (01)"),
        ];

        for (aid, _name) in aids {
            let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C).with_data(&aid).to_bytes();
            if let Ok(res) = self.reader.transmit(&apdu).await {
                if res.len() < 2 || res[res.len()-2] != 0x90 { continue; }
            } else { continue; } 
            
            let mut candidates = Vec::new();
            if b_number.len() == 18 {
                candidates.push(b_number.to_string());
                candidates.push(format!("{}{}{}", &b_number[0..6], &b_number[8..14], &b_number[14..18]));
                candidates.push(format!("{}{}{}", &b_number[0..6], &b_number[6..10], &b_number[14..18]));
                candidates.push(format!("{}{}", &b_number[6..14], &b_number[14..18]));
            } else { candidates.push(b_number.to_string()); }

            let mut verify_success = false;
            for pin_val in candidates {
                let verify_apdu = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80).with_data(pin_val.as_bytes()).to_bytes();
                if let Ok(res) = self.reader.transmit(&verify_apdu).await {
                    if res.len() >= 2 && res[res.len()-2] == 0x90 { verify_success = true; break; }
                }
                
                let sel_12 = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(&[0x00, 0x12]).to_bytes();
                if let Ok(res) = self.reader.transmit(&sel_12).await {
                    if res.len() >= 2 && res[res.len()-2] == 0x90 {
                        let v_12 = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80).with_data(pin_val.as_bytes()).to_bytes();
                        if let Ok(res_v) = self.reader.transmit(&v_12).await {
                            if res_v.len() >= 2 && res_v[res_v.len()-2] == 0x90 { verify_success = true; break; }
                        }
                    }
                }
            }

            if !verify_success { continue; }

            if let Ok(d) = self.read_ef_full(&file_ids::EF_FACE_PHOTO).await {
                 if d.len() > 100 { return Ok(d); }
            }

            for i in 1u8..=20 {
                let ef_id = [0x00, i];
                if let Ok(res_sel) = self.reader.transmit(&ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(&ef_id).to_bytes()).await {
                     if res_sel.len() >= 2 && res_sel[res_sel.len()-2] == 0x90 {
                          if let Ok(d) = self.read_ef_full(&ef_id).await { if d.len() > 1000 { return Ok(d); } }
                     }
                }
            }
        }
        Err(anyhow::anyhow!("Photo not found"))
    }

    fn parse_basic_info(data: &[u8]) -> Result<BasicInfo> {
        let mut info = BasicInfo::default();
        let tlvs = parse_ber_tlv(data);
        
        fn collect_tags(tlvs: &[crate::utils::BerTlv], map: &mut std::collections::HashMap<u32, String>) {
            for tlv in tlvs {
                let text = tlv.as_utf8();
                // println!("Debug: Found Tag {:04X}, Value Len: {}", tlv.tag, tlv.value.len());
                map.insert(tlv.tag, text);
                collect_tags(&tlv.children, map);
            }
        }

        let mut tag_map = std::collections::HashMap::new();
        collect_tags(&tlvs, &mut tag_map);

        if let Some(v) = tag_map.get(&0xDF22) { info.name = v.clone(); }
        if let Some(v) = tag_map.get(&0xDF23) { info.address = v.clone(); }
        if let Some(v) = tag_map.get(&0xDF24) { info.birth_date = v.clone(); }
        if let Some(v) = tag_map.get(&0xDF25) { info.gender = v.clone(); }
        
        Ok(info)
    }

    fn check_sw(res: &[u8]) -> Result<()> {
        if res.len() < 2 { return Err(anyhow::anyhow!("Response too short")); }
        let sw1 = res[res.len() - 2];
        let sw2 = res[res.len() - 1];
        if sw1 == 0x90 && sw2 == 0x00 { Ok(()) } 
        else { Err(anyhow::anyhow!("Card Error: SW={:02X}{:02X}", sw1, sw2)) }
    }
}

#[cfg(test)]

mod tests {

    use super::*;

    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;



    #[derive(Clone)]

    struct MockReader {

        pub sent_apdus: Arc<Mutex<Vec<Vec<u8>>>>,

        pub responses: Arc<Mutex<Vec<Vec<u8>>>>,

    }



    impl MockReader {

        fn new(response: Vec<u8>) -> Self {

            Self {

                sent_apdus: Arc::new(Mutex::new(Vec::new())),

                responses: Arc::new(Mutex::new(vec![response])),

            }

        }

        

        fn with_responses(responses: Vec<Vec<u8>>) -> Self {

            Self {

                sent_apdus: Arc::new(Mutex::new(Vec::new())),

                responses: Arc::new(Mutex::new(responses)),

            }

        }

    }



    #[cfg_attr(target_arch = "wasm32", async_trait(?Send))]

    #[cfg_attr(not(target_arch = "wasm32"), async_trait)]

    impl CardReader for MockReader {

        async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {

            self.sent_apdus.lock().unwrap().push(apdu.to_vec());

            let mut resps = self.responses.lock().unwrap();

            if resps.len() > 1 {

                Ok(resps.remove(0))

            } else {

                Ok(resps[0].clone())

            }

        }

    }



    #[tokio::test]

    async fn test_select_jpki_ap() {

        let mock = MockReader::new(vec![0x90, 0x00]);

        let mut controller = JpkiController::new(mock.clone());

        assert!(controller.select_jpki_ap().await.is_ok());

        let apdus = mock.sent_apdus.lock().unwrap();

        assert_eq!(apdus[0][0..5], vec![0x00, 0xA4, 0x04, 0x0C, 0x0A]);

    }



    #[tokio::test]

    async fn test_sign_data_construction() {

        let mock = MockReader::new(vec![0x12, 0x34, 0x90, 0x00]);

        let mut controller = JpkiController::new(mock.clone());

        let _ = controller.sign_data(b"test").await;

        let apdus = mock.sent_apdus.lock().unwrap();

        let expected_prefix = vec![0x30, 0x31, 0x30, 0x0D, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20];

        let cmd_data = &apdus[0][5..apdus[0].len()-1]; 

        assert_eq!(&cmd_data[0..expected_prefix.len()], expected_prefix.as_slice());

    }



        #[tokio::test]



        async fn test_parse_basic_info_recursive() {



            // Correct length calculation:



            // DF 22 09 [9 bytes] -> 2 + 1 + 9 = 12



            // DF 23 05 [5 bytes] -> 2 + 1 + 5 = 8



            // Total = 20 bytes (0x14)



            let data = vec![



                0xDF, 0x20, 0x14, // DF20 (Constructed), Len 20 (0x14)



                    0xDF, 0x22, 0x09, b'K', b'O', b'N', b'O', b' ', b'T', b'A', b'R', b'O',



                    0xDF, 0x23, 0x05, b'T', b'O', b'K', b'Y', b'O'



            ];



            let res = JpkiController::<MockReader>::parse_basic_info(&data).unwrap();



            assert_eq!(res.name, "KONO TARO");



            assert_eq!(res.address, "TOKYO");



        }



    



    #[tokio::test]

    async fn test_get_pin_retry_count_logic() {

        // 1. SELECT succeeds (9000), 2. VERIFY returns 63C1

        let mock = MockReader::with_responses(vec![

            vec![0x90, 0x00],

            vec![0x63, 0xC1],

        ]);

        let mut controller = JpkiController::new(mock);

        let retries = controller.get_pin_retry_count(&[0x00, 0x18]).await.unwrap();

        assert_eq!(retries, 1);

    }

}
