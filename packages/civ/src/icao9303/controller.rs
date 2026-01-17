use crate::apdu::{ApduCommand, CLA_ISO, INS_READ_BINARY, INS_SELECT_FILE, INS_INTERNAL_AUTHENTICATE};
use crate::errors::{CivError, Result};
use crate::models::{CitizenIdentity, IdentityController};
use crate::reader::CardReader;
use crate::utils::MrzUtils;
use std::collections::HashMap;
use p256::{ecdh::EphemeralSecret, elliptic_curve::sec1::ToEncodedPoint, PublicKey};
use p256::ecdsa::{Signature, SigningKey};
use signature::Signer;
use rand_core::OsRng;

use super::files;
use super::protocols::{bac, pace};
use super::session::SecureSession;
use super::utils::{check_sw, debug_passport, extract_mrz_from_dg1, parse_tlv_total_length, encode_len};

/// ICAO 9303 (MRTD/Passport) Application Controller
pub struct Icao9303Controller<R: CardReader> {
    reader: R,
    secure_session: Option<SecureSession>,
    mrz: Option<String>,
    can: Option<String>,
    last_verified: bool,
}

impl<R: CardReader> Icao9303Controller<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            secure_session: None,
            mrz: None,
            can: None,
            last_verified: false,
        }
    }

    /// Select the ePassport Application
    pub async fn select_ep_ap(&mut self) -> Result<()> {
        let apdu =
            ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C).with_data(&files::DF_ICAO);

        let res = self.reader.transmit(&apdu.to_bytes()).await.map_err(|e| CivError::Communication(e.to_string()))?;
        check_sw(&res)
    }

    /// Perform Basic Access Control (BAC)
    pub async fn perform_bac(&mut self, mrz: &str) -> Result<()> {
        let session = bac::perform_bac(&mut self.reader, mrz).await?;
        self.secure_session = Some(SecureSession::Bac(session));
        Ok(())
    }

    /// Perform PACE
    pub async fn perform_pace(&mut self, mrz_or_can: &str) -> Result<()> {
        let session = pace::perform_pace(&mut self.reader, mrz_or_can).await?;
        self.secure_session = Some(SecureSession::Pace(session));
        Ok(())
    }

    /// Perform Chip Authentication
    pub async fn perform_chip_authentication(
        &mut self,
        ca_oid: &[u8],
        picc_pk_bytes: &[u8],
    ) -> Result<()> {
        let secret = EphemeralSecret::random(&mut OsRng);
        let public_key = PublicKey::from(&secret);
        let pk_bytes = public_key.to_encoded_point(false).as_bytes().to_vec();

        let mut mse_data = vec![0x80];
        mse_data.extend_from_slice(&encode_len(ca_oid.len()));
        mse_data.extend_from_slice(ca_oid);

        let mse_cmd = ApduCommand::new(0x00, 0x22, 0x41, 0xA6).with_data(&mse_data);
        let res_mse = self.transmit(&mse_cmd).await?;
        check_sw(&res_mse)?;

        let mut cmd_data = vec![0x7C];
        let mut inner = vec![0x80];
        inner.extend_from_slice(&encode_len(pk_bytes.len()));
        inner.extend_from_slice(&pk_bytes);
        cmd_data.extend_from_slice(&encode_len(inner.len()));
        cmd_data.extend_from_slice(&inner);

        let gen_auth = ApduCommand::new(0x00, 0x86, 0x00, 0x00)
            .with_data(&cmd_data)
            .with_le(0x00);
        let res_auth = self.transmit(&gen_auth).await?;
        check_sw(&res_auth)?;

        let picc_pk = PublicKey::from_sec1_bytes(picc_pk_bytes)
            .map_err(|e| CivError::CryptoError(format!("Invalid PICC Public Key: {}", e)))?;
        let shared_secret = secret.diffie_hellman(&picc_pk);
        
        use crate::crypto::pace::derive_session_keys_sha256;
        let (k_enc, k_mac) =
            derive_session_keys_sha256(shared_secret.raw_secret_bytes().as_slice(), 16);

        use crate::crypto::sm::AesSecureMessaging;
        let sm = AesSecureMessaging::new(&k_enc, &k_mac, 0)
            .map_err(|e| CivError::SecureMessagingError(e.to_string()))?;
        self.secure_session = Some(SecureSession::Pace(sm));
        Ok(())
    }

    /// Perform Terminal Authentication
    pub async fn perform_terminal_authentication(
        &mut self,
        cert_chain: &[Vec<u8>],
        terminal_priv_key: &[u8],
    ) -> Result<()> {
        for cert in cert_chain {
            let mse_cmd = ApduCommand::new(0x00, 0x22, 0x81, 0xB6).with_data(cert);
            let res = self.transmit(&mse_cmd).await?;
            check_sw(&res)?;
        }
        let get_challenge = ApduCommand::new(0x00, 0x84, 0x00, 0x00).with_le(0x08);
        let res_challenge = self.transmit(&get_challenge).await?;
        check_sw(&res_challenge)?;
        let challenge = &res_challenge[0..8];

        let signing_key = SigningKey::from_slice(terminal_priv_key)
            .map_err(|e| CivError::CryptoError(format!("Invalid key: {}", e)))?;
        let signature: Signature = signing_key.sign(challenge);
        let sig_bytes = signature.to_bytes().to_vec();

        let ext_auth = ApduCommand::new(0x00, 0x82, 0x00, 0x00).with_data(&sig_bytes);
        let res_auth = self.transmit(&ext_auth).await?;
        check_sw(&res_auth)?;
        Ok(())
    }

    /// Perform Active Authentication
    pub async fn perform_active_authentication(&mut self, challenge: &[u8]) -> Result<Vec<u8>> {
        let apdu = ApduCommand::new(CLA_ISO, INS_INTERNAL_AUTHENTICATE, 0x00, 0x00)
            .with_data(challenge)
            .with_le(0x00);
        let res = self.transmit(&apdu).await?;
        check_sw(&res)?;
        Ok(res[0..res.len() - 2].to_vec())
    }

    pub async fn read_common_data(&mut self) -> Result<Vec<u8>> {
        self.read_file(&files::EF_COM).await
    }
    pub async fn read_dg1(&mut self) -> Result<Vec<u8>> {
        self.read_file(&files::EF_DG1).await
    }
    pub async fn read_dg2(&mut self) -> Result<Vec<u8>> {
        self.read_file(&files::EF_DG2).await
    }
    pub async fn read_dg3(&mut self) -> Result<Vec<u8>> {
        self.read_file(&files::EF_DG3).await
    }
    pub async fn read_dg4(&mut self) -> Result<Vec<u8>> {
        self.read_file(&files::EF_DG4).await
    }
    pub async fn read_dg11(&mut self) -> Result<Vec<u8>> {
        self.read_file(&files::EF_DG11).await
    }
    pub async fn read_dg12(&mut self) -> Result<Vec<u8>> {
        self.read_file(&files::EF_DG12).await
    }
    pub async fn read_dg14(&mut self) -> Result<Vec<u8>> {
        self.read_file(&files::EF_DG14).await
    }
    pub async fn read_dg15(&mut self) -> Result<Vec<u8>> {
        self.read_file(&files::EF_DG15).await
    }
    pub async fn read_sod(&mut self) -> Result<Vec<u8>> {
        self.read_file(&files::EF_SOD).await
    }

    pub async fn verify_passive_authentication(
        &mut self,
        dgs: &HashMap<u8, Vec<u8>>,
    ) -> Result<()> {
        let sod_data = self.read_sod().await?;
        let verifier = super::verify::Icao9303Verifier::new();
        let sod = verifier.parse_sod(&sod_data)?;
        for (&dg_num, content) in dgs {
            verifier.verify_data_group(&sod, dg_num, content)?;
        }
        verifier.verify_passive_authentication(&sod)?;
        Ok(())
    }

    pub async fn read_dg(&mut self, dg_num: u8) -> Result<Vec<u8>> {
        match dg_num {
            1 => self.read_dg1().await,
            2 => self.read_dg2().await,
            14 => self.read_dg14().await,
            _ => Err(CivError::NotFound(format!("DG{} not implemented", dg_num))),
        }
    }

    pub(crate) async fn read_file(&mut self, file_id: &[u8]) -> Result<Vec<u8>> {
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C)
            .with_data(file_id);
        let res_sel = self.transmit(&select).await?;
        if let Err(err) = check_sw(&res_sel) {
            let sw1 = res_sel.get(res_sel.len().saturating_sub(2)).copied().unwrap_or(0);
            if matches!(sw1, 0x69 | 0x67 | 0x6A) {
                let plain_res = self
                    .reader
                    .transmit(&select.to_bytes())
                    .await
                    .map_err(|e| CivError::Communication(e.to_string()))?;
                check_sw(&plain_res)?;
            } else {
                return Err(err);
            }
        }

        let sm_active = self.secure_session.is_some();
        let mut data = Vec::new();
        let mut offset: u16 = 0;
        let mut expected_size: Option<usize> = None;
        loop {
            let read = ApduCommand::new(
                CLA_ISO,
                INS_READ_BINARY,
                (offset >> 8) as u8,
                (offset & 0xFF) as u8,
            )
            .with_le(0x00);
            let res = self.transmit(&read).await?;
            if res.len() < 2 {
                return Err(CivError::Communication("Response too short".to_string()));
            }
            let sw1 = res[res.len() - 2];
            let sw2 = res[res.len() - 1];
            let chunk = &res[0..res.len() - 2];
            if !chunk.is_empty() {
                data.extend_from_slice(chunk);
                offset += chunk.len() as u16;
                if expected_size.is_none() {
                    expected_size = parse_tlv_total_length(&data);
                    if let Some(size) = expected_size {
                        debug_passport(&format!("ICAO 9303: EF total size from TLV header: {} bytes", size));
                    }
                }
            }
            if sw1 == 0x90 && sw2 == 0x00 {
                if chunk.is_empty() {
                    break;
                }
                if !sm_active && chunk.len() < 256 {
                    break;
                }
                if let Some(size) = expected_size {
                    if data.len() >= size {
                        break;
                    }
                }
            } else if sw1 == 0x6C || sw1 == 0x61 {
                let correct_le = if sw2 == 0 { 256 } else { sw2 as usize };
                let retry = ApduCommand::new(
                    CLA_ISO,
                    INS_READ_BINARY,
                    (offset >> 8) as u8,
                    (offset & 0xFF) as u8,
                )
                .with_le(correct_le);
                let retry_res = self.transmit(&retry).await?;
                if retry_res.len() < 2 {
                    return Err(CivError::Communication("Retry response too short".to_string()));
                }
                let retry_sw1 = retry_res[retry_res.len() - 2];
                let retry_sw2 = retry_res[retry_res.len() - 1];
                if retry_sw1 == 0x90 && retry_sw2 == 0x00 {
                    let retry_chunk = &retry_res[..retry_res.len() - 2];
                    if !retry_chunk.is_empty() {
                        data.extend_from_slice(retry_chunk);
                        offset += retry_chunk.len() as u16;
                        if expected_size.is_none() {
                            expected_size = parse_tlv_total_length(&data);
                        }
                    } else {
                        break;
                    }
                    if let Some(size) = expected_size {
                        if data.len() >= size {
                            break;
                        }
                    }
                } else {
                    return Err(CivError::from_sw(retry_sw1, retry_sw2));
                }
            } else if sw1 == 0x6B || (sw1 == 0x62 && sw2 == 0x82) {
                debug_passport(&format!("ICAO 9303: read terminated SW={:02X}{:02X} at offset {}, total {}", sw1, sw2, offset, data.len()));
                break;
            } else {
                return Err(CivError::from_sw(sw1, sw2));
            }
            if offset > 32768 {
                break;
            }
        }
        Ok(data)
    }

    async fn transmit(&mut self, apdu: &ApduCommand) -> Result<Vec<u8>> {
        debug_passport(&format!("ICAO 9303 APDU => {}", hex::encode(apdu.to_bytes())));
        
        let response = if let Some(session) = self.secure_session.as_mut() {
            let is_sm_command = (apdu.cla & 0x0C) != 0;
            let wrapped = session.wrap_command(apdu)?;
            
            debug_passport(&format!("ICAO 9303 APDU (wrapped) => {}", hex::encode(&wrapped)));
            
            let response = self
                .reader
                .transmit(&wrapped)
                .await
                .map_err(|e| CivError::Communication(e.to_string()))?;
            
            if response.len() >= 2 {
                debug_passport(&format!("ICAO 9303 APDU <= {:02X}{:02X}", response[response.len()-2], response[response.len()-1]));
            }

            if is_sm_command || response.len() > 2 {
                let (data, sw1, sw2) = session.unwrap_response(&response)?;
                let mut out: Vec<u8> = data;
                out.push(sw1);
                out.push(sw2);
                out
            } else {
                response
            }
        } else {
            let response = self
                .reader
                .transmit(&apdu.to_bytes())
                .await
                .map_err(|e| CivError::Communication(e.to_string()))?;
            if response.len() >= 2 {
                debug_passport(&format!("ICAO 9303 APDU <= {:02X}{:02X}", response[response.len()-2], response[response.len()-1]));
            }
            response
        };
        
        Ok(response)
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
impl<R: CardReader + Send> IdentityController for Icao9303Controller<R> {
    async fn provide_pin(&mut self, pin_type: &str, pin: &str) -> Result<()> {
        match pin_type {
            "mrz" => self.mrz = Some(pin.to_string()),
            "can" => self.can = Some(pin.to_string()),
            _ => {
                return Err(CivError::InvalidData(format!("Unknown PIN/Password type for ICAO 9303: {}", pin_type)))
            }
        }
        Ok(())
    }

    async fn verify(&mut self) -> Result<bool> {
        if self.secure_session.is_none() {
            if let Some(can) = self.can.clone() {
                self.perform_pace(&can).await?;
            } else if let Some(mrz) = self.mrz.clone() {
                self.perform_bac(&mrz).await?;
            } else {
                let _ = self.select_ep_ap().await;
            }
        }
        let mut dgs = HashMap::new();
        if let Ok(dg1) = self.read_dg1().await {
            dgs.insert(1, dg1);
        }
        self.verify_passive_authentication(&dgs).await?;
        self.last_verified = true;
        Ok(true)
    }

    async fn read_identity(&mut self) -> Result<CitizenIdentity> {
        if self.secure_session.is_none() {
            if let Some(can) = self.can.clone() {
                self.perform_pace(&can).await?;
            } else if let Some(mrz) = self.mrz.clone() {
                self.perform_bac(&mrz).await?;
            } else {
                self.select_ep_ap().await?;
            }
        }
        let dg1 = self.read_dg1().await?;
        let mrz_raw = extract_mrz_from_dg1(&dg1)
            .unwrap_or_else(|| String::from_utf8_lossy(&dg1).to_string());

        let mut mrz_clean = mrz_raw.replace("\r", "");
        if mrz_clean.len() >= 88 && !mrz_clean.contains('\n') {
            mrz_clean.insert(44, '\n');
        }
        let mut identity = 
            MrzUtils::parse_mrz_td3(&mrz_clean).unwrap_or_else(|_| CitizenIdentity {
                full_name: "PASSPORT HOLDER".to_string(),
                card_type: "Passport".to_string(),
                ..Default::default()
            });

        if let Ok(photo) = self.read_dg2().await {
            identity.photo_data = Some(photo);
        }
        identity.verified = self.last_verified;
        Ok(identity)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mock::{MockSmartCard, PassportBackend};
    use crate::test_utils::TestReader;
    use std::sync::{Arc, Mutex};

    fn setup_passport_mock(reader: &TestReader) -> Arc<Mutex<MockSmartCard>> {
        let mut mock = MockSmartCard::new();
        mock.add_backend(
            files::DF_ICAO.to_vec(),
            Box::new(PassportBackend::new("password")),
        );
        let mock = Arc::new(Mutex::new(mock));
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| mock_clone.lock().unwrap().handle_apdu(apdu));
        mock
    }

    #[tokio::test]
    async fn test_select_ep_ap() {
        let reader = TestReader::new();
        let _mock = setup_passport_mock(&reader);
        let mut controller = Icao9303Controller::new(reader.clone());
        let res = controller.select_ep_ap().await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_read_dg14() {
        let reader = TestReader::new();
        let _mock = setup_passport_mock(&reader);
        let mut controller = Icao9303Controller::new(reader.clone());
        let _ = controller.select_ep_ap().await;
        let res = controller.read_dg14().await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_perform_pace_flow() {
        let reader = TestReader::new();
        let _mock = setup_passport_mock(&reader);
        let mut controller = Icao9303Controller::new(reader.clone());
        let _ = controller.select_ep_ap().await;
        let res = controller.perform_pace("123456").await;
        assert!(res.is_ok());
        let dg14 = controller.read_dg14().await;
        assert!(dg14.is_ok());
    }

    #[tokio::test]
    async fn test_active_authentication() {
        let reader = TestReader::new();
        let _mock = setup_passport_mock(&reader);
        let mut controller = Icao9303Controller::new(reader.clone());
        let _ = controller.select_ep_ap().await;
        let challenge = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
        let res = controller.perform_active_authentication(&challenge).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_chip_authentication_flow() {
        let reader = TestReader::new();
        let _mock = setup_passport_mock(&reader);
        let mut controller = Icao9303Controller::new(reader.clone());
        let _ = controller.select_ep_ap().await;
        let picc_pk = hex::decode("046B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C2964FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5").unwrap();
        let ca_oid = vec![
            0x06, 0x0A, 0x04, 0x00, 0x7F, 0x00, 0x07, 0x02, 0x02, 0x03, 0x02, 0x01,
        ];
        let res = controller
            .perform_chip_authentication(&ca_oid, &picc_pk)
            .await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_passive_authentication_flow() {
        let reader = TestReader::new();
        let _mock = setup_passport_mock(&reader);
        let mut controller = Icao9303Controller::new(reader.clone());
        let _ = controller.select_ep_ap().await;
        let dg1 = controller.read_dg1().await.unwrap();
        let mut dgs = HashMap::new();
        dgs.insert(1, dg1);
        let res = controller.verify_passive_authentication(&dgs).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_read_dg_failure() {
        let reader = TestReader::new();
        reader.set_failure(0x6A, 0x82);
        let mut controller = Icao9303Controller::new(reader.clone());
        assert!(controller.read_dg(1).await.is_err());
    }
}
