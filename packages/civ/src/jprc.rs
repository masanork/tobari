use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY};
use crate::reader::CardReader;
use anyhow::{Result, Context};
use std::fmt;

/// Residence Card (Zairyu Card) Application Controller
pub struct ResidenceCardController<R: CardReader> {
    reader: R,
}

pub mod file_ids {
    // DF1 (Visual Info)
    pub const DF1: [u8; 16] = [
        0xD3, 0x92, 0xF0, 0x00, 0x4F, 0x02, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ];
    pub const EF_FRONT_IMAGE: [u8; 2] = [0x00, 0x01]; // DF1/EF01: Front Image (Tag D0)
    pub const EF_PHOTO: [u8; 2] = [0x00, 0x02];       // DF1/EF02: Photo (Tag D1)

    // DF2 (Address / Back Side)
    pub const DF2: [u8; 16] = [
        0xD3, 0x92, 0xF0, 0x00, 0x4F, 0x03, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ];
    pub const EF_ADDRESS: [u8; 2] = [0x00, 0x01];       // DF2/EF01: Address (Tag D2-D4)
    pub const EF_PERMIT_GLOBAL: [u8; 2] = [0x00, 0x02]; // DF2/EF02: Global Permit (Tag D5)
    pub const EF_PERMIT_INDIV: [u8; 2] = [0x00, 0x03];  // DF2/EF03: Indiv Permit (Tag D6)
    pub const EF_UPDATE_STATUS: [u8; 2] = [0x00, 0x04]; // DF2/EF04: Status (Tag D7)

    // DF3 (Signature)
    pub const DF3: [u8; 16] = [
        0xD3, 0x92, 0xF0, 0x00, 0x4F, 0x04, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ];
    pub const EF_SIGNATURE: [u8; 2] = [0x00, 0x01];     // DF3/EF01: Sig (Tag DA, DB)
}

/// Parsed Residence Card Information
#[derive(Debug, Default)]
pub struct ResidenceCardInfo {
    pub address: String,
    pub date_updated: String,
    pub permit_global: String,
    pub permit_indiv: String,
    pub update_status: String,
}

impl fmt::Display for ResidenceCardInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Residence Card Info:\n Address: {}\n Updated: {}\n Permit(G): {}\n Permit(I): {}\n Status: {}", 
            self.address, self.date_updated, self.permit_global, self.permit_indiv, self.update_status)
    }
}

impl<R: CardReader> ResidenceCardController<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }

    pub async fn select_df1(&mut self) -> Result<()> {
        self.select_df(&file_ids::DF1).await
    }

    pub async fn select_df2(&mut self) -> Result<()> {
        self.select_df(&file_ids::DF2).await
    }

    pub async fn select_df3(&mut self) -> Result<()> {
        self.select_df(&file_ids::DF3).await
    }

    async fn select_df(&mut self, df: &[u8]) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(df);
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res).context("Failed to select DF")
    }

    /// Read Back Side Info (Address, Permits, Status) from DF2
    /// Requires Auth (usually).
    pub async fn read_df2_info(&mut self) -> Result<ResidenceCardInfo> {
        // Assume DF2 selected or Select it
        self.select_df2().await?;
        
        let mut info = ResidenceCardInfo::default();

        // EF01: Address
        if let Ok(raw) = self.read_file(&file_ids::EF_ADDRESS).await {
             self.parse_address(&raw, &mut info);
        }
        
        // EF02: Permit Global
        if let Ok(raw) = self.read_file(&file_ids::EF_PERMIT_GLOBAL).await {
             self.parse_utf8_tag(&raw, 0xD5, &mut info.permit_global);
        }

        // EF03: Permit Indiv
        if let Ok(raw) = self.read_file(&file_ids::EF_PERMIT_INDIV).await {
             self.parse_utf8_tag(&raw, 0xD6, &mut info.permit_indiv);
        }

        // EF04: Update Status
        if let Ok(raw) = self.read_file(&file_ids::EF_UPDATE_STATUS).await {
             // Tag D7, 1 byte char
             use crate::utils::parse_ber_tlv;
             let tlvs = parse_ber_tlv(&raw);
             for tlv in tlvs {
                 if tlv.tag == 0xD7 {
                     info.update_status = tlv.as_utf8(); // Usually "0" or "1"
                 }
             }
        }

        Ok(info)
    }

    fn parse_address(&self, data: &[u8], info: &mut ResidenceCardInfo) {
        use crate::utils::parse_ber_tlv;
        let tlvs = parse_ber_tlv(data);
        for tlv in tlvs {
            match tlv.tag {
                0xD2 => info.date_updated = tlv.as_utf8(),
                // D3 is code, D4 is address
                0xD4 => info.address = tlv.as_utf8(),
                _ => {}
            }
        }
    }

    fn parse_utf8_tag(&self, data: &[u8], target_tag: u32, out: &mut String) {
        use crate::utils::parse_ber_tlv;
        let tlvs = parse_ber_tlv(data);
        for tlv in tlvs {
            if tlv.tag == target_tag {
                *out = tlv.as_utf8();
            }
        }
    }

    /// Read Photo (DF1/EF02)
    pub async fn read_photo(&mut self) -> Result<Vec<u8>> {
        self.select_df1().await?;
        let raw = self.read_file(&file_ids::EF_PHOTO).await?;
        // Parse Tag D1
        use crate::utils::parse_ber_tlv;
        let tlvs = parse_ber_tlv(&raw);
        for tlv in tlvs {
            if tlv.tag == 0xD1 {
                return Ok(tlv.value.to_vec());
            }
        }
        Ok(Vec::new())
    }

    /// Verify PIN (if needed, Card ID Auth logic is separate usually)
    pub async fn verify_key(&mut self, _key: &str) -> Result<()> {
        // Placeholder for Mutual Auth / VERIFY
        Ok(())
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
    async fn test_select_rc_ap() {
        let reader = TestReader::new();
        let mut controller = ResidenceCardController::new(reader.clone());
        reader.push_response(&[0x90, 0x00]); // Select DF2

        let res = controller.select_df2().await;
        assert!(res.is_ok());

        let apdus = reader.sent_apdus.lock().unwrap();
        assert_eq!(apdus[0][1], 0xA4);
        assert_eq!(&apdus[0][5..], &file_ids::DF2);
    }

    #[tokio::test]
    async fn test_read_df2_info() {
        let reader = TestReader::new();
        let mut controller = ResidenceCardController::new(reader.clone());
        
        // 1. Select DF2
        reader.push_response(&[0x90, 0x00]);
        
        // 2. Select EF_ADDRESS
        reader.push_response(&[0x90, 0x00]);
        // 3. Read Address (Tag D4)
        // "東京都" (E6 9D B1 E4 BA AC)
        let addr_bytes = "東京都".as_bytes();
        let mut mock_addr = vec![0xD4, addr_bytes.len() as u8];
        mock_addr.extend_from_slice(addr_bytes);
        mock_addr.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&mock_addr);

        // 4. Select EF_PERMIT_GLOBAL
        reader.push_response(&[0x90, 0x00]);
        // 5. Read Permit (Tag D5)
        // "許可"
        let perm_bytes = "許可".as_bytes();
        let mut mock_perm = vec![0xD5, perm_bytes.len() as u8];
        mock_perm.extend_from_slice(perm_bytes);
        mock_perm.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&mock_perm);

        // 6. Select EF_PERMIT_INDIV (Fail/Empty)
        reader.push_response(&[0x90, 0x00]);
        reader.push_response(&[0x90, 0x00]); // Empty + OK

        // 7. Select EF_UPDATE_STATUS
        reader.push_response(&[0x90, 0x00]);
        // 8. Read Status (Tag D7) -> "0" (None)
        let mut mock_status = vec![0xD7, 0x01, b'0'];
        mock_status.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&mock_status);

        let res = controller.read_df2_info().await;
        assert!(res.is_ok());
        let info = res.unwrap();
        
        assert_eq!(info.address, "東京都");
        assert_eq!(info.permit_global, "許可");
        assert_eq!(info.update_status, "0");
    }
}
