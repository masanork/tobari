use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY};
use crate::reader::CardReader;
use anyhow::{Result, Context};

/// Passport (ePassport/ICAO 9303) Application Controller
pub struct PassportController<R: CardReader> {
    reader: R,
    secure_session: Option<crate::crypto::bac::BacSession>,
}

pub mod file_ids {
    /// ICAO 9303 Applet AID
    /// A0 00 00 02 47 10 01
    pub const DF_ICAO: [u8; 7] = [0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01];

    /// EF.COM (Common Data)
    pub const EF_COM: [u8; 2] = [0x01, 0x1E];
    /// EF.DG1 (MRZ)
    pub const EF_DG1: [u8; 2] = [0x01, 0x01];
    /// EF.DG2 (Photo)
    pub const EF_DG2: [u8; 2] = [0x01, 0x02];
    /// EF.DG11 (Additional Personal Details - Address, etc.)
    pub const EF_DG11: [u8; 2] = [0x01, 0x0B];
    /// EF.DG12 (Additional Document Details)
    pub const EF_DG12: [u8; 2] = [0x01, 0x0C];
    /// EF.SOD (Security Object Document - Signed hashes of all DGs)
    pub const EF_SOD: [u8; 2] = [0x01, 0x1D];
}

impl<R: CardReader> PassportController<R> {
    pub fn new(reader: R) -> Self {
        Self { reader, secure_session: None }
    }

    /// Select the ePassport Application
    pub async fn select_ep_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(&file_ids::DF_ICAO);
        
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res).context("Failed to select Link ePassport AP")
    }

    /// Perform Basic Access Control (BAC)
    /// Establishes Secure Messaging and stores the session for subsequent APDUs.
    pub async fn perform_bac(&mut self, mrz: &str) -> Result<()> {
        use crate::crypto::bac;

        // 1. Derive Keys from MRZ
        // Note: The caller must provide the correct string concatenation of MRZ fields.
        // For PoC CLI, we assume 'mrz' passed is already cleaned/formatted or we simple-hash it directly.
        // In product, parsing logic is needed.
        let k_seed = bac::derive_key_seed(mrz);
        let (k_enc, k_mac) = bac::derive_session_keys(&k_seed);

        println!("[BAC] Derived K_enc: {}", hex::encode(k_enc));
        println!("[BAC] Derived K_mac: {}", hex::encode(k_mac));
        
        // 2. Request Challenge (GET CHALLENGE)
        use crate::apdu::{CLA_ISO, INS_GET_CHALLENGE};
        let get_challenge = ApduCommand::new(CLA_ISO, INS_GET_CHALLENGE, 0x00, 0x00)
            .with_le(0x08); // 8 bytes random
        
        // Note: Without a real card, this might fail or return mock data.
        let rnd_ic_response = self.reader.transmit(&get_challenge.to_bytes()).await
            .context("GET CHALLENGE failed")?;
        if rnd_ic_response.len() < 10 {
            return Err(anyhow::anyhow!("GET CHALLENGE response too short"));
        }
        Self::check_sw(&rnd_ic_response)?;
        let rnd_ic = &rnd_ic_response[0..8];
        println!("[BAC] Card Challenge: {}", hex::encode(rnd_ic));

        let rnd_ic: [u8; 8] = rnd_ic.try_into()
            .map_err(|_| anyhow::anyhow!("Invalid RND.ICC"))?;
        let (auth_data, ssc) = bac::build_mutual_auth_data(&k_enc, &k_mac, &rnd_ic)?;
        use crate::apdu::INS_EXTERNAL_AUTHENTICATE;
        let external_auth = ApduCommand::new(CLA_ISO, INS_EXTERNAL_AUTHENTICATE, 0x00, 0x00)
            .with_data(&auth_data);
        let response = self.reader.transmit(&external_auth.to_bytes()).await?;
        Self::check_sw(&response).context("Mutual authentication failed")?;

        self.secure_session = Some(bac::BacSession::new(k_enc, k_mac, ssc));
        println!("[BAC] Secure Messaging session established.");
        Ok(())
    }

    /// Read EF.COM
    pub async fn read_common_data(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_COM).await
    }

    /// Read EF.DG1 (MRZ) - Requires BAC/PACE in reality
    pub async fn read_dg1(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_DG1).await
    }

    /// Read EF.DG2 (Encoded Face)
    pub async fn read_dg2(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_DG2).await
    }

    /// Read EF.DG11 (Additional Personal Details)
    pub async fn read_dg11(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_DG11).await
    }

    /// Read EF.DG12 (Additional Document Details)
    pub async fn read_dg12(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_DG12).await
    }

    /// Read EF.SOD (Security Object Document)
    /// Contains signed hashes of all data groups for authenticity verification
    pub async fn read_sod(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_SOD).await
    }

    // Helper to Select EF and Read Binary
    pub(crate) async fn read_file(&mut self, file_id: &[u8]) -> Result<Vec<u8>> {
        // 1. Select File
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(file_id);
        let res_sel = self.transmit(&select).await?;
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
            
            let res = self.transmit(&read).await?;
            
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

            if offset > 32768 { // Safety Limit
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

    async fn transmit(&mut self, apdu: &ApduCommand) -> Result<Vec<u8>> {
        if let Some(session) = self.secure_session.as_mut() {
            let wrapped = session.wrap_command(apdu)?;
            let response = self.reader.transmit(&wrapped).await?;
            let (data, sw1, sw2) = session.unwrap_response(&response)?;
            let mut out = data;
            out.push(sw1);
            out.push(sw2);
            Ok(out)
        } else {
            self.reader.transmit(&apdu.to_bytes()).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestReader;

    #[tokio::test]
    async fn test_select_ep_ap() {
        let reader = TestReader::new();
        let mut controller = PassportController::new(reader.clone());
        reader.push_response(&[0x90, 0x00]);

        let res = controller.select_ep_ap().await;
        assert!(res.is_ok());

        let apdus = reader.sent_apdus.lock().unwrap();
        assert_eq!(apdus[0][1], 0xA4);
        assert_eq!(&apdus[0][5..], &file_ids::DF_ICAO);
    }

    #[tokio::test]
    async fn test_read_dg1_multi_block() {
        let reader = TestReader::new();
        let mut controller = PassportController::new(reader.clone());
        
        // 1. Select success
        reader.push_response(&[0x90, 0x00]);
        // 2. First block (256 bytes)
        let mut block1 = vec![0xAA; 256];
        block1.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&block1);
        // 3. Second block (10 bytes)
        let mut block2 = vec![0xBB; 10];
        block2.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&block2);

        let res = controller.read_dg1().await;
        assert!(res.is_ok());
        let data = res.unwrap();
        assert_eq!(data.len(), 266);
        assert_eq!(data[0], 0xAA);
        assert_eq!(data[256], 0xBB);

        let apdus = reader.sent_apdus.lock().unwrap();
        assert_eq!(apdus.len(), 3); // Select + Read1 + Read2
        // Check offset in Read2 (P1 P2)
        assert_eq!(apdus[2][2], 0x01); // 256 >> 8 = 1
        assert_eq!(apdus[2][3], 0x00); // 256 & FF = 0
    }
}
