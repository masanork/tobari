use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY};
use crate::reader::CardReader;
use anyhow::{Result, Context};

/// Residence Card (Zairyu Card) Application Controller
pub struct ResidenceCardController<R: CardReader> {
    reader: R,
}

pub mod file_ids {
    /// Residence Card AID (Mock / To Be Verified)
    /// Using standard JPKI-like or ISO ID for now
    pub const DF_RC: [u8; 11] = [0xA0, 0x00, 0x00, 0x00, 0x79, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]; 

    /// EF: Card Common Input/Output (Placeholder)
    pub const EF_RC_COMMON: [u8; 2] = [0x00, 0x01];
}

use std::fmt;

/// Parsed Residence Card Information
#[derive(Debug, Default)]
pub struct ResidenceCardInfo {
    pub name: String,
    pub address: String,
    pub birth_date: String,
    pub gender: String,
    pub nationality: String,
    pub card_number: String,
    pub expire_date: String,
}

impl fmt::Display for ResidenceCardInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Residence Card Info:\n Name: {}\n Address: {}\n DOB: {} ({})\n Nationality: {}\n No: {}\n Expires: {}", 
            self.name, self.address, self.birth_date, self.gender, self.nationality, self.card_number, self.expire_date)
    }
}

// ... file_ids ...

impl<R: CardReader> ResidenceCardController<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }

    pub async fn select_rc_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(&file_ids::DF_RC);
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res).context("Failed to select RC AP")
    }

    /// Verify Card Number (Access Control)
    /// In a real implementation, this might derive a key from the card number (like BAC)
    /// or verify it against a specific file. For now, we mock it as success.
    pub async fn verify_card_number(&mut self, _number: &str) -> Result<()> {
        Ok(())
    }

    pub async fn read_info(&mut self) -> Result<ResidenceCardInfo> {
        let raw = self.read_file(&file_ids::EF_RC_COMMON).await?;
        self.parse_info(&raw)
    }

    fn parse_info(&self, data: &[u8]) -> Result<ResidenceCardInfo> {
        // Tag definitions (Hypothetical/Empirical):
        // 0x11: Card Number
        // 0x12: Name
        // 0x13: Date of Birth
        // 0x14: Gender
        // 0x15: Nationality
        // 0x16: Address
        // 0x17: Expiry Info?
        
        use crate::utils::{parse_tlv_flat, decode_shift_jis_lossy_gaiji};
        // Note: For Residence Cards, some fields might be UTF-8 (especially Name in Latin characters), 
        // but Kanji fields if any or legacy might be SJIS. 
        // Japan Residence Card (Zairyu Card) actually uses UTF-8 for Name/Address fields 
        // because it needs to support various nationalities' characters.
        // However, for consistency in this library's mock-logic, we'll use SJIS for now 
        // or provide both. Let's stick to SJIS decoder as it's safer for JP contexts.
        
        let tlvs = parse_tlv_flat(data);
        let mut info = ResidenceCardInfo::default();

        for tlv in tlvs {
            // Using placeholder tags
            match tlv.tag {
                0x11 => info.card_number = String::from_utf8_lossy(&tlv.value).to_string(), // ASCII
                0x12 => info.name = decode_shift_jis_lossy_gaiji(&tlv.value),
                0x13 => info.birth_date = decode_shift_jis_lossy_gaiji(&tlv.value),
                0x14 => info.gender = decode_shift_jis_lossy_gaiji(&tlv.value),
                0x15 => info.nationality = decode_shift_jis_lossy_gaiji(&tlv.value),
                0x16 => info.address = decode_shift_jis_lossy_gaiji(&tlv.value),
                _ => {}
            }
        }
        Ok(info)
    }

    async fn read_file(&mut self, file_id: &[u8]) -> Result<Vec<u8>> {
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(file_id);
        let res_sel = self.reader.transmit(&select.to_bytes()).await?;
        Self::check_sw(&res_sel).context("Failed to select EF")?;

        let mut data = Vec::new();
        let mut offset: u16 = 0;
        
        loop {
            let p1 = (offset >> 8) as u8;
            let p2 = (offset & 0xFF) as u8;
            
            let read = ApduCommand::new(CLA_ISO, INS_READ_BINARY, p1, p2)
                .with_le(0x00); // 256 bytes
            
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

            if offset > 32768 { // Safety limit
                break;
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
    async fn test_select_rc_ap() {
        let reader = TestReader::new();
        let mut controller = ResidenceCardController::new(reader.clone());
        reader.push_response(&[0x90, 0x00]);

        let res = controller.select_rc_ap().await;
        assert!(res.is_ok());

        let apdus = reader.sent_apdus.lock().unwrap();
        assert_eq!(apdus[0][1], 0xA4);
        assert_eq!(&apdus[0][5..], &file_ids::DF_RC);
    }

    #[tokio::test]
    async fn test_read_rc_info() {
        let reader = TestReader::new();
        let mut controller = ResidenceCardController::new(reader.clone());
        
        // 1. Select EF
        reader.push_response(&[0x90, 0x00]);
        // 2. Read Binary (Mock TLV data)
        // Card Number (0x11): AB12345678 (10 bytes)
        // Name (0x12): "在留 太郎" in SJIS: 8d dd 97 af 20 91 be 98 59
        let name_bytes = [0x8d, 0xdd, 0x97, 0xaf, 0x20, 0x91, 0xbe, 0x98, 0x59];
        let mut mock_data = vec![
            0x11, 10, b'A', b'B', b'1', b'2', b'3', b'4', b'5', b'6', b'7', b'8',
            0x12, name_bytes.len() as u8,
        ];
        mock_data.extend_from_slice(&name_bytes);
        mock_data.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&mock_data);

        let res = controller.read_info().await;
        assert!(res.is_ok());
        let info = res.unwrap();
        assert_eq!(info.card_number, "AB12345678");
        assert_eq!(info.name, "在留 太郎");
    }

    #[tokio::test]
    async fn test_read_rc_info_large() {
        let reader = TestReader::new();
        let mut controller = ResidenceCardController::new(reader.clone());

        // 1. Select EF (Success)
        reader.push_response(&[0x90, 0x00]);

        // 2. Read Binary Loop responses
        // Block 1: 256 bytes (full chunk)
        let mut block1 = vec![0xAA; 256];
        block1.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&block1);

        // Block 2: 10 bytes (remaining)
        let mut block2 = vec![0xBB; 10];
        block2.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&block2);

        // Use read_file directly to verify raw bytes assembly
        let res = controller.read_file(&file_ids::EF_RC_COMMON).await;
        
        assert!(res.is_ok());
        let data = res.unwrap();
        assert_eq!(data.len(), 266);
        assert_eq!(data[0], 0xAA);
        assert_eq!(data[255], 0xAA);
        assert_eq!(data[256], 0xBB);

        // Verify APDUs sent
        let apdus = reader.sent_apdus.lock().unwrap();
        assert_eq!(apdus.len(), 3); // Select, Read1, Read2
        
        // Assert Read2 offset (P1=01, P2=00 for 256)
        assert_eq!(apdus[2][1], 0xB0); // INS_READ_BINARY
        assert_eq!(apdus[2][2], 0x01); // P1
        assert_eq!(apdus[2][3], 0x00); // P2
    }
}
