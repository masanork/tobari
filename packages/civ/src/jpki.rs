use crate::apdu::{ApduCommand, file_ids, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY, INS_VERIFY, INS_COMPUTE_DIGITAL_SIGNATURE};
use crate::reader::CardReader;
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

    /// Verify PIN
    /// pin_type: Usually 0x0018 (Auth) or 0x001B (Sign) or 0x0011 (Input Support)
    /// pin: The pin string (e.g. "1234")
    pub async fn verify_pin(&mut self, pin_ef: &[u8], pin: &str) -> Result<()> {
        // 1. Select PIN EF (Not strictly required by ISO if implicit, but JPKI usually requires VERIFY command direct or after select)
        // JPKI often uses VERIFY command directly. 
        // For strictness: Select EF -> Verify.
        // Or Verify with P2 referencing the PIN reference.
        // Assuming standard JPKI flow: Select EF of PIN first.
        let select_pin = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(pin_ef);
        let res_sel = self.reader.transmit(&select_pin.to_bytes()).await?;
        Self::check_sw(&res_sel).context("Failed to select PIN EF")?;

        // 2. VERIFY
        // P2=0x80 (Specific reference) or 0x00 (Implicit known)
        // JPKI: CLA=00, INS=20, P1=00, P2=80, Data=PIN
        let pin_bytes = pin.as_bytes();
        let verify = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80)
            .with_data(pin_bytes);
        
        let res = self.reader.transmit(&verify.to_bytes()).await?;
        Self::check_sw(&res).context("PIN Verification Failed")
    }

    /// Get PIN Retry Count
    /// Helper to assume the correct AP is already selected and PIN EF is selected.
    pub async fn get_pin_retry_count(&mut self, pin_ef: &[u8]) -> Result<u8> {
        // 1. Select PIN EF
        let select_pin = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(pin_ef);
        let res_sel = self.reader.transmit(&select_pin.to_bytes()).await?;
        Self::check_sw(&res_sel).context("Failed to select PIN EF")?;

        // 2. VERIFY with Empty Data (Check Status)
        let verify = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80); 
        // No data means "Check Status" usually
        
        let res = self.reader.transmit(&verify.to_bytes()).await?;
        
        // Check SW: 63 Cx means x retries left. 9000 means verified?
        if res.len() >= 2 {
            let sw1 = res[res.len()-2];
            let sw2 = res[res.len()-1];
            
            if sw1 == 0x63 && (sw2 & 0xF0) == 0xC0 {
                return Ok(sw2 & 0x0F);
            }
            if sw1 == 0x90 && sw2 == 0x00 {
                // Already verified or no restriction?
                // Some cards return 9000 if already verified.
                return Ok(255); // Special value for "Verified/Unlimited"
            }
        }
        
        Err(anyhow::anyhow!("Unknown PIN Status SW: {:02X}{:02X}", 
            if res.len()>=2 { res[res.len()-2] } else {0},
            if res.len()>=2 { res[res.len()-1] } else {0}
        ))
    }

    /// Compute Digital Signature
    /// data: The digest/data to sign.
    pub async fn compute_signature(&mut self, data: &[u8]) -> Result<Vec<u8>> {
        // JPKI Compute Signature:
        // CLA=80 (Secure Messaging) or 00, INS=2A 
        // Mode: P1=00, P2=80 usually indicates inputs.
        // Simple implementation: CLA=0x80 might be needed for some cards, but trying ISO 0x00 first or 0x80 based on specs.
        // JPKI often requires CLA=0x80 for command chaining or specific mode. 
        // Using 0x80 for Compute Signature as per common JPKI implementations.
        let cla = 0x80; 
        let cmd = ApduCommand::new(cla, INS_COMPUTE_DIGITAL_SIGNATURE, 0x00, 0x80)
            .with_data(data)
            .with_le(0x00); // Expecting max length return
        
        let res = self.reader.transmit(&cmd.to_bytes()).await?;
        Self::check_sw(&res)?;
        // Return data minus SW
        Ok(res[0..res.len()-2].to_vec())
    }

    /// Read the Authentication Certificate (User Auth CA)
    /// Note: Needs SELECT EF first.
    pub async fn read_auth_cert(&mut self) -> Result<Vec<u8>> {
        // 1. Select EF (00 18 is Auth PIN, Cert is usually under Token Info or specific EF - needs detailed spec, usually 000A for Cert)
        // Correct JPKI spec: Auth Cert is usually EF000A under Auth AP.
        let ef_cert = [0x00, 0x0A];
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(&ef_cert);
        self.reader.transmit(&select.to_bytes()).await?;
        
        // 2. Read Binary (Looping required for full content)
        // Simplified: Read first 32 bytes just to check
        let read = ApduCommand::new(CLA_ISO, INS_READ_BINARY, 0x00, 0x00)
            .with_le(0x20); // 32 bytes
        
        let data = self.reader.transmit(&read.to_bytes()).await?;
        Self::check_sw(&data)?;
        // Strip SW
        Ok(data[0..data.len()-2].to_vec())
    }

    /// Read My Number (Individual Number)
    /// Requires the Input Support PIN (4 digits).
    pub async fn read_mynumber(&mut self, pin: &str) -> Result<String> {
        // 1. Select Input Support AP
        self.select_input_support_ap().await?;

        // 2. Verify PIN
        self.verify_pin(&file_ids::EF_INPUT_SUPPORT_PIN, pin).await?;

        // 3. Select My Number EF
        let select_mn = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(&file_ids::EF_MYNUMBER);
        let res_sel = self.reader.transmit(&select_mn.to_bytes()).await?;
        Self::check_sw(&res_sel).context("Failed to select MyNumber EF")?;

        // 4. Read Binary (My Number is 12 digits + 1 byte padding/length usually, or 12 bytes + more.
        // My Number file content is usually: 12 digits (ASCII/Numeric) + check digit or padding. 
        // Actually, the EF content follows a TLV or fixed structure.
        // My Number is 12 digits.
        let read = ApduCommand::new(CLA_ISO, INS_READ_BINARY, 0x00, 0x00)
            .with_le(0x00); // Read Max length (256) to be safe against headers/padding
        
        let data = self.reader.transmit(&read.to_bytes()).await?;
        Self::check_sw(&data)?;
        
        // The data returned usually contains the My Number directly or in a block.
        // For My Number EF (0001), the first 12 bytes are the My Number digits.
        let content = &data[0..data.len()-2];
        
        // Scan for 12 consecutive digits
        for i in 0..=content.len().saturating_sub(12) {
             let slice = &content[i..i+12];
             if slice.iter().all(|&b| b.is_ascii_digit()) {
                 return Ok(String::from_utf8(slice.to_vec()).unwrap());
             }
        }

        // Fallback: If scanning failed, check length and return error or partial
        if content.len() < 12 {
            return Err(anyhow::anyhow!("MyNumber data too short"));
        }
        
        // Strict try if scan didn't find "pure" digits (maybe they are not digits?)
        let my_number = String::from_utf8(content[0..12].to_vec())
            .context("MyNumber is not valid UTF-8/ASCII")?;
            
        Ok(my_number)
    }

    /// Read Basic 4 Information (Name, Address, DOB, Gender)
    /// Also attempts to read face photo if possible using derived Verification Number B.
    pub async fn read_attributes(&mut self, pin: &str) -> Result<BasicInfo> {
        // 1. Select Input Support AP
        self.select_input_support_ap().await?;

        // 2. Verify PIN
        self.verify_pin(&file_ids::EF_INPUT_SUPPORT_PIN, pin).await?;

        // 3. Read Surface Info (Expiration, Security Code) - required for B-Number
        // This EF0005 is under Input Support AP and usually requires the same PIN
        let mut surface_info_data = self.read_ef_full(&file_ids::EF_SURFACE_INFO).await
            .context("Failed to read Surface Info (EF0005)")?;
        
        println!("Debug: EF0005 Read. Len: {}, Hex: {}", surface_info_data.len(), hex::encode(&surface_info_data));

        // Format check helper
        let is_valid_surface = |data: &[u8]| -> bool {
            // Very basic check: needs to contain some digits?
            // If it's all zeros, it's invalid.
            data.iter().any(|&b| b != 0x00)
        };

        if !is_valid_surface(&surface_info_data) {
             println!("Debug: EF0005 seems empty. Trying EF0006...");
             if let Ok(data6) = self.read_ef_full(&file_ids::EF_SURFACE_INFO_B).await {
                 println!("Debug: EF0006 Read. Len: {}, Hex: {}", data6.len(), hex::encode(&data6));
                 if is_valid_surface(&data6) {
                     surface_info_data = data6;
                 }
             }
        }

        // Parse Surface Info: attempt to extract YYYYMMDD and Security Code (4 digits)
        if surface_info_data.len() < 12 {
            println!("Debug: EF0005 data too short (<12 bytes), skipping face photo.");
        }

        let extract_digit_groups = |bytes: &[u8]| -> Vec<String> {
            let mut groups = Vec::new();
            let mut current = String::new();
            for &b in bytes {
                if (0x30..=0x39).contains(&b) {
                    current.push(b as char);
                } else if !current.is_empty() {
                    groups.push(current.clone());
                    current.clear();
                }
            }
            if !current.is_empty() {
                groups.push(current);
            }
            groups
        };

        let raw_exp_bytes = if surface_info_data.len() >= 8 { &surface_info_data[0..8] } else { &[] };
        let raw_sc_bytes = if surface_info_data.len() >= 12 { &surface_info_data[8..12] } else { &[] };

        let expiration_raw = String::from_utf8_lossy(raw_exp_bytes).to_string();
        let security_code_raw = String::from_utf8_lossy(raw_sc_bytes).to_string();
        println!("Debug: ExpirationRaw='{}', len={}", expiration_raw, expiration_raw.len());
        println!("Debug: SCRaw='{}', len={}", security_code_raw, security_code_raw.len());

        let groups = extract_digit_groups(&surface_info_data);
        println!("Debug: SurfaceInfo digit groups: {:?}", groups);

        let mut exp_digits = String::new();
        let mut sc_digits = String::new();
        let mut date_found_idx = None;

        // 1. Try to find explicit 8 digit date (e.g. 20250331)
        for (idx, group) in groups.iter().enumerate() {
            if group.len() >= 8 {
                // If the group is longer than 8, it might contain connected security code
                // But we prioritize finding the date part.
                // My Number Card expiration starts with 20 (for foreseeable future)
                if group.starts_with("20") {
                    exp_digits = group[0..8].to_string();
                    date_found_idx = Some(idx);
                    break;
                }
            }
        }

        // 2. If not found, try to assemble from parts (YYYY, MM, DD) which are split by non-digits (e.g. 2025年3月31日)
        if exp_digits.is_empty() {
            for i in 0..groups.len() {
                if groups[i].len() == 4 && groups[i].starts_with("20") {
                    // Potential Year
                    if i + 2 < groups.len() {
                        let year = &groups[i];
                        let month = &groups[i+1];
                        let day = &groups[i+2];

                        // Basic validation for Month/Day parts
                        if month.len() <= 2 && day.len() <= 2 {
                             if let (Ok(m), Ok(d)) = (month.parse::<u8>(), day.parse::<u8>()) {
                                 if m >= 1 && m <= 12 && d >= 1 && d <= 31 {
                                     exp_digits = format!("{}{:02}{:02}", year, m, d);
                                     date_found_idx = Some(i + 2);
                                     break;
                                 }
                             }
                        }
                    }
                }
            }
        }

        // 3. Look for Security Code (4 digits) after the date
        // Note: Security Code is a 4-digit number.
        if let Some(last_used_idx) = date_found_idx {
            // Check remaining characters in the same group if we split a large group?
            // In step 1, we took [0..8]. If group len > 8, the rest might be SC.
            let group_at_date = &groups[date_found_idx.unwrap()]; // Re-access safe because index comes from loop
            // But wait, if we used step 2, date_found_idx points to 'day' group.
            // If we used step 1, date_found_idx points to the single group containing date.

            // Logic A: Check if the date group itself has more digits (e.g. 202503311234)
            // But extract_digit_groups splits by non-digits.
            // If the input was "202503311234", it is one group.
            // In Step 1: we took first 8 chars.
            if group_at_date.len() >= 12 {
                // likely 8 digit date + 4 digit SC
                 sc_digits = group_at_date[8..12].to_string();
            } else {
                 // Logic B: Search subsequent groups
                 for group in groups.iter().skip(last_used_idx + 1) {
                    if group.len() == 4 {
                        sc_digits = group.clone();
                        break;
                    }
                }
            }
        }

        println!("Debug: ExpDigits='{}', SCDigits='{}'", exp_digits, sc_digits);

        // 4. Select Attributes EF and Read
        let attr_data = self.read_ef_full(&file_ids::EF_ATTRIBUTES).await
            .context("Failed to read Attributes EF")?;
        
        let mut info = Self::parse_basic_info(&attr_data)?;

        // 5. Attempt to Read Face Photo using derived B-Number
        // B-Number = DOB(YYMMDD) + Expiration(YYMMDD) + SecurityCode(4)
        // We need exp_digits to be at least 8 chars (YYYYMMDD) to extract YYMMDD
        // We need sc_digits to be 4 chars
        if info.birth_date.len() == 8 && exp_digits.len() == 8 && sc_digits.len() == 4 {
            let dob_yymmdd = &info.birth_date[2..8];
            let exp_yymmdd = &exp_digits[2..8]; // Extract YYMMDD from YYYYMMDD
            let b_number = format!("{}{}{}", dob_yymmdd, exp_yymmdd, sc_digits);
            println!("Debug: Derived B-Number: {}", b_number);

            match self.read_face_photo_with_b_number(&b_number).await {
                Ok(photo_data) => {
                    println!("Debug: Read Photo Success. Size: {}", photo_data.len());
                    // Return raw JP2 data (Base64 encoded) to be handled by frontend
                    info.face_photo = Some(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, photo_data));
                },
                Err(e) => {
                    eprintln!("Debug: Read Photo Failed: {:?}", e);
                }
            }
        } else {
             eprintln!("Debug: Conditions for Face Photo not met. InfoLen={}, ExpDigitsLen={}, SCDigitsLen={}", 
                info.birth_date.len(), exp_digits.len(), sc_digits.len());
        }

        Ok(info)
    }

    /// Helper to read a full EF by looping READ BINARY
    pub async fn read_ef_full(&mut self, ef_id: &[u8]) -> Result<Vec<u8>> {
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(ef_id);
        let res_sel = self.reader.transmit(&select.to_bytes()).await?;
        Self::check_sw(&res_sel)?;

        let mut data = Vec::new();
        let mut offset: u16 = 0;
        loop {
            let p1 = (offset >> 8) as u8;
            let p2 = (offset & 0xFF) as u8;
            let read = ApduCommand::new(CLA_ISO, INS_READ_BINARY, p1, p2).with_le(0x00);
            let res = self.reader.transmit(&read.to_bytes()).await?;
            let chunk = &res[0..res.len()-2];
            if chunk.is_empty() { break; }
            data.extend_from_slice(chunk);
            offset += chunk.len() as u16;
            if chunk.len() < 256 { break; }
        }
        Ok(data)
    }

    async fn read_face_photo_with_b_number(&mut self, b_number: &str) -> Result<Vec<u8>> {
        // 1. Select Face Recognition AP
        self.select_face_recognition_ap().await?;

        // 2. Verify B-Number (as PIN)
        // EF ID for B-Number is 0011 (same as Input Support PIN EF ID but under this AP)
        self.verify_pin(&file_ids::EF_FACE_RECOGNITION_PIN, b_number).await?;

        // 3. Read Face Photo EF
        self.read_ef_full(&file_ids::EF_FACE_PHOTO).await
    }

    fn parse_basic_info(data: &[u8]) -> Result<BasicInfo> {
        let mut info = BasicInfo::default();
        let mut i = 0;
        while i < data.len() {
            // Tag
            if i + 1 >= data.len() { break; }
            let tag = ((data[i] as u16) << 8) | (data[i+1] as u16);
            i += 2;

            // Length (BER-TLV)
            if i >= data.len() { break; }
            let mut len = data[i] as usize;
            i += 1;
            
            if len == 0x81 {
                if i >= data.len() { break; }
                len = data[i] as usize;
                i += 1;
            } else if len == 0x82 {
                if i + 1 >= data.len() { break; }
                len = ((data[i] as usize) << 8) | (data[i+1] as usize);
                i += 2;
            } else if len > 0x82 {
                // Unsupported length format for now
                break;
            }

            // Handle JPKI Wrapper Tag (DF20 or FF20)
            // Some cards use FF20 as the outer wrapper
            if tag == 0xDF20 || tag == 0xFF20 {
                // Continue to parse content inside
                continue;
            }

            // Value
            if i + len > data.len() { break; }
            let value = &data[i..i+len];
            i += len;

            let text = String::from_utf8(value.to_vec()).unwrap_or_default();

            match tag {
                // Mappings observed from card data:
                // DF21: Unknown/Binary (Skip)
                // DF22: Name
                // DF23: Address
                // DF24: DOB
                // DF25: Gender
                0xDF22 => info.name = text,
                0xDF23 => info.address = text,
                0xDF24 => info.birth_date = text,
                0xDF25 => info.gender = text,
                _ => {} // Ignore unknown tags
            }
        }
        Ok(info)
    }

    fn check_sw(res: &[u8]) -> Result<()> {
        if res.len() < 2 {
            return Err(anyhow::anyhow!("Response too short"));
        }
        let sw1 = res[res.len() - 2];
        let sw2 = res[res.len() - 1];
        if sw1 == 0x90 && sw2 == 0x00 {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Card Error: SW={:02X}{:02X}", sw1, sw2))
        }
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
        pub response: Vec<u8>,
    }

    impl MockReader {
        fn new(response: Vec<u8>) -> Self {
            Self {
                sent_apdus: Arc::new(Mutex::new(Vec::new())),
                response,
            }
        }
    }

    #[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
    #[cfg_attr(not(target_arch = "wasm32"), async_trait)]
    impl CardReader for MockReader {
        async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
            self.sent_apdus.lock().unwrap().push(apdu.to_vec());
            Ok(self.response.clone())
        }
    }

    #[tokio::test]
    async fn test_select_jpki_ap() {
        let mock = MockReader::new(vec![0x90, 0x00]); // Success SW
        let mut controller = JpkiController::new(mock.clone());

        let res = controller.select_jpki_ap().await;
        assert!(res.is_ok());

        let apdus = mock.sent_apdus.lock().unwrap();
        assert_eq!(apdus.len(), 1);
        // CLA=00, INS=A4, P1=04, P2=0C, Lc=0A (10), Data=DF_JPKI(10)
        let expected_head = vec![0x00, 0xA4, 0x04, 0x0C, 0x0A];
        assert_eq!(apdus[0][0..5], expected_head[..]);
        assert_eq!(apdus[0][5..], file_ids::DF_JPKI[..]);
    }

    #[tokio::test]
    async fn test_verify_pin() {
        let mock = MockReader::new(vec![0x90, 0x00]);
        let mut controller = JpkiController::new(mock.clone());

        // Select PIN EF is called first internally in our impl
        // So we expect 2 commands: SELECT EF, then VERIFY
        let res = controller.verify_pin(&file_ids::EF_AUTH_PIN, "1234").await;
        assert!(res.is_ok());

        let apdus = mock.sent_apdus.lock().unwrap();
        assert_eq!(apdus.len(), 2);

        // 1. SELECT
        assert_eq!(apdus[0][1], INS_SELECT_FILE);
        // 2. VERIFY
        assert_eq!(apdus[1][1], INS_VERIFY);
        // Check PIN "1234" -> 31 32 33 34
        assert_eq!(&apdus[1][5..], b"1234");
    }

    #[tokio::test]
    async fn test_read_attributes_parsing() {
        let mock = MockReader::new(vec![0x90, 0x00]);
        let mut controller = JpkiController::new(mock.clone());

        // We need a more flexible mock for sequential responses
        // But for parse_basic_info, we can test it directly
        let mut data = vec![
            0xDF, 0x22, 0x09, b'K', b'O', b'N', b'O', b' ', b'T', b'A', b'R', b'O',
            0xDF, 0x23, 0x05, b'T', b'O', b'K', b'Y', b'O'
        ];
        
        // JPKI attributes are wrapped in DF20 (sometimes) or just list of tags
        let res = JpkiController::<MockReader>::parse_basic_info(&data);
        assert!(res.is_ok());
        let info = res.unwrap();
        assert_eq!(info.name, "KONO TARO");
        assert_eq!(info.address, "TOKYO");
    }
}
