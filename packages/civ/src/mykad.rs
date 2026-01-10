use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE};
use crate::reader::CardReader;
use crate::errors::{Result, CivError};
use crate::models::{CitizenIdentity, IdentityController};
use std::collections::HashMap;

/// Malaysia MyKad Controller
pub struct MyKadController<R: CardReader> {
    reader: R,
}

pub mod file_ids {
    /// JPN (Identity) Application AID
    pub const DF_JPN: [u8; 10] = [0xA0, 0x00, 0x00, 0x00, 0x74, 0x4A, 0x50, 0x4E, 0x00, 0x10];
}

impl<R: CardReader> MyKadController<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }

    /// Select JPN Application
    pub async fn select_jpn_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x00)
            .with_data(&file_ids::DF_JPN);
        
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    /// Read info from JPN App
    /// Flow:
    /// 1. SET LENGTH (C1)
    /// 2. SELECT INFO (A1)
    /// 3. READ INFO (B1)
    pub async fn read_info(&mut self, file_id: u16, offset: u16, len: u8) -> Result<Vec<u8>> {
        // 1. SET LENGTH (C1 00 00 Len)
        // Note: Some sources say Len is Lc, some say Data.
        // Assuming Data: [Len]
        let set_len = ApduCommand::new(0x80, 0xC1, 0x00, 0x00).with_data(&[len]);
        let res1 = self.reader.transmit(&set_len.to_bytes()).await?;
        Self::check_sw(&res1)?;

        // 2. SELECT INFO (A1 00 00 [FileID_H, FileID_L, Offset_H, Offset_L])
        let sel_data = [
            (file_id >> 8) as u8, (file_id & 0xFF) as u8,
            (offset >> 8) as u8, (offset & 0xFF) as u8
        ];
        let sel_info = ApduCommand::new(0x80, 0xA1, 0x00, 0x00).with_data(&sel_data);
        let res2 = self.reader.transmit(&sel_info.to_bytes()).await?;
        Self::check_sw(&res2)?;

        // 3. READ INFO (B1 00 00 Le)
        let read_info = ApduCommand::new(0x80, 0xB1, 0x00, 0x00).with_le(len as usize);
        let res3 = self.reader.transmit(&read_info.to_bytes()).await?;
        Self::check_sw(&res3)?;

        Ok(res3[0..res3.len()-2].to_vec())
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
impl<R: CardReader> IdentityController for MyKadController<R> {
    async fn provide_pin(&mut self, _pin_type: &str, _pin: &str) -> Result<()> {
        Ok(())
    }

    async fn verify(&mut self) -> Result<bool> {
        Ok(true)
    }

    async fn read_identity(&mut self) -> Result<CitizenIdentity> {
        self.select_jpn_ap().await?;

        // IC Number: File 0111, Offset 001A, Len 13
        let ic_bytes = self.read_info(0x0111, 0x001A, 13).await?;
        let identity_number = String::from_utf8_lossy(&ic_bytes).trim().to_string();

        // Name: File 0111, Offset 00E9, Len 40
        let name_bytes = self.read_info(0x0111, 0x00E9, 40).await?;
        let full_name = String::from_utf8_lossy(&name_bytes).trim().to_string();

        // Gender: File 0111, Offset 011C, Len 1
        let gender_bytes = self.read_info(0x0111, 0x011C, 1).await?;
        let gender = match gender_bytes.first() {
            Some(b'M') => "Male".to_string(),
            Some(b'F') => "Female".to_string(),
            _ => "Unspecified".to_string(),
        };

        // Address: File 0111, Offset 0203, Len 30 (Line 1)
        // Usually there are multiple lines. Let's read Line 1 for simplicity.
        let addr_bytes = self.read_info(0x0111, 0x0203, 30).await?;
        let address = Some(String::from_utf8_lossy(&addr_bytes).trim().to_string());

        // DOB is usually encoded in the IC number (YYMMDD-SS-####)
        // First 6 digits of IC Number
        let birth_date = if identity_number.len() >= 6 {
            let yy = &identity_number[0..2];
            let mm = &identity_number[2..4];
            let dd = &identity_number[4..6];
            // Heuristic for century (MyKad started 2001, but ID refers to birth)
            // Assuming < 30 is 20xx? Or check local rules.
            // Let's assume standard 1900-2099 pivot.
            let y_int: i32 = yy.parse().unwrap_or(0);
            let prefix = if y_int > 40 { "19" } else { "20" }; // Rough pivot
            format!("{}{}-{}-{}", prefix, yy, mm, dd)
        } else {
            "".to_string()
        };

        Ok(CitizenIdentity {
            full_name,
            surname: None,
            given_names: None,
            full_name_kana: None,
            address,
            birth_date,
            gender,
            identity_number,
            card_type: "MyKad".to_string(),
            issuing_authority: Some("MYS".to_string()),
            expiration_date: None,
            photo_data: None, // Requires Extended APDU chaining usually, skipped for now
            verified: false,
            attributes: HashMap::new(),
        })
    }
}
