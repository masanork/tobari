use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE};
use crate::errors::{CivError, Result};
use crate::models::{CitizenIdentity, IdentityController};
use crate::reader::CardReader;
use std::collections::HashMap;

/// Thailand National ID Card Controller
pub struct ThaiController<R: CardReader> {
    reader: R,
}

impl<R: CardReader> ThaiController<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }

    /// Select Thai ID Application
    pub async fn select_thai_ap(&mut self) -> Result<()> {
        let aid = vec![0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01];
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x00).with_data(&aid);

        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    /// Read data from Thai ID
    /// Command: 80 B0 P1 P2 Le
    pub async fn read_data(&mut self, offset: u16, len: u8) -> Result<Vec<u8>> {
        let p1 = (offset >> 8) as u8;
        let p2 = (offset & 0xFF) as u8;

        let apdu = ApduCommand::new(0x80, 0xB0, p1, p2).with_le(len as usize);

        // Thai ID cards are sometimes slow or unstable, retry once if transport error
        for retry in 0..3 {
            let res = self.reader.transmit(&apdu.to_bytes()).await;
            match res {
                Ok(data) => {
                    if Self::check_sw(&data).is_ok() {
                        return Ok(data[0..data.len() - 2].to_vec());
                    }
                    // If check_sw fails (SW error), fall through to retry
                }
                Err(_) => {
                    // Transport error, fall through to retry
                }
            }
            if retry == 2 {
                // Return original result or error
                let final_res = self
                    .reader
                    .transmit(&apdu.to_bytes())
                    .await
                    .map_err(|e| CivError::Communication(e.to_string()))?;
                Self::check_sw(&final_res)?;
                return Ok(final_res[0..final_res.len() - 2].to_vec());
            }
        }

        Err(CivError::Communication("Failed after retries".to_string()))
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

#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
impl<R: CardReader> IdentityController for ThaiController<R> {
    async fn provide_pin(&mut self, _pin_type: &str, _pin: &str) -> Result<()> {
        Ok(())
    }

    async fn verify(&mut self) -> Result<bool> {
        Ok(true)
    }

    async fn read_identity(&mut self) -> Result<CitizenIdentity> {
        self.select_thai_ap().await?;

        // CID: Offset 0x0004, Len 13
        let cid_bytes = self.read_data(0x0004, 13).await?;
        let identity_number = String::from_utf8_lossy(&cid_bytes).trim().to_string();

        // Name (TH/EN): Offset 0x0011, Len 100
        let name_bytes = self.read_data(0x0011, 100).await?;
        let full_name = String::from_utf8_lossy(&name_bytes).trim().to_string();

        // DOB (BE): Offset 0x00D1, Len 8 (YYYYMMDD)
        let dob_bytes = self.read_data(0x00D1, 8).await?;
        let dob_be = String::from_utf8_lossy(&dob_bytes).trim().to_string();

        // Convert BE YYYY to AD YYYY (BE - 543)
        let birth_date = if dob_be.len() == 8 {
            let be_year: i32 = dob_be[0..4].parse().unwrap_or(0);
            let mm = &dob_be[4..6];
            let dd = &dob_be[6..8];
            format!("{:04}-{}-{}", be_year - 543, mm, dd)
        } else {
            dob_be
        };

        // Gender: Offset 0x00E1, Len 1
        let gender_bytes = self.read_data(0x00E1, 1).await?;
        let gender = match gender_bytes.first() {
            Some(b'1') => "1".to_string(), // Male
            Some(b'2') => "2".to_string(), // Female
            _ => "9".to_string(),
        };

        // Photo: Offset 0x0100 (example, real photo is much larger and requires chaining)
        // Thai ID photo is at a different AP/offset usually.

        Ok(CitizenIdentity {
            full_name,
            surname: None,
            given_names: None,
            full_name_kana: None,
            address: None,
            birth_date,
            gender,
            identity_number,
            card_type: "ThaiID".to_string(),
            issuing_authority: Some("THA".to_string()),
            expiration_date: None,
            photo_data: None,
            verified: false,
            attributes: HashMap::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestReader;

    #[tokio::test]

    async fn test_read_identity_success() {
        let reader = TestReader::new();

        // 1. select ap

        reader.push_response(&[0x90, 0x00]);

        // 2. read cid

        let mut cid = b"1234567890123".to_vec();
        cid.extend_from_slice(&[0x90, 0x00]);

        reader.push_response(&cid);

        // 3. read name

        let mut name = vec![b'A'; 100];
        name.extend_from_slice(&[0x90, 0x00]);

        reader.push_response(&name);

        // 4. read dob

        let mut dob = b"25330101".to_vec();
        dob.extend_from_slice(&[0x90, 0x00]);

        reader.push_response(&dob);

        // 5. read gender

        reader.push_response(&[b'1', 0x90, 0x00]);

        let mut controller = ThaiController::new(reader.clone());

        let res = controller.read_identity().await.unwrap();

        assert_eq!(res.identity_number, "1234567890123");

        assert_eq!(res.birth_date, "1990-01-01");
    }
}
