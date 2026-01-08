use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY, INS_GET_CHALLENGE, INS_EXTERNAL_AUTHENTICATE, INS_INTERNAL_AUTHENTICATE};
use crate::reader::CardReader;
use crate::crypto::bac::BacSession;
use crate::crypto::sm::{AesSecureMessaging, SecureMessagingSession};
use crate::crypto::pace::{PaceP256, PaceMappingType, derive_session_keys_sha256};
use anyhow::{Result, Context, anyhow};
use p256::{PublicKey, ecdh::EphemeralSecret};
use rand_core::OsRng;
use p256::elliptic_curve::sec1::{ToEncodedPoint, FromEncodedPoint};

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
    /// EF.DG14 (Security Infos / Chip Authentication Info)
    pub const EF_DG14: [u8; 2] = [0x01, 0x0E];
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
    pub async fn perform_pace(&mut self, mrz_or_can: &str) -> Result<()> {
        println!("[PACE] Starting PACE with password: {}", mrz_or_can);

        // 1. MSE: SET (Manage Security Environment)
        let oid_pace_gm_aes = vec![
            0x06, 0x0A, 0x04, 0x00, 0x7F, 0x00, 0x07, 0x02, 0x02, 0x04, 0x02, 0x02
        ];
        
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
        let mut pace = PaceP256::new(mrz_or_can, PaceMappingType::GenericMapping, 16);

        // 2. GEN AUTH (Get Nonce)
        let gen_auth_1 = ApduCommand::new(0x10, 0x86, 0x00, 0x00)
            .with_data(&[0x7C, 0x00])
            .with_le(0x00);
            
        let res_nonce = self.transmit(&gen_auth_1).await?;
        Self::check_sw(&res_nonce).context("GEN AUTH (Nonce) failed")?;
        
        let z = parse_pace_response(&res_nonce, 0x80)?;
        pace.set_encrypted_nonce(&z);
        println!("[PACE] Step 1 done (Nonce)");
        
        // 3. Map Generator & Generate Ephemeral Key
        let my_pk = pace.perform_mapping_and_generate_key()?;
        println!("[PACE] Step 2 done (Mapping)");
        
        // 4. GEN AUTH (Map / Key Agreement)
        let mut cmd_data_2 = Vec::new();
        cmd_data_2.push(0x7C);
        let mut inner_2 = Vec::new();
        inner_2.push(0x81); // Mapping Data / Ephemeral PK
        inner_2.extend_from_slice(&encode_len(my_pk.len()));
        inner_2.extend_from_slice(&my_pk);
        cmd_data_2.extend_from_slice(&encode_len(inner_2.len()));
        cmd_data_2.extend_from_slice(&inner_2);
        
        let gen_auth_2 = ApduCommand::new(0x10, 0x86, 0x00, 0x00)
            .with_data(&cmd_data_2)
            .with_le(0x00);
            
        let res_map = self.transmit(&gen_auth_2).await?;
        Self::check_sw(&res_map).context("GEN AUTH (Key Agreement) failed")?;
        
        let peer_pk = parse_pace_response(&res_map, 0x82)?;
        pace.compute_shared_secret(&peer_pk)?;
        println!("[PACE] Step 3 done (Shared Secret)");
        
        // 5. GEN AUTH (Mutual Auth)
        let t_pcd = pace.perform_token_exchange(&[])?; 
        println!("[PACE] Step 4 done (Token generated). State should be Auth.");
        
        let mut cmd_data_3 = Vec::new();
        cmd_data_3.push(0x7C);
        let mut inner_3 = Vec::new();
        inner_3.push(0x85); // Authentication Token
        inner_3.extend_from_slice(&encode_len(t_pcd.len()));
        inner_3.extend_from_slice(&t_pcd);
        cmd_data_3.extend_from_slice(&encode_len(inner_3.len()));
        cmd_data_3.extend_from_slice(&inner_3);

        let gen_auth_3 = ApduCommand::new(0x10, 0x86, 0x00, 0x00)
            .with_data(&cmd_data_3)
            .with_le(0x00);

        println!("[PACE] Sending Token...");
        let res_auth = self.transmit(&gen_auth_3).await?;
        Self::check_sw(&res_auth).context("GEN AUTH (Token) failed")?;
        
        // 6. Establish Secure Messaging
        println!("[PACE] Finalizing session...");
        let session = pace.finalize_session()?;
        self.secure_session = Some(SecureSession::Pace(AesSecureMessaging::new(
            &session.k_enc, &session.k_mac, session.ssc
        )?));
        
        println!("[PACE] Secure Messaging (AES-128) established.");
        Ok(())
    }

    /// Perform Chip Authentication (EACv1)
    pub async fn perform_chip_authentication(&mut self, ca_oid: &[u8], picc_pk_bytes: &[u8]) -> Result<()> {
        println!("[CA] Starting Chip Authentication...");

        // 1. Generate Ephemeral Key Pair (PCD)
        let secret = EphemeralSecret::random(&mut OsRng);
        let public_key = PublicKey::from(&secret);
        let pk_bytes = public_key.to_encoded_point(false).as_bytes().to_vec();

        // 2. MSE: SET (KAT)
        // 80 [OID]
        let mut mse_data = Vec::new();
        mse_data.push(0x80);
        mse_data.extend_from_slice(&encode_len(ca_oid.len()));
        mse_data.extend_from_slice(ca_oid);

        let mse_cmd = ApduCommand::new(0x00, 0x22, 0x41, 0xA6)
            .with_data(&mse_data);
            
        let res_mse = self.transmit(&mse_cmd).await?;
        Self::check_sw(&res_mse).context("CA MSE: SET failed")?;

        // 3. GENERAL AUTHENTICATE
        // 7C L [ 80 L [PK_PCD] ]
        let mut cmd_data = Vec::new();
        cmd_data.push(0x7C);
        let mut inner = Vec::new();
        inner.push(0x80); // Dynamic Data (Plain)
        inner.extend_from_slice(&encode_len(pk_bytes.len()));
        inner.extend_from_slice(&pk_bytes);
        
        cmd_data.extend_from_slice(&encode_len(inner.len()));
        cmd_data.extend_from_slice(&inner);
        
        // Note: CA is usually performed over existing Secure Messaging.
        // `transmit` will handle SM wrapping.
        let gen_auth = ApduCommand::new(0x00, 0x86, 0x00, 0x00)
            .with_data(&cmd_data)
            .with_le(0x00);
            
        let res_auth = self.transmit(&gen_auth).await?;
        Self::check_sw(&res_auth).context("CA GEN AUTH failed")?;
        
        // 4. Compute Shared Secret
        let picc_pk = PublicKey::from_sec1_bytes(picc_pk_bytes)
            .map_err(|e| anyhow!("Invalid PICC Public Key: {}", e))?;
            
        let shared_secret = secret.diffie_hellman(&picc_pk);
        let shared_bytes = shared_secret.raw_secret_bytes();
        
        // 5. Derive New Session Keys
        // CA KDF: SHA-1/256 counter mode. Assuming SHA-256 and AES-128 for prototype.
        let (k_enc, k_mac) = derive_session_keys_sha256(shared_bytes.as_slice(), 16);
        
        // 6. Update Secure Session (Restart SSC)
        // Note: The response to GEN AUTH was protected with OLD keys (handled by transmit).
        // New keys apply from NEXT command.
        self.secure_session = Some(SecureSession::Pace(AesSecureMessaging::new(
            &k_enc, &k_mac, 0
        )?));
        
        println!("[CA] Chip Authentication successful. New keys established.");
        Ok(())
    }

    /// Perform Active Authentication (Internal Authenticate)
    pub async fn perform_active_authentication(&mut self, challenge: &[u8]) -> Result<Vec<u8>> {
        let apdu = ApduCommand::new(CLA_ISO, INS_INTERNAL_AUTHENTICATE, 0x00, 0x00)
            .with_data(challenge)
            .with_le(0x00);
            
        let res = self.transmit(&apdu).await?;
        Self::check_sw(&res).context("Active Authentication failed")?;
        
        let signature = res[0..res.len()-2].to_vec();
        Ok(signature)
    }

    /// Read EF.COM
    pub async fn read_common_data(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_COM).await
    }

    /// Read EF.DG1 (MRZ)
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

    /// Read EF.DG14 (Security Infos / Chip Authentication)
    pub async fn read_dg14(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_DG14).await
    }

    /// Read EF.DG15 (Active Authentication Public Key Info)
    pub async fn read_dg15(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_DG15).await
    }

    /// Read EF.SOD (Security Object Document)
    pub async fn read_sod(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_SOD).await
    }

    // Helper to Select EF and Read Binary
    pub(crate) async fn read_file(&mut self, file_id: &[u8]) -> Result<Vec<u8>> {
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(file_id);
        let res_sel = self.transmit(&select).await?;
        Self::check_sw(&res_sel).context("Failed to select EF")?;

        let mut data = Vec::new();
        let mut offset: u16 = 0;
        
        loop {
            let p1 = (offset >> 8) as u8;
            let p2 = (offset & 0xFF) as u8;
            
            let read = ApduCommand::new(CLA_ISO, INS_READ_BINARY, p1, p2)
                .with_le(0x00);
            
            let res = self.transmit(&read).await?;
            
            if res.len() < 2 {
                return Err(anyhow!("Response too short"));
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
                 break;
            } else if sw1 == 0x62 && sw2 == 0x82 {
                 break;
            } else {
                 return Err(anyhow!("Read Binary Error: {:02X}{:02X}", sw1, sw2));
            }

            if offset > 32768 {
                break;
            }
        }
        
        Ok(data)
    }

    fn check_sw(res: &[u8]) -> Result<()> {
        if res.len() < 2 {
            return Err(anyhow!("Response too short"));
        }
        let sw1 = res[res.len() - 2];
        let sw2 = res[res.len() - 1];
        if sw1 == 0x90 && sw2 == 0x00 {
            Ok(())
        } else {
            Err(anyhow!("Card Error: SW={:02X}{:02X}", sw1, sw2))
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
    if res.len() < 4 || res[0] != 0x7C {
        return Err(anyhow!("Invalid PACE response format"));
    }
    let mut offset = 1;
    let (_len, l_len) = parse_asn1_len(res, offset)?;
    offset += l_len;
    
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

    #[tokio::test]
    async fn test_active_authentication() {
        use crate::mock_passport::MockPassport;
        use std::sync::{Arc, Mutex};

        let reader = TestReader::new();
        let mock = Arc::new(Mutex::new(MockPassport::new("123456")));
        
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| {
            mock_clone.lock().unwrap().handle_apdu(apdu)
        });

        let mut controller = PassportController::new(reader.clone());
        
        // Execute AA
        let challenge = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
        let res = controller.perform_active_authentication(&challenge).await;
        
        assert!(res.is_ok());
        let signature = res.unwrap();
        // Matching dummy signature from mock_passport.rs
        assert_eq!(signature, vec![0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE]);
    }

    #[tokio::test]
    async fn test_chip_authentication_flow() {
        use crate::mock_passport::MockPassport;
        use std::sync::{Arc, Mutex};

        let reader = TestReader::new();
        let mock = Arc::new(Mutex::new(MockPassport::new("123456")));
        
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| {
            mock_clone.lock().unwrap().handle_apdu(apdu)
        });

        let mut controller = PassportController::new(reader.clone());

        // 1. Read DG14
        let dg14 = controller.read_dg14().await;
        assert!(dg14.is_ok(), "Failed to read DG14");

        // 2. Perform Chip Authentication
        // Mock valid PICC Public Key (Uncompressed P-256)
        let picc_pk = hex::decode("046B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C2964FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5").unwrap();
        let ca_oid = vec![0x06, 0x0A, 0x04, 0x00, 0x7F, 0x00, 0x07, 0x02, 0x02, 0x03, 0x02, 0x01]; // Dummy OID

        let res = controller.perform_chip_authentication(&ca_oid, &picc_pk).await;
        
        assert!(res.is_ok());
        
        let apdus = reader.sent_apdus.lock().unwrap();
        // Expected: READ BINARY (DG14), MSE: SET, GEN AUTH
        // Note: MSE and GEN AUTH might use Secure Messaging if a session is active.
        // For this test, we run CA directly (no prior PACE), so it's plaintext.
        
        let len = apdus.len();
        assert!(len >= 2);
        // Verify MSE
        assert_eq!(apdus[len-2][1], 0x22); 
        // Verify GEN AUTH
        assert_eq!(apdus[len-1][1], 0x86); 
    }
}
