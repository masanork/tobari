use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY, INS_GET_CHALLENGE, INS_EXTERNAL_AUTHENTICATE};
use crate::reader::CardReader;
use crate::crypto::bac::BacSession;
use crate::crypto::sm::{AesSecureMessaging, SecureMessagingSession};
use crate::crypto::pace::{PaceP256, PaceMappingType};
use anyhow::{Result, Context, anyhow};

/// Secure Session Wrapper (BAC or PACE)
pub enum SecureSession {
    Bac(BacSession),
    Pace(AesSecureMessaging),
}

impl SecureSession {
    pub fn wrap_command(&mut self, apdu: &ApduCommand) -> Result<Vec<u8>> {
        match self {
            SecureSession::Bac(s) => s.wrap_command(apdu),
            SecureSession::Pace(s) => s.wrap_command(apdu),
        }
    }

    pub fn unwrap_response(&mut self, data: &[u8]) -> Result<(Vec<u8>, u8, u8)> {
        match self {
            SecureSession::Bac(s) => s.unwrap_response(data),
            SecureSession::Pace(s) => s.unwrap_response(data),
        }
    }
}

/// Passport (ePassport/ICAO 9303) Application Controller
pub struct PassportController<R: CardReader> {
    reader: R,
    secure_session: Option<SecureSession>,
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
    /// EF.DG15 (Active Authentication Public Key Info)
    pub const EF_DG15: [u8; 2] = [0x01, 0x0F];
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
        let k_seed = bac::derive_key_seed(mrz);
        let (k_enc, k_mac) = bac::derive_session_keys(&k_seed);

        println!("[BAC] Derived K_enc: {}", hex::encode(k_enc));
        println!("[BAC] Derived K_mac: {}", hex::encode(k_mac));
        
        // 2. Request Challenge (GET CHALLENGE)
        let get_challenge = ApduCommand::new(CLA_ISO, INS_GET_CHALLENGE, 0x00, 0x00)
            .with_le(0x08); 
        
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
        let external_auth = ApduCommand::new(CLA_ISO, INS_EXTERNAL_AUTHENTICATE, 0x00, 0x00)
            .with_data(&auth_data);
        let response = self.reader.transmit(&external_auth.to_bytes()).await?;
        Self::check_sw(&response).context("Mutual authentication failed")?;

        self.secure_session = Some(SecureSession::Bac(bac::BacSession::new(k_enc, k_mac, ssc)));
        println!("[BAC] Secure Messaging session established.");
        Ok(())
    }

    /// Perform PACE (Password Authenticated Connection Establishment)
    /// mrz_or_can: MRZ (Legacy) or CAN (Card Access Number)
    pub async fn perform_pace(&mut self, mrz_or_can: &str) -> Result<()> {
        println!("[PACE] Starting PACE with password: {}", mrz_or_can);

        // 1. MSE: SET (Manage Security Environment)
        // Select PACE-ECDH-GM-AES-CBC-CMAC-128
        // OID: 0.4.0.127.0.7.2.2.4.2.2 (bsi-de-protocol-pace-gm-aes-cbc-cmac-128)
        let oid_pace_gm_aes = vec![
            0x06, 0x0A, 0x04, 0x00, 0x7F, 0x00, 0x07, 0x02, 0x02, 0x04, 0x02, 0x02
        ];
        
        // MSE Data: 80 [OID] 83 [Ref]
        // 83: 01 (MRZ)
        let password_ref = 0x01; 
        
        let mut mse_val = Vec::new();
        mse_val.push(0x80);
        mse_val.push(oid_pace_gm_aes.len() as u8);
        mse_val.extend_from_slice(&oid_pace_gm_aes);
        
        mse_val.push(0x83);
        mse_val.push(0x01);
        mse_val.push(password_ref);

        let mse_set = ApduCommand::new(0x00, 0x22, 0xC1, 0xA4)
            .with_data(&mse_val);
            
        let res = self.transmit(&mse_set).await?;
        Self::check_sw(&res).context("MSE: SET failed (PACE not supported?)")?;
        
        // Initialize PACE State Machine
        // key_len: 16 for AES-128. If OID selects AES-256, this should be 32.
        // For prototype we fix to AES-128 OID above.
        let mut pace = PaceP256::new(mrz_or_can, PaceMappingType::GenericMapping, 16);

        // ... (lines omitted) ...

        // 6. Establish Secure Messaging
        let session = pace.finalize_session()?;
        self.secure_session = Some(SecureSession::Pace(AesSecureMessaging::new(
            &session.k_enc, &session.k_mac, session.ssc
        )?));
        
        println!("[PACE] Secure Messaging (AES-128) established.");
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

    /// Read EF.DG11 (Additional Personal Details - Address, etc.)
    pub async fn read_dg11(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_DG11).await
    }

    /// Read EF.DG12 (Additional Document Details)
    pub async fn read_dg12(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_DG12).await
    }

    /// Read EF.DG15 (Active Authentication Public Key Info)
    pub async fn read_dg15(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_DG15).await
    }

    /// Read EF.SOD (Security Object Document)


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

// Helper functions for PACE Parsing
fn parse_pace_response(res: &[u8], target_tag: u8) -> Result<Vec<u8>> {
    // Structure: 7C L [ Tag L Value ... ] 90 00
    if res.len() < 4 || res[0] != 0x7C {
        return Err(anyhow!("Invalid PACE response format"));
    }
    // Skip 7C L
    let mut offset = 1;
    let (_len, l_len) = parse_asn1_len(res, offset)?;
    offset += l_len;
    
    // Search for target tag in DOs
    while offset < res.len() - 2 {
        let tag = res[offset];
        offset += 1;
        let (len, l_len) = parse_asn1_len(res, offset)?;
        offset += l_len;
        
        if tag == target_tag {
            return Ok(res[offset..offset+len].to_vec());
        }
        offset += len;
    }
    Err(anyhow!("Tag {:02X} not found in PACE response", target_tag))
}

fn parse_asn1_len(data: &[u8], offset: usize) -> Result<(usize, usize)> {
    if offset >= data.len() { return Err(anyhow!("Out of bounds")); }
    let b = data[offset];
    if b & 0x80 == 0 {
        Ok((b as usize, 1))
    } else {
        let count = (b & 0x7F) as usize;
        let mut len = 0;
        for i in 0..count {
            len = (len << 8) | data[offset + 1 + i] as usize;
        }
        Ok((len, 1 + count))
    }
}

fn encode_len(len: usize) -> Vec<u8> {
    if len <= 0x7F {
        vec![len as u8]
    } else if len <= 0xFF {
        vec![0x81, len as u8]
    } else {
        vec![0x82, ((len >> 8) & 0xFF) as u8, (len & 0xFF) as u8]
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
        
                #[tokio::test]
                async fn test_perform_pace_flow() {
                    use crate::mock_passport::MockPassport;
                    use std::sync::{Arc, Mutex};
            
                    let reader = TestReader::new();
                    
                    let password = "123456";
                    let mock = Arc::new(Mutex::new(MockPassport::new(password)));
                    
                    let mock_clone = mock.clone();
                    reader.set_handler(move |apdu| {
                        mock_clone.lock().unwrap().handle_apdu(apdu)
                    });
            
                    let mut controller = PassportController::new(reader.clone());
            
                    // Execute PACE
                    let res = controller.perform_pace(password).await;
                    
                    assert!(res.is_ok(), "PACE failed: {:?}", res.err());
                    
                    let apdus = reader.sent_apdus.lock().unwrap();
                    // Expected: MSE, GEN AUTH (Nonce), GEN AUTH (Map), GEN AUTH (Token)
                    assert!(apdus.len() >= 4);
                    assert_eq!(apdus[0][1], 0x22); // MSE
                    assert_eq!(apdus[1][1], 0x86); // GEN AUTH
                }
            }
            