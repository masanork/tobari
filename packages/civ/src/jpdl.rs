use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY, INS_VERIFY};
use crate::reader::CardReader;
use anyhow::{Result, Context};
use std::fmt;

/// Driver's License Application Controller
pub struct DriversLicenseController<R: CardReader> {
    reader: R,
}

#[derive(Debug, Default)]
pub struct LicenseInfo {
    pub name: String,
    pub name_kana: String,
    pub address: String,
    pub birth_date: String, // Gengou format
    pub license_number: String,
    pub issue_date: String,
    pub expire_date: String,
    pub conditions: Vec<String>,
    pub color_class: String,
    pub registered_domicile: Option<String>, // Honseki
}

impl fmt::Display for LicenseInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "License Info:\n Name: {} ({})\n Address: {}\n DOB: {}\n No: {}\n Expires: {}\n Color: {}\n Conditions: {:?}\n Honseki: {:?}", 
            self.name, self.name_kana, self.address, self.birth_date, self.license_number, self.expire_date, self.color_class, self.conditions, self.registered_domicile)
    }
}

pub mod file_ids {
    // DF1: Common Data
    pub const DF_DL: [u8; 16] = [
        0xA0, 0x00, 0x00, 0x02, 0x31, 0x01, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ];
    // DF2: Photo Data
    pub const DF_DL_PHOTO: [u8; 16] = [
        0xA0, 0x00, 0x00, 0x02, 0x31, 0x02, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ];

    pub const EF_COMMON_DATA: [u8; 2] = [0x00, 0x01]; // EF01: Main Info
    pub const EF_HONSEKI: [u8; 2] = [0x00, 0x02];     // EF02: Registered Domicile
    pub const EF_GAIJI: [u8; 2] = [0x00, 0x03];       // EF03: External Chars
    pub const EF_CONDITIONS: [u8; 2] = [0x00, 0x04];  // EF04: Condition Changes
    pub const EF_SIGNATURE: [u8; 2] = [0x00, 0x07];   // EF07: Digital Signature
    
    // In DF2
    pub const EF_PHOTO: [u8; 2] = [0x00, 0x01];       // EF01: Photo (JPEG2000)
}

impl<R: CardReader> DriversLicenseController<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }

    /// Select Driver's License Application
    pub async fn select_dl_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(&file_ids::DF_DL);
        
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res).context("Failed to select DL AP")
    }

    /// Select Driver's License Photo Application (DF2)
    pub async fn select_dl_photo_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(&file_ids::DF_DL_PHOTO);
        
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res).context("Failed to select DL Photo AP")
    }

    /// Verify PIN (PIN1 or PIN2)
    /// Uses P2=0x80 (Password for current DF context)
    pub async fn verify_pin(&mut self, pin: &str) -> Result<()> {
        let pin_bytes = pin.as_bytes();
        let apdu = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80)
            .with_data(pin_bytes);
        
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res).context("PIN Verification Failed")
    }

    /// Verify PIN1 (Common Data Access)
    pub async fn verify_pin1(&mut self, pin: &str) -> Result<()> {
        self.verify_pin(pin).await
    }

    /// Verify PIN2 (Sensitive Data Access: Honseki, Photo)
    pub async fn verify_pin2(&mut self, pin: &str) -> Result<()> {
        self.verify_pin(pin).await
    }

    /// Read Common Data (EF01) and Parse
    /// Requires PIN 1 verification beforehand.
    pub async fn read_common_data(&mut self) -> Result<LicenseInfo> {
        let raw = self.read_file(&file_ids::EF_COMMON_DATA).await?;
        self.parse_common_data(&raw)
    }
    
    // Internal parser
    fn parse_common_data(&self, data: &[u8]) -> Result<LicenseInfo> {
        use crate::utils::{parse_ber_tlv, decode_shift_jis_lossy_gaiji};
        let tlvs = parse_ber_tlv(data).unwrap_or_default();
        let mut info = LicenseInfo::default();

        for tlv in tlvs {
            match tlv.tag {
                0x11 => info.name = decode_shift_jis_lossy_gaiji(tlv.value),
                0x12 => info.name_kana = decode_shift_jis_lossy_gaiji(tlv.value),
                0x13 => info.birth_date = decode_shift_jis_lossy_gaiji(tlv.value),
                0x14 => info.address = decode_shift_jis_lossy_gaiji(tlv.value),
                0x15 => info.issue_date = decode_shift_jis_lossy_gaiji(tlv.value),
                0x17 => info.license_number = decode_shift_jis_lossy_gaiji(tlv.value),
                0x18 => info.expire_date = decode_shift_jis_lossy_gaiji(tlv.value),
                0x1A => info.color_class = decode_shift_jis_lossy_gaiji(tlv.value),
                0x1C..=0x1F => {
                    let cond = decode_shift_jis_lossy_gaiji(tlv.value);
                    if !cond.trim().is_empty() {
                        info.conditions.push(cond);
                    }
                }
                _ => {} 
            }
        }
        Ok(info)
    }

    /// Read Registered Domicile (Honseki) - EF02
    /// Requires PIN 1 & PIN 2 verification.
    pub async fn read_registered_domicile(&mut self) -> Result<String> {
        let raw = self.read_file(&file_ids::EF_HONSEKI).await?;
        // Parse TLV tag 0x41
        use crate::utils::{parse_ber_tlv, decode_shift_jis_lossy_gaiji};
        let tlvs = parse_ber_tlv(&raw).unwrap_or_default();
        for tlv in tlvs {
            if tlv.tag == 0x41 {
                return Ok(decode_shift_jis_lossy_gaiji(tlv.value));
            }
        }
        Ok("".to_string())
    }

    /// Read Digital Signature (EF07)
    /// Requires PIN 1.
    pub async fn read_signature(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_SIGNATURE).await
    }

    /// Read Face Photo (DF2/EF01) - JPEG2000
    /// Requires PIN 1 & PIN 2. Must select DF2 first.
    pub async fn read_photo(&mut self) -> Result<Vec<u8>> {
        self.select_dl_photo_ap().await?;
        
        let raw = self.read_file(&file_ids::EF_PHOTO).await?;
        
        // Parse TLV Tag 0x5F40
        use crate::utils::parse_ber_tlv;
        let tlvs = parse_ber_tlv(&raw).unwrap_or_default();
        for tlv in tlvs {
            if tlv.tag == 0x5F40 {
                return Ok(tlv.value.to_vec());
            }
        }
        
        // Fallback: search for JPEG2000 header (FF 4F)
        if let Some(start) = raw.windows(2).position(|w| w == [0xFF, 0x4F]) {
             return Ok(raw[start..].to_vec());
        }
        
        Ok(Vec::new()) 
    }

    /// Helper to Select EF and Read Binary
    async fn read_file(&mut self, file_id: &[u8]) -> Result<Vec<u8>> {
        // 1. Select File
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(file_id);
        let res_sel = self.reader.transmit(&select.to_bytes()).await?;
        Self::check_sw(&res_sel).context("Failed to select EF")?;

        // 2. Read Binary Loop
        let mut data = Vec::new();
        let mut offset: u16 = 0;
        
        loop {
            let p1 = (offset >> 8) as u8;
            let p2 = (offset & 0xFF) as u8;
            
            // Le=00 means 256 bytes
            let read = ApduCommand::new(CLA_ISO, INS_READ_BINARY, p1, p2)
                .with_le(0x00);
            
            let res = self.reader.transmit(&read.to_bytes()).await?;
            
            if res.len() < 2 {
                return Err(anyhow::anyhow!("Response too short"));
            }
            
            let sw1 = res[res.len() - 2];
            let sw2 = res[res.len() - 1];
            let chunk = &res[0..res.len()-2];
            
            if !chunk.is_empty() {
                data.extend_from_slice(chunk);
                offset += chunk.len() as u16;
            }

            if sw1 == 0x90 && sw2 == 0x00 {
                if chunk.len() < 256 {
                    break;
                }
            } else if sw1 == 0x6B {
                 break; // Offset outside limits
            } else if sw1 == 0x62 && sw2 == 0x82 {
                 break; // EOF
            } else {
                 return Err(anyhow::anyhow!("Read Binary Error: {:02X}{:02X}", sw1, sw2));
            }
        }
        
        Ok(data)
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
    use crate::test_utils::TestReader;

    #[tokio::test]
    async fn test_select_dl_ap() {
        let reader = TestReader::new();
        let mut controller = DriversLicenseController::new(reader.clone());
        reader.push_response(&[0x90, 0x00]);

        let res = controller.select_dl_ap().await;
        assert!(res.is_ok());

        let apdus = reader.sent_apdus.lock().unwrap();
        assert_eq!(apdus.len(), 1);
        assert_eq!(&apdus[0][5..], &file_ids::DF_DL[..]);
    }

    #[tokio::test]
    async fn test_read_common_data_parsing() {
        let reader = TestReader::new();
        let mut controller = DriversLicenseController::new(reader.clone());
        
        // Mock responses for read_common_data:
        // 1. select EF01
        reader.push_response(&[0x90, 0x00]);
        // 2. read binary
        // Tag 0x11: "外務 太郎" in Shift-JIS: 8a 4f 96 b1 20 91 be 98 59
        let name_bytes = [0x8a, 0x4f, 0x96, 0xb1, 0x20, 0x91, 0xbe, 0x98, 0x59];
        let mut mock_data = vec![0x11, name_bytes.len() as u8];
        mock_data.extend_from_slice(&name_bytes);
            
        // Tag 0x13: DOB (19800101)
        mock_data.extend_from_slice(&[0x13, 8, b'1', b'9', b'8', b'0', b'0', b'1', b'0', b'1']);
        // Tag 0x17: License No
        mock_data.extend_from_slice(&[0x17, 12, b'1', b'2', b'3', b'4', b'5', b'6', b'7', b'8', b'9', b'0', b'1', b'2']);
        // Tag 0x1A: Color "優良" (Shift-JIS: 97 44 97 C7)
        mock_data.extend_from_slice(&[0x1A, 4, 0x97, 0x44, 0x97, 0xC7]);
        // Tag 0x1C: Condition "眼鏡等" (Shift-JIS: 8a e1 8b be 93 99)
        mock_data.extend_from_slice(&[0x1C, 6, 0x8a, 0xe1, 0x8b, 0xbe, 0x93, 0x99]);

        mock_data.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&mock_data);

        let res = controller.read_common_data().await;
        assert!(res.is_ok());
        let info = res.unwrap();
        
        assert_eq!(info.name, "外務 太郎");
        assert_eq!(info.color_class, "優良");
        assert_eq!(info.conditions.len(), 1);
        assert_eq!(info.conditions[0], "眼鏡等");
    }

    #[tokio::test]
    async fn test_read_photo() {
        let reader = TestReader::new();
        let mut controller = DriversLicenseController::new(reader.clone());

        // 1. Select DF2
        reader.push_response(&[0x90, 0x00]);
        // 2. Select EF01 (Photo)
        reader.push_response(&[0x90, 0x00]);
        // 3. Read Binary (Mock JPEG2000 data wrapped in TLV 5F40)
        // Tag 5F 40 is 2 bytes. Our parser handles it if it's just bytes. 
        // Mocking a simple byte sequence containing FF 4F (SOC)
        let mut mock_photo = vec![0x5F, 0x40, 0x05, 0xFF, 0x4F, 0xFF, 0x51, 0x00];
        mock_photo.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&mock_photo);

        let res = controller.read_photo().await;
        assert!(res.is_ok());
        let photo = res.unwrap();
        // The simplistic logic in read_photo might try TLV first. 
        // If it fails TLV (because 5F 40 is split), it falls back to finding FF 4F.
        // Let's verify it extracted the JPEG2000 data starting with FF 4F.
        assert_eq!(photo[0], 0xFF);
        assert_eq!(photo[1], 0x4F);
    }

    #[tokio::test]
    async fn test_verify_pin_error() {
        let reader = TestReader::new();
        let mut controller = DriversLicenseController::new(reader.clone());
        // Mock 63 C2 (Auth Failed)
        reader.push_response(&[0x63, 0xC2]);

        let res = controller.verify_pin("0000").await;
        // SW 63 C2 should be caught by check_sw and return Err
        assert!(res.is_err());
    }
}