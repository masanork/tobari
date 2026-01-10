use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY};
use crate::reader::CardReader;
use crate::errors::{Result, CivError};
use crate::models::{CitizenIdentity, IdentityController};
use encoding_rs::WINDOWS_874; // Thai (TIS-620 equivalent)

/// Thai National ID Card Controller
pub struct ThaiController<R: CardReader> {
    reader: R,
}

pub mod file_ids {
    /// Thai ID Application AID
    pub const DF_THAI: [u8; 8] = [0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01];
}

impl<R: CardReader> ThaiController<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }

    /// Select Thai ID Application
    pub async fn select_thai_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x00)
            .with_data(&file_ids::DF_THAI);
        
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    /// Read Data from fixed offset
    /// Thai ID uses CLA=0x80 for reading.
    /// Offset is P1/P2.
    pub async fn read_data(&mut self, offset: u16, len: usize) -> Result<Vec<u8>> {
        // According to specs, some cards expect: 80 B0 P1 P2 02 00 Le
        // Let's try the more common 80 B0 P1 P2 Le first.
        let apdu = ApduCommand::new(0x80, INS_READ_BINARY, (offset >> 8) as u8, (offset & 0xFF) as u8)
            .with_le(len);
        
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)?;
        
        if res.len() < len + 2 {
             // Try the alternative format if response too short
             let cmd_bytes = vec![0x80, 0xB0, (offset >> 8) as u8, (offset & 0xFF) as u8, 0x02, 0x00, len as u8];
             let res2 = self.reader.transmit(&cmd_bytes).await?;
             Self::check_sw(&res2)?;
             return Ok(res2[0..res2.len()-2].to_vec());
        }

        Ok(res[0..res.len()-2].to_vec())
    }

    fn decode_thai(&self, data: &[u8]) -> String {
        let (cow, _, _) = WINDOWS_874.decode(data);
        cow.trim().trim_matches(char::from(0)).to_string()
    }

    fn check_sw(res: &[u8]) -> Result<()> {
        if res.len() < 2 { return Err(CivError::Communication("Response too short".to_string())); }
        let sw1 = res[res.len()-2];
        let sw2 = res[res.len()-1];
        if sw1 == 0x90 && sw2 == 0x00 { Ok(()) }
        else { Err(CivError::from_sw(sw1, sw2)) }
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
impl<R: CardReader> IdentityController for ThaiController<R> {
    async fn provide_pin(&mut self, _pin_type: &str, _pin: &str) -> Result<()> {
        Ok(()) // No PIN required for basic info
    }

    async fn verify(&mut self) -> Result<bool> {
        Ok(true) // No PA implemented yet
    }

    async fn read_identity(&mut self) -> Result<CitizenIdentity> {
        self.select_thai_ap().await?;

        // CID (Offset 0004, Len 13)
        let cid_bytes = self.read_data(0x0004, 13).await?;
        let identity_number = String::from_utf8_lossy(&cid_bytes).to_string();

        // Name Thai (Offset 0011, Len 100)
        let name_thai = self.read_data(0x0011, 100).await?;
        let full_name = self.decode_thai(&name_thai);

        // Name En (Offset 0075, Len 100)
        let name_en = self.read_data(0x0075, 100).await?;
        let full_name_en = String::from_utf8_lossy(&name_en).trim().trim_matches(char::from(0)).to_string();

        // DOB (Offset 00D9, Len 8)
        let dob_bytes = self.read_data(0x00D9, 8).await?;
        let dob_raw = String::from_utf8_lossy(&dob_bytes).to_string();
        // Thai DOB is often Buddhist Era (BE = AD + 543)
        // Format: YYYYMMDD
        let birth_date = if dob_raw.len() == 8 {
            let be_year: u32 = dob_raw[0..4].parse().unwrap_or(0);
            if be_year > 2000 {
                format!("{:04}-{}-{}", be_year - 543, &dob_raw[4..6], &dob_raw[6..8])
            } else {
                format!("{}-{}-{}", &dob_raw[0..4], &dob_raw[4..6], &dob_raw[6..8])
            }
        } else {
            dob_raw
        };

        // Gender (Offset 00E1, Len 1)
        let gender_byte = self.read_data(0x00E1, 1).await?;
        let gender = match gender_byte.get(0) {
            Some(b'1') => "1".to_string(), // Male
            Some(b'2') => "2".to_string(), // Female
            _ => "9".to_string(),
        };

        let mut attributes = std::collections::HashMap::new();
        attributes.insert("full_name_en".to_string(), full_name_en);

        Ok(CitizenIdentity {
            full_name,
            surname: None,
            given_names: None,
            full_name_kana: None,
            address: None, // Address is at 1579
            birth_date,
            gender,
            identity_number,
            card_type: "ThaiID".to_string(),
            issuing_authority: Some("THA".to_string()),
            expiration_date: None,
            photo_data: None,
            verified: false,
            attributes,
        })
    }
}
