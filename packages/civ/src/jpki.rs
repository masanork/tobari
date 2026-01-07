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

    /// Sign data using the authentication key.
    /// Uses SHA-256 and wraps the hash in a DigestInfo structure as required by JPKI.
    pub async fn sign_data(&mut self, data: &[u8]) -> Result<Vec<u8>> {
        use sha2::Digest;
        // 1. Calculate SHA-256 Hash
        let mut hasher = sha2::Sha256::new();
        hasher.update(data);
        let hash = hasher.finalize();

        // 2. Construct DigestInfo for SHA-256
        // Sequence( Sequence( OID(sha256), NULL ), OctetString(hash) )
        // Prefix: 30 31 30 0D 06 09 60 86 48 01 65 03 04 02 01 05 00 04 20
        // Note: 0x0D length for inner sequence includes NULL (05 00)
        let mut digest_info = vec![
            0x30, 0x31, 
            0x30, 0x0D, 
            0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 
            0x05, 0x00, 
            0x04, 0x20
        ];
        digest_info.extend_from_slice(&hash);

        // 3. Send APDU
        self.compute_signature(&digest_info).await
    }

    /// Compute Digital Signature (Low Level)
    /// data: The digest/data to sign (usually DigestInfo).
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
    /// If expiration and security_code are provided, they are used directly for B-Number generation.
    pub async fn read_attributes(&mut self, pin: &str, expiration: Option<&str>, security_code: Option<&str>) -> Result<BasicInfo> {
        // 1. Select Input Support AP
        self.select_input_support_ap().await?;

        // 2. Verify PIN
        self.verify_pin(&file_ids::EF_INPUT_SUPPORT_PIN, pin).await?;

        // 3. Read Surface Info (Expiration, Security Code) - required for B-Number
        // Try EF0005 ("Surface Info A" - commonly used but sometimes proprietary format?)
        // 3. Read Surface Info (Expiration, Security Code) - required for B-Number
        
        let mut exp_digits = String::new();
        let mut sc_digits = String::new();
        // Keep surface_info_data available for debug logging if needed, or just scope it locally in else
        let mut surface_info_data = Vec::new();

        if let (Some(exp), Some(sc)) = (expiration, security_code) {
             println!("Debug: Using provided Expiration ({}) and Security Code ({})", exp, sc);
             exp_digits = exp.to_string();
             sc_digits = sc.to_string();
        } else {
            // Try EF0005 ("Surface Info A" - commonly used but sometimes proprietary format?)
            surface_info_data = self.read_ef_full(&file_ids::EF_SURFACE_INFO).await
                .context("Failed to read Surface Info (EF0005)")?;
            
            println!("Debug: EF0005 Read. Len: {}, Hex: {}", surface_info_data.len(), hex::encode(&surface_info_data));

            // Helper to check if data looks like it contains the Expiration Date (YYYYMMDD)
            // We look for "20" followed by 6 digits.
            let contains_candidates = |data: &[u8]| -> bool {
                 let s = String::from_utf8_lossy(data);
                 let mut digits = String::new();
                 for c in s.chars() {
                     if c.is_ascii_digit() {
                         digits.push(c);
                     } else {
                         digits.push(' ');
                     }
                 }
                 digits.split_whitespace().any(|chunk| chunk.len() == 8 && chunk.starts_with("20"))
            };

            if !contains_candidates(&surface_info_data) {
                 println!("Debug: EF0005 does not contain YYYYMMDD. Trying EF0006 (Surface Info B)...");
                 if let Ok(data6) = self.read_ef_full(&file_ids::EF_SURFACE_INFO_B).await {
                     println!("Debug: EF0006 Read. Len: {}, Hex: {}", data6.len(), hex::encode(&data6));
                     if contains_candidates(&data6) {
                         surface_info_data = data6;
                         println!("Debug: Using EF0006 data for logic.");
                     }
                 }
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

            let groups = extract_digit_groups(&surface_info_data);
            println!("Debug: SurfaceInfo digit groups: {:?}", groups);

            let mut date_found_idx = None;

            // 1. Try to find explicit 8 digit date (e.g. 20250331)
            for (idx, group) in groups.iter().enumerate() {
                if group.len() >= 8 && group.starts_with("20") {
                    exp_digits = group[0..8].to_string();
                    date_found_idx = Some(idx);
                    break;
                }
            }

            // 2. If not found, try to assemble from parts (YYYY, MM, DD)
            if exp_digits.is_empty() {
                for i in 0..groups.len() {
                    if groups[i].len() == 4 && groups[i].starts_with("20") {
                        if i + 2 < groups.len() {
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
            }
            
            // 3. Look for Security Code
             if let Some(last_used_idx) = date_found_idx {
                let group_at_date = &groups[date_found_idx.unwrap()];
                if group_at_date.len() >= 12 {
                     sc_digits = group_at_date[8..12].to_string();
                } else {
                     for group in groups.iter().skip(last_used_idx + 1) {
                        if group.len() == 4 {
                            sc_digits = group.clone();
                            break;
                        }
                    }
                }
            }
        } // End of else block



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
            // B-Number Candidate 1: 18 digits (DOB YYMMDD + Exp YYYYMMDD + SC 4)
            // We pass this "Max Info" string to the reader method, which can derive other formats if needed.
            let b_number = format!("{}{}{}", dob_yymmdd, exp_digits, sc_digits);
            println!("Debug: Derived B-Number (Base): {}", b_number);

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
            // Check SW manually because 6282 (End of file) is acceptable for Read Binary
            let len = res.len();
            if len < 2 { return Err(anyhow::anyhow!("Response too short")); }
            let sw1 = res[len - 2];
            let sw2 = res[len - 1];

            if sw1 == 0x90 && sw2 == 0x00 {
                // OK
            } else if sw1 == 0x62 && sw2 == 0x82 {
                // End of File warning, accept data
            } else if sw1 == 0x6B && sw2 == 0x00 {
                // Wrong Parameter (likely P1/P2 out of range -> EOF), stop reading
                break;
            } else {
                 return Err(anyhow::anyhow!("Read Binary Error: SW={:02X}{:02X}", sw1, sw2));
            }

            let chunk = &res[0..len-2];
            if chunk.is_empty() { break; }
            data.extend_from_slice(chunk);
            offset += chunk.len() as u16;
            if chunk.len() < 256 { break; }
        }
        Ok(data)
    }

    async fn read_face_photo_with_b_number(&mut self, b_number: &str) -> Result<Vec<u8>> {
        println!("Debug: Starting Multi-AID Scan version 2...");
        let mut aids: Vec<([u8; 10], &str)> = vec![
            ([0xD3, 0x92, 0x10, 0x00, 0x31, 0x00, 0x01, 0x01, 0x04, 0x01], "Face Auth (01)"),
        ];

        for (aid, name) in aids {
            println!("Debug: Trying AP {}", name);
            // 1. Select AP
            let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C).with_data(&aid).to_bytes();
            match self.reader.transmit(&apdu).await {
                Ok(res) => {
                    let len = res.len();
                    if len >= 2 {
                        let sw1 = res[len-2];
                        let sw2 = res[len-1];
                        if sw1 != 0x90 || sw2 != 0x00 {
                            println!("Debug: Failed to select AP {} SW={:02X}{:02X}", name, sw1, sw2);
                            continue;
                        }
                        println!("Debug: Selected AP {} OK", name);
                    }
                },
                Err(e) => {
                    println!("Debug: Transmit Error selecting {}: {}", name, e);
                    continue;
                }
            }
            
            // 2. Verify B-Number with multiple formats
            // b_number is 18 chars: DOB(6) + Exp(8) + SC(4)
            let mut candidates = Vec::new();
            if b_number.len() == 18 {
                // 1. 18 digits (DOB YYMMDD + Exp YYYYMMDD + SC 4) - Standard
                let c18 = b_number.to_string();
                candidates.push(("18digits", c18));

                // 2. 16 digits (DOB YYMMDD + Exp YYMMDD + SC 4) - Legacy/Input
                let c16 = format!("{}{}{}", &b_number[0..6], &b_number[8..14], &b_number[14..18]);
                candidates.push(("16digits", c16));

                // 3. 14 digits (DOB YYMMDD + Exp YYYY + SC 4) - Likely Correct
                let c14 = format!("{}{}{}", &b_number[0..6], &b_number[6..10], &b_number[14..18]);
                candidates.push(("14digits", c14));
                
                // 4. 12 digits (Exp YYYYMMDD + SC 4)
                let c12 = format!("{}{}", &b_number[6..14], &b_number[14..18]);
                candidates.push(("12digits", c12));
            } else {
                candidates.push(("raw", b_number.to_string()));
            }

            let mut verify_success = false;
            
            for (lbl, pin_val) in candidates {
                if verify_success { break; }
                println!("Debug: Trying PIN format {} on {}...", lbl, name);
                let pin_bytes = pin_val.as_bytes();

                // Strategy A: Direct Verify P2=80
                let verify_apdu = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80).with_data(pin_bytes).to_bytes();
                if let Ok(res) = self.reader.transmit(&verify_apdu).await {
                    let len = res.len();
                    if len >= 2 {
                        let sw1 = res[len-2];
                        let sw2 = res[len-1];
                        if sw1 == 0x63 {
                            return Err(anyhow::anyhow!("CRITICAL: Verify failed with retry counter decrement (SW={:02X}{:02X}). Aborting.", sw1, sw2));
                        }
                        if sw1 == 0x90 && sw2 == 0x00 {
                            println!("Debug: Direct Verify Success on AP {} with {}!", name, lbl);
                            verify_success = true;
                            break;
                        }
                        println!("Debug: Direct Verify (P2=80) Failed (SW={:02X}{:02X})", sw1, sw2);
                        
                        // Fallback: Try P2=00 (Global)
                        if sw1 == 0x69 && (sw2 == 0x86 || sw2 == 0x82) {
                             let v_00 = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x00).with_data(pin_bytes).to_bytes();
                             if let Ok(res00) = self.reader.transmit(&v_00).await {
                                 let l00 = res00.len();
                                 if l00 >= 2 {
                                     let s1 = res00[l00-2];
                                     let s2 = res00[l00-1];
                                     if s1 == 0x90 && s2 == 0x00 {
                                          println!("Debug: Direct Verify (P2=00) Success on AP {} with {}!", name, lbl);
                                          verify_success = true;
                                          break;
                                     }
                                     println!("Debug: Direct Verify (P2=00) Failed (SW={:02X}{:02X})", s1, s2);
                                 }
                             }
                        }
                    }
                }
                


                // Strategy B: Select EF 0012 (PIN B) then Verify
                if !verify_success {
                     // println!("Debug: Trying EF 0012 (PIN B)...");
                     let sel_12 = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(&[0x00, 0x12]).to_bytes();
                     if let Ok(res) = self.reader.transmit(&sel_12).await {
                         if res.len() >= 2 && res[res.len()-2] == 0x90 {
                             let v_12 = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80).with_data(pin_bytes).to_bytes();
                             if let Ok(res_v) = self.reader.transmit(&v_12).await {
                                 let vlen = res_v.len();
                                 if vlen >= 2 {
                                     let vsw1 = res_v[vlen-2];
                                     let vsw2 = res_v[vlen-1];
                                     if vsw1 == 0x63 {
                                         return Err(anyhow::anyhow!("CRITICAL: Verify failed with retry counter decrement (SW={:02X}{:02X}). Aborting.", vsw1, vsw2));
                                     }
                                     if vsw1 == 0x90 && vsw2 == 0x00 {
                                         println!("Debug: Verify Success (EF 0012) with {}!", lbl);
                                         verify_success = true;
                                         break;
                                     }
                                     println!("Debug: Verify (EF 0012) Failed (SW={:02X}{:02X})", vsw1, vsw2);
                                 }
                             }
                         } else {
                             println!("Debug: Select EF 0012 Failed (SW={:02X}{:02X})", res[res.len()-2], res[res.len()-1]);
                         }
                     }
                }
            } // End candidates loop

            if !verify_success {
                 println!("Debug: Verify Rejected on AP {} (All strategies)", name);
                 continue;
            }

            // 3. Read Photo EF (00 02) Directly
            println!("Debug: Reading Photo EF 0002...");
            let ef_id = file_ids::EF_FACE_PHOTO; // 00 02
            if let Ok(d) = self.read_ef_full(&ef_id).await {
                 if d.len() > 100 {
                     return Ok(d);
                 }
            }

            // 4. Fallback: Scan EFs 0001 to 0020
            for i in 1u8..=20 {
                let ef_id = [0x00, i];
                // Select
                let select_ef = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(&ef_id).to_bytes();
                if let Ok(res_sel) = self.reader.transmit(&select_ef).await {
                     let slen = res_sel.len();
                     if slen >= 2 && res_sel[slen-2] != 0x90 { continue; }
                } else { continue; }

                // Read Binary
                let mut data: Vec<u8> = Vec::new();
                match self.read_ef_full(&ef_id).await {
                    Ok(d) => {
                         if d.len() > 1000 {
                             println!("Debug: Found large file in AP {} at EF {:02X}{:02X}! Len: {}", name, ef_id[0], ef_id[1], d.len());
                             return Ok(d); // Found it!
                         }
                         if !d.is_empty() {
                              println!("Debug: Content AP {} EF {:02X}{:02X}: {}", name, ef_id[0], ef_id[1], hex::encode(&d));
                         }
                    },
                    Err(e) => {
                        // Try Record Fallback for 6981
                        if e.to_string().contains("6981") {
                             let mut record_data = Vec::new();
                             let mut record_id = 1;
                             loop {
                                let apdu = ApduCommand::new(CLA_ISO, 0xB2, record_id, 0x04).with_le(0x00).to_bytes();
                                if let Ok(res) = self.reader.transmit(&apdu).await {
                                    let rlen = res.len();
                                    if rlen < 2 { break; }
                                    if res[rlen-2] != 0x90 { break; }
                                    record_data.extend_from_slice(&res[0..rlen-2]);
                                    record_id += 1;
                                } else { break; }
                             }
                             if !record_data.is_empty() {
                                 println!("Debug: Record Content AP {} EF {:02X}{:02X}: {}", name, ef_id[0], ef_id[1], hex::encode(&record_data));
                                 // Note: Photo is unlikely to be record structured, but if it is large, return it.
                                 if record_data.len() > 1000 {
                                     return Ok(record_data);
                                 }
                             }
                        }
                    }
                }
            }
        }
        
        Err(anyhow::anyhow!("Photo not found in any candidate AP"))
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
        #[tokio::test]
    async fn test_sign_data_construction() {
        // Mock response for COMPUTE SIGNATURE (success)
        let mock = MockReader::new(vec![0x12, 0x34, 0x90, 0x00]);
        let mut controller = JpkiController::new(mock.clone());

        let data_to_sign = b"test message";
        let _ = controller.sign_data(data_to_sign).await;

        let apdus = mock.sent_apdus.lock().unwrap();
        assert_eq!(apdus.len(), 1);

        // Verify DigestInfo construction
        // Header for SHA-256: 30 31 30 0D 06 09 60 86 48 01 65 03 04 02 01 05 00 04 20
        let expected_header = vec![
            0x30, 0x31, 
            0x30, 0x0D, 
            0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 
            0x05, 0x00, 
            0x04, 0x20
        ];
        
        // Expected SHA-256 of "test message"
        // 3f0a377ba0a4a460ecb616f6507ce0d8cfa3e704025d4fda3ed0c5ca05468728
        let expected_hash = hex::decode("3f0a377ba0a4a460ecb616f6507ce0d8cfa3e704025d4fda3ed0c5ca05468728").unwrap();

        let cmd_data = &apdus[0][5..apdus[0].len()-1]; // Strip header and Le
        
        assert_eq!(&cmd_data[0..expected_header.len()], expected_header.as_slice());
        assert_eq!(&cmd_data[expected_header.len()..], expected_hash.as_slice());
    }

    #[tokio::test]
    async fn test_select_private_keys() {
        let mock = MockReader::new(vec![0x90, 0x00]);
        let mut controller = JpkiController::new(mock.clone());

        // Test Auth Key Selection
        assert!(controller.select_auth_private_key().await.is_ok());
        {
            let apdus = mock.sent_apdus.lock().unwrap();
            assert_eq!(apdus.len(), 1);
            // CLA=00, INS=A4, P1=02, P2=0C, Lc=02, Data=0017
            assert_eq!(apdus[0][5..], [0x00, 0x17]);
        }

        // Test Sign Key Selection
        mock.sent_apdus.lock().unwrap().clear();
        assert!(controller.select_sign_private_key().await.is_ok());
        {
            let apdus = mock.sent_apdus.lock().unwrap();
            assert_eq!(apdus.len(), 1);
            // CLA=00, INS=A4, P1=02, P2=0C, Lc=02, Data=001A
            assert_eq!(apdus[0][5..], [0x00, 0x1A]);
        }
    }
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
