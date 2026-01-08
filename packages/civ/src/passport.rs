use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY, INS_GET_CHALLENGE, INS_EXTERNAL_AUTHENTICATE, INS_INTERNAL_AUTHENTICATE};
use crate::reader::CardReader;
use crate::crypto::bac::BacSession;
use crate::crypto::sm::{AesSecureMessaging, SecureMessagingSession};
use crate::crypto::pace::{PaceP256, PaceMappingType, derive_session_keys_sha256};
use anyhow::{Result, Context, anyhow};
use p256::{PublicKey, ecdh::EphemeralSecret};
use rand_core::OsRng;
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::ecdsa::{SigningKey, Signature};
use signature::Signer;
use crate::utils::{parse_ber_tlv, DateUtils, MrzUtils};

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
    pub const DF_ICAO: [u8; 7] = [0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01];

    /// EF.COM (Common Data)
    pub const EF_COM: [u8; 2] = [0x01, 0x1E];
    /// EF.DG1 (MRZ)
    pub const EF_DG1: [u8; 2] = [0x01, 0x01];
    /// EF.DG2 (Photo)
    pub const EF_DG2: [u8; 2] = [0x01, 0x02];
    /// EF.DG3 (Fingerprints)
    pub const EF_DG3: [u8; 2] = [0x01, 0x03];
    /// EF.DG4 (Iris)
    pub const EF_DG4: [u8; 2] = [0x01, 0x04];
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
        let k_seed = bac::derive_key_seed(mrz);
        let (k_enc, k_mac) = bac::derive_session_keys(&k_seed);
        
        let get_challenge = ApduCommand::new(CLA_ISO, INS_GET_CHALLENGE, 0x00, 0x00).with_le(0x08); 
        let rnd_ic_response = self.reader.transmit(&get_challenge.to_bytes()).await?;
        Self::check_sw(&rnd_ic_response)?;
        let rnd_ic = &rnd_ic_response[0..8];

        let rnd_ic: [u8; 8] = rnd_ic.try_into().map_err(|_| anyhow!("Invalid RND.ICC"))?;
        let (auth_data, ssc) = bac::build_mutual_auth_data(&k_enc, &k_mac, &rnd_ic)?;
        let external_auth = ApduCommand::new(CLA_ISO, INS_EXTERNAL_AUTHENTICATE, 0x00, 0x00).with_data(&auth_data);
        let response = self.reader.transmit(&external_auth.to_bytes()).await?;
        Self::check_sw(&response)?;

        self.secure_session = Some(SecureSession::Bac(bac::BacSession::new(k_enc, k_mac, ssc)));
        Ok(())
    }

    /// Perform PACE (Password Authenticated Connection Establishment)
    pub async fn perform_pace(&mut self, mrz_or_can: &str) -> Result<()> {
        println!("[PACE] Starting PACE with password: {}", mrz_or_can);
        let oid_pace_gm_aes = vec![0x06, 0x0A, 0x04, 0x00, 0x7F, 0x00, 0x07, 0x02, 0x02, 0x04, 0x02, 0x02];
        let mut mse_val = vec![0x80, oid_pace_gm_aes.len() as u8];
        mse_val.extend_from_slice(&oid_pace_gm_aes);
        mse_val.extend_from_slice(&[0x83, 0x01, 0x01]);

        let mse_set = ApduCommand::new(0x00, 0x22, 0xC1, 0xA4).with_data(&mse_val);
        let res = self.transmit(&mse_set).await?;
        Self::check_sw(&res)?;
        
        let mut pace = PaceP256::new(mrz_or_can, PaceMappingType::GenericMapping, 16);
        let gen_auth_1 = ApduCommand::new(0x10, 0x86, 0x00, 0x00).with_data(&[0x7C, 0x00]).with_le(0x00);
        let res_nonce = self.transmit(&gen_auth_1).await?;
        Self::check_sw(&res_nonce)?;
        let z = parse_pace_response(&res_nonce, 0x80)?;
        pace.set_encrypted_nonce(&z);

        let my_pk = pace.perform_mapping_and_generate_key()?;
        let mut cmd_data_2 = vec![0x7C];
        let mut inner_2 = vec![0x81]; 
        inner_2.extend_from_slice(&encode_len(my_pk.len()));
        inner_2.extend_from_slice(&my_pk);
        cmd_data_2.extend_from_slice(&encode_len(inner_2.len()));
        cmd_data_2.extend_from_slice(&inner_2);
        
        let gen_auth_2 = ApduCommand::new(0x10, 0x86, 0x00, 0x00).with_data(&cmd_data_2).with_le(0x00);
        let res_map = self.transmit(&gen_auth_2).await?;
        Self::check_sw(&res_map)?;
        let peer_pk = parse_pace_response(&res_map, 0x82)?;
        pace.compute_shared_secret(&peer_pk)?;

        let t_pcd = pace.perform_token_exchange(&[])?; 
        let mut cmd_data_3 = vec![0x7C];
        let mut inner_3 = vec![0x85]; 
        inner_3.extend_from_slice(&encode_len(t_pcd.len()));
        inner_3.extend_from_slice(&t_pcd);
        cmd_data_3.extend_from_slice(&encode_len(inner_3.len()));
        cmd_data_3.extend_from_slice(&inner_3);

        let gen_auth_3 = ApduCommand::new(0x10, 0x86, 0x00, 0x00).with_data(&cmd_data_3).with_le(0x00);
        let res_auth = self.transmit(&gen_auth_3).await?;
        Self::check_sw(&res_auth)?;
        
        let session = pace.finalize_session()?;
        self.secure_session = Some(SecureSession::Pace(AesSecureMessaging::new(&session.k_enc, &session.k_mac, session.ssc)?));
        Ok(())
    }

    /// Perform Chip Authentication (EACv1)
    pub async fn perform_chip_authentication(&mut self, ca_oid: &[u8], picc_pk_bytes: &[u8]) -> Result<()> {
        println!("[CA] Starting Chip Authentication...");
        let secret = EphemeralSecret::random(&mut OsRng);
        let public_key = PublicKey::from(&secret);
        let pk_bytes = public_key.to_encoded_point(false).as_bytes().to_vec();

        let mut mse_data = vec![0x80];
        mse_data.extend_from_slice(&encode_len(ca_oid.len()));
        mse_data.extend_from_slice(ca_oid);

        let mse_cmd = ApduCommand::new(0x00, 0x22, 0x41, 0xA6).with_data(&mse_data);
        let res_mse = self.transmit(&mse_cmd).await?;
        Self::check_sw(&res_mse)?;

        let mut cmd_data = vec![0x7C];
        let mut inner = vec![0x80]; 
        inner.extend_from_slice(&encode_len(pk_bytes.len()));
        inner.extend_from_slice(&pk_bytes);
        cmd_data.extend_from_slice(&encode_len(inner.len()));
        cmd_data.extend_from_slice(&inner);
        
        let gen_auth = ApduCommand::new(0x00, 0x86, 0x00, 0x00).with_data(&cmd_data).with_le(0x00);
        let res_auth = self.transmit(&gen_auth).await?;
        Self::check_sw(&res_auth)?;
        
        let picc_pk = PublicKey::from_sec1_bytes(picc_pk_bytes).map_err(|e| anyhow!("Invalid PICC Public Key: {}", e))?;
        let shared_secret = secret.diffie_hellman(&picc_pk);
        let (k_enc, k_mac) = derive_session_keys_sha256(shared_secret.raw_secret_bytes().as_slice(), 16);
        
        self.secure_session = Some(SecureSession::Pace(AesSecureMessaging::new(&k_enc, &k_mac, 0)?));
        Ok(())
    }

    /// Perform Terminal Authentication (EACv1)
    pub async fn perform_terminal_authentication(&mut self, cert_chain: &[Vec<u8>], terminal_priv_key: &[u8]) -> Result<()> {
        println!("[TA] Starting Terminal Authentication...");
        for cert in cert_chain {
            let mse_cmd = ApduCommand::new(0x00, 0x22, 0x81, 0xB6).with_data(cert);
            let res = self.transmit(&mse_cmd).await?;
            Self::check_sw(&res)?;
        }
        let get_challenge = ApduCommand::new(0x00, 0x84, 0x00, 0x00).with_le(0x08);
        let res_challenge = self.transmit(&get_challenge).await?;
        Self::check_sw(&res_challenge)?;
        let challenge = &res_challenge[0..8];

        let signing_key = SigningKey::from_slice(terminal_priv_key).map_err(|e| anyhow!("Invalid key: {}", e))?;
        let signature: Signature = signing_key.sign(challenge);
        let sig_bytes = signature.to_bytes().to_vec();

        let ext_auth = ApduCommand::new(0x00, 0x82, 0x00, 0x00).with_data(&sig_bytes);
        let res_auth = self.transmit(&ext_auth).await?;
        Self::check_sw(&res_auth)?;
        Ok(())
    }

    /// Perform Active Authentication (Internal Authenticate)
    pub async fn perform_active_authentication(&mut self, challenge: &[u8]) -> Result<Vec<u8>> {
        let apdu = ApduCommand::new(CLA_ISO, INS_INTERNAL_AUTHENTICATE, 0x00, 0x00).with_data(challenge).with_le(0x00);
        let res = self.transmit(&apdu).await?;
        Self::check_sw(&res)?;
        Ok(res[0..res.len()-2].to_vec())
    }

    pub async fn read_common_data(&mut self) -> Result<Vec<u8>> { self.read_file(&file_ids::EF_COM).await }
    pub async fn read_dg1(&mut self) -> Result<Vec<u8>> { self.read_file(&file_ids::EF_DG1).await }
    pub async fn read_dg2(&mut self) -> Result<Vec<u8>> { self.read_file(&file_ids::EF_DG2).await }
    pub async fn read_dg3(&mut self) -> Result<Vec<u8>> { self.read_file(&file_ids::EF_DG3).await }
    pub async fn read_dg4(&mut self) -> Result<Vec<u8>> { self.read_file(&file_ids::EF_DG4).await }
    pub async fn read_dg11(&mut self) -> Result<Vec<u8>> { self.read_file(&file_ids::EF_DG11).await }
    pub async fn read_dg12(&mut self) -> Result<Vec<u8>> { self.read_file(&file_ids::EF_DG12).await }
    pub async fn read_dg14(&mut self) -> Result<Vec<u8>> { self.read_file(&file_ids::EF_DG14).await }
    pub async fn read_dg15(&mut self) -> Result<Vec<u8>> { self.read_file(&file_ids::EF_DG15).await }
    pub async fn read_sod(&mut self) -> Result<Vec<u8>> { self.read_file(&file_ids::EF_SOD).await }

    pub(crate) async fn read_file(&mut self, file_id: &[u8]) -> Result<Vec<u8>> {
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(file_id);
        let res_sel = self.transmit(&select).await?;
        Self::check_sw(&res_sel)?;

        let mut data = Vec::new();
        let mut offset: u16 = 0;
        loop {
            let read = ApduCommand::new(CLA_ISO, INS_READ_BINARY, (offset >> 8) as u8, (offset & 0xFF) as u8).with_le(0x00);
            let res = self.transmit(&read).await?;
            if res.len() < 2 { return Err(anyhow!("Response too short")); }
            let sw1 = res[res.len() - 2];
            let sw2 = res[res.len() - 1];
            let chunk = &res[0..res.len()-2];
            if !chunk.is_empty() {
                data.extend_from_slice(chunk);
                offset += chunk.len() as u16;
            }
            if sw1 == 0x90 && sw2 == 0x00 { if chunk.len() < 256 { break; } }
            else if sw1 == 0x6B || (sw1 == 0x62 && sw2 == 0x82) { break; }
            else { return Err(anyhow!("Read Binary Error: {:02X}{:02X}", sw1, sw2)); }
            if offset > 32768 { break; }
        }
        Ok(data)
    }

    fn check_sw(res: &[u8]) -> Result<()> {
        if res.len() < 2 { return Err(anyhow!("Response too short")); }
        let sw1 = res[res.len() - 2];
        let sw2 = res[res.len() - 1];
        if sw1 == 0x90 && sw2 == 0x00 { Ok(()) }
        else { Err(anyhow!("Card Error: SW={:02X}{:02X}", sw1, sw2)) }
    }

    async fn transmit(&mut self, apdu: &ApduCommand) -> Result<Vec<u8>> {
        if let Some(session) = self.secure_session.as_mut() {
            let wrapped = session.wrap_command(apdu)?;
            let response = self.reader.transmit(&wrapped).await?;
            let (data, sw1, sw2) = session.unwrap_response(&response)?;
            let mut out = data; out.push(sw1); out.push(sw2);
            Ok(out)
        } else {
            self.reader.transmit(&apdu.to_bytes()).await
        }
    }
}

// Helper functions for PACE Parsing
fn parse_pace_response(res: &[u8], target_tag: u8) -> Result<Vec<u8>> {
    let tlvs = parse_ber_tlv(res).context("Failed to parse PACE TLV")?;
    
    fn find_tag_recursive(tlvs: &[crate::utils::BerTlv], target: u32) -> Option<Vec<u8>> {
        for tlv in tlvs {
            if tlv.tag == target { return Some(tlv.value.to_vec()); }
            if let Some(v) = find_tag_recursive(&tlv.children, target) { return Some(v); }
        }
        None
    }
    
    find_tag_recursive(&tlvs, target_tag as u32).ok_or_else(|| anyhow!("Tag {:02X} not found", target_tag))
}

fn encode_len(len: usize) -> Vec<u8> {
    if len <= 0x7F { vec![len as u8] }
    else if len <= 0xFF { vec![0x81, len as u8] }
    else { vec![0x82, ((len >> 8) & 0xFF) as u8, (len & 0xFF) as u8] }
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
    }

    #[tokio::test]
    async fn test_read_dg1_multi_block() {
        let reader = TestReader::new();
        let mut controller = PassportController::new(reader.clone());
        reader.push_response(&[0x90, 0x00]);
        let mut block1 = vec![0xAA; 256]; block1.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&block1);
        let mut block2 = vec![0xBB; 10]; block2.extend_from_slice(&[0x90, 0x00]);
        reader.push_response(&block2);
        let res = controller.read_dg1().await;
        assert!(res.is_ok());
        let data = res.unwrap();
        assert_eq!(data.len(), 266);
    }

    #[tokio::test]
    async fn test_perform_bac_flow() {
        use crate::mock_passport::MockPassport;
        use std::sync::{Arc, Mutex};
        let reader = TestReader::new();
        let mock = Arc::new(Mutex::new(MockPassport::new("123456")));
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| { mock_clone.lock().unwrap().handle_apdu(apdu) });
        let mut controller = PassportController::new(reader.clone());
        let mrz = "L898902C<36908061F9406236";
        let res = controller.perform_bac(mrz).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_perform_pace_flow() {
        use crate::mock_passport::MockPassport;
        use std::sync::{Arc, Mutex};
        let reader = TestReader::new();
        let mock = Arc::new(Mutex::new(MockPassport::new("123456")));
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| { mock_clone.lock().unwrap().handle_apdu(apdu) });
        let mut controller = PassportController::new(reader.clone());
        let res = controller.perform_pace("123456").await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_active_authentication() {
        use crate::mock_passport::MockPassport;
        use std::sync::{Arc, Mutex};
        let reader = TestReader::new();
        let mock = Arc::new(Mutex::new(MockPassport::new("123456")));
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| { mock_clone.lock().unwrap().handle_apdu(apdu) });
        let mut controller = PassportController::new(reader.clone());
        let challenge = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
        let res = controller.perform_active_authentication(&challenge).await;
        assert!(res.is_ok());
        assert_eq!(res.unwrap(), vec![0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE]);
    }

    #[tokio::test]
    async fn test_chip_authentication_flow() {
        use crate::mock_passport::MockPassport;
        use std::sync::{Arc, Mutex};
        let reader = TestReader::new();
        let mock = Arc::new(Mutex::new(MockPassport::new("123456")));
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| { mock_clone.lock().unwrap().handle_apdu(apdu) });
        let mut controller = PassportController::new(reader.clone());
        let _ = controller.read_dg14().await;
        let picc_pk = hex::decode("046B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C2964FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5").unwrap();
        let ca_oid = vec![0x06, 0x0A, 0x04, 0x00, 0x7F, 0x00, 0x07, 0x02, 0x02, 0x03, 0x02, 0x01];
        let res = controller.perform_chip_authentication(&ca_oid, &picc_pk).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_terminal_authentication_flow() {
        use crate::mock_passport::MockPassport;
        use std::sync::{Arc, Mutex};
        let reader = TestReader::new();
        let mock = Arc::new(Mutex::new(MockPassport::new("123456")));
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| { mock_clone.lock().unwrap().handle_apdu(apdu) });
        let mut controller = PassportController::new(reader.clone());
        let cert_chain = vec![vec![0x7F, 0x21, 0x05, 0x01, 0x02, 0x03, 0x04, 0x05]]; 
        let terminal_priv_key = [0x01u8; 32];
        let res = controller.perform_terminal_authentication(&cert_chain, &terminal_priv_key).await;
        assert!(res.is_ok());
        let dg3 = controller.read_dg3().await;
        assert!(dg3.is_ok());
    }
}