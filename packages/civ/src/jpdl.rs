use crate::apdu::{ApduCommand, CLA_ISO, INS_READ_BINARY, INS_SELECT_FILE, INS_VERIFY};
use crate::errors::{CivError, Result};
use crate::models::{CitizenIdentity, IdentityController};
use crate::reader::CardReader;
use std::fmt;

use serde::Serialize;

/// Driver's License Application Controller
pub struct DriversLicenseController<R: CardReader> {
    reader: R,
    pin1: Option<String>,
    pin2: Option<String>,
    last_verified: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct LicenseInfo {
    pub name: String,
    pub name_kana: String,
    pub address: String,
    pub birth_date: String, // Gengou format
    pub license_number: String,
    pub issue_date: String,
    pub expire_date: String,
    pub conditions: Vec<String>,
    pub color_class: String,
    pub registered_domicile: Option<String>, // Honseki
}

impl fmt::Display for LicenseInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "License Info:\n Name: {} ({})\n Address: {}\n DOB: {}\n No: {}\n Expires: {}\n Color: {}\n Conditions: {:?}\n Honseki: {:?}", 
            self.name, self.name_kana, self.address, self.birth_date, self.license_number, self.expire_date, self.color_class, self.conditions, self.registered_domicile)
    }
}

pub mod file_ids {
    // DF1: Common Data
    pub const DF_DL: [u8; 16] = [
        0xA0, 0x00, 0x00, 0x02, 0x31, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00,
    ];
    // DF2: Photo Data
    pub const DF_DL_PHOTO: [u8; 16] = [
        0xA0, 0x00, 0x00, 0x02, 0x31, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00,
    ];

    pub const IEF_PIN1: [u8; 2] = [0x00, 0x01];
    pub const IEF_PIN2: [u8; 2] = [0x00, 0x02];

    pub const EF_COMMON_DATA: [u8; 2] = [0x00, 0x01]; // EF01: Main Info
    pub const EF_HONSEKI: [u8; 2] = [0x00, 0x02]; // EF02: Registered Domicile
    pub const EF_GAIJI: [u8; 2] = [0x00, 0x03]; // EF03: External Chars
    pub const EF_PIN_SETTING: [u8; 2] = [0x00, 0x04]; // EF04: PIN Setting
    pub const EF_CONDITIONS: [u8; 2] = [0x00, 0x04]; // EF04: Condition Changes
    pub const EF_SIGNATURE: [u8; 2] = [0x00, 0x07]; // EF07: Digital Signature

    // In DF2
    pub const EF_PHOTO: [u8; 2] = [0x00, 0x01]; // EF01: Photo (JPEG2000)
}

impl<R: CardReader> DriversLicenseController<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            pin1: None,
            pin2: None,
            last_verified: false,
        }
    }

    /// Select MF (Master File)
    pub async fn select_mf(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(0x00, 0xA4, 0x00, 0x00); // Select MF by ID (implicit empty)
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        // Ignore SW for MF select as it might be already selected or return 61xx
        Ok(())
    }

    /// Select Driver's License Application (DF1)
    pub async fn select_dl_ap(&mut self) -> Result<()> {
        let apdu =
            ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C).with_data(&file_ids::DF_DL);

        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    /// Select Driver's License Photo Application (DF2)
    pub async fn select_dl_photo_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(&file_ids::DF_DL_PHOTO);

        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    /// Verify PIN
    /// Sequence: Select MF -> Select IEF -> Verify
    pub async fn verify_pin(&mut self, pin: &str, ief_id: &[u8]) -> Result<()> {
        // 1. Select MF
        self.select_mf().await?;

        // 2. Select IEF
        let sel_ief = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(ief_id);
        let res_sel = self.reader.transmit(&sel_ief.to_bytes()).await?;
        Self::check_sw(&res_sel)?;

        // 3. Verify
        let pin_bytes = pin.as_bytes();
        let apdu = ApduCommand::new(CLA_ISO, INS_VERIFY, 0x00, 0x80).with_data(pin_bytes);

        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    /// Verify PIN1 (Common Data Access)
    pub async fn verify_pin1(&mut self, pin: &str) -> Result<()> {
        self.verify_pin(pin, &file_ids::IEF_PIN1).await
    }

    /// Verify PIN2 (Sensitive Data Access: Honseki, Photo)
    pub async fn verify_pin2(&mut self, pin: &str) -> Result<()> {
        self.verify_pin(pin, &file_ids::IEF_PIN2).await
    }

    /// Read Common Data (EF01) and Parse
    /// Requires PIN 1 verification beforehand.
    pub async fn read_common_data(&mut self) -> Result<LicenseInfo> {
        self.select_dl_ap().await?; // Ensure DF1 is selected
        let raw = self.read_file(&file_ids::EF_COMMON_DATA).await?;
        self.parse_common_data(&raw)
    }

    // Internal parser
    fn parse_common_data(&self, data: &[u8]) -> Result<LicenseInfo> {
        use crate::utils::{decode_jis_x0208, parse_jpdl_tlv};
        let tlvs = parse_jpdl_tlv(data).unwrap_or_default();
        let mut info = LicenseInfo::default();

        for tlv in tlvs {
            match tlv.tag {
                0x12 => info.name = decode_jis_x0208(&tlv.value),
                0x13 => info.name_kana = decode_jis_x0208(&tlv.value),
                0x16 => info.birth_date = String::from_utf8_lossy(&tlv.value).to_string(), // Date is ASCII
                0x17 => info.address = decode_jis_x0208(&tlv.value),
                0x18 => info.issue_date = String::from_utf8_lossy(&tlv.value).to_string(), // Date is ASCII
                0x21 => info.license_number = String::from_utf8_lossy(&tlv.value).to_string(), // Number is ASCII
                0x1B => info.expire_date = String::from_utf8_lossy(&tlv.value).to_string(), // Date is ASCII
                0x1A => info.color_class = decode_jis_x0208(&tlv.value),
                0x1C..=0x1F => {
                    let cond = decode_jis_x0208(&tlv.value);
                    if !cond.trim().is_empty() {
                        info.conditions.push(cond);
                    }
                }
                _ => {}
            }
        }
        Ok(info)
    }

    /// Read Registered Domicile (Honseki) - EF02
    /// Requires PIN 1 & PIN 2 verification.
    pub async fn read_registered_domicile(&mut self) -> Result<String> {
        self.select_dl_ap().await?; // Ensure DF1 is selected
        let raw = self.read_file(&file_ids::EF_HONSEKI).await?;
        // Parse TLV tag 0x41
        use crate::utils::{decode_jis_x0208, parse_jpdl_tlv};
        let tlvs = parse_jpdl_tlv(&raw).unwrap_or_default();
        for tlv in tlvs {
            if tlv.tag == 0x41 {
                return Ok(decode_jis_x0208(&tlv.value));
            }
        }
        Ok("".to_string())
    }

    /// Read Digital Signature (EF07)
    /// Requires PIN 1.
    pub async fn read_signature(&mut self) -> Result<Vec<u8>> {
        self.read_file(&file_ids::EF_SIGNATURE).await
    }

    /// Verify integrity AND authenticity using external Public Key.
    /// This verifies that EF07 contains a valid ECDSA signature over Hash(EF01)||Hash(EF02).
    pub async fn verify_signature(&mut self, pub_key_bytes: &[u8]) -> Result<bool> {
        use crate::crypto::verify_signature;
        use sha2::{Digest, Sha256};

        let sig_data = self.read_signature().await?;
        if sig_data.len() < 64 + 32 + 32 {
            // Expecting Hash(32) + Hash(32) + Sig(64) at least
            return Ok(false);
        }

        // Parse EF07 structure (Mock: Hash01 || Hash02 || Sig)
        let hash01_stored = &sig_data[0..32];
        let hash02_stored = &sig_data[32..64];
        let signature = &sig_data[64..];

        // 1. Verify Hashes match actual data
        let ef01 = self.read_file(&file_ids::EF_COMMON_DATA).await?;
        let ef02 = self.read_file(&file_ids::EF_HONSEKI).await?;

        let hash01_calc = Sha256::digest(&ef01);
        let hash02_calc = Sha256::digest(&ef02);

        if hash01_stored != hash01_calc.as_slice() || hash02_stored != hash02_calc.as_slice() {
            return Ok(false);
        }

        // 2. Verify Signature
        let mut signed_data = Vec::new();
        signed_data.extend_from_slice(hash01_stored);
        signed_data.extend_from_slice(hash02_stored);

        verify_signature(pub_key_bytes, &signed_data, signature)
            .map(|_| true)
            .map_err(|e| CivError::CryptoError(e.to_string()))
    }

    /// Verify integrity of EF01 and EF02 using EF07 signature (Hash check only).
    pub async fn verify_integrity(&mut self) -> Result<bool> {
        use sha2::{Digest, Sha256};

        let sig_data = self.read_signature().await?;
        if sig_data.is_empty() {
            return Ok(false);
        }

        let ef01 = self.read_file(&file_ids::EF_COMMON_DATA).await?;
        let ef02 = self.read_file(&file_ids::EF_HONSEKI).await?;

        let hash01 = Sha256::digest(&ef01);
        let hash02 = Sha256::digest(&ef02);

        // Simple containment check
        let found01 = sig_data.windows(32).any(|w| w == hash01.as_slice());
        let found02 = sig_data.windows(32).any(|w| w == hash02.as_slice());

        Ok(found01 && found02)
    }

    /// Read Face Photo (DF2/EF01) - JPEG2000
    /// Requires PIN 1 & PIN 2. Must select DF2 first.
    pub async fn read_photo(&mut self) -> Result<Vec<u8>> {
        self.select_dl_photo_ap().await?;
        self.read_ef_full(&[0x00, 0x01]).await
    }

    /// Read raw EF data (handling multiple reads if necessary)
    pub async fn read_ef_full(&mut self, ef_id: &[u8]) -> Result<Vec<u8>> {
        self.select_ef(ef_id).await?;

        let mut data = Vec::new();
        let mut offset = 0;

        loop {
            let p1 = (offset >> 8) as u8;
            let p2 = (offset & 0xFF) as u8;
            // READ BINARY: CLA=00, INS=B0, P1, P2, Le=00 (Short)
            let cmd = [0x00, 0xB0, p1, p2, 0x00];
            let res = self.reader.transmit(&cmd).await?;

            if res.len() < 2 {
                break;
            }

            let sw1 = res[res.len() - 2];
            let sw2 = res[res.len() - 1];
            let chunk = &res[..res.len() - 2];

            if chunk.is_empty() {
                break;
            }

            data.extend_from_slice(chunk);
            offset += chunk.len();

            if sw1 == 0x90 && sw2 == 0x00 {
                // If the EF is small, we are done
                if chunk.len() < 256 { break; }
            } else if sw1 == 0x6B {
                // Offset out of range
                break;
            } else {
                return Err(CivError::ApduError(sw1, sw2));
            }
            
            // Temporary: limit to avoid infinite loops in some cards
            if offset > 32768 { break; }
        }

        Ok(data)
    }

    /// Select an EF by ID
    async fn select_ef(&mut self, fid: &[u8]) -> Result<()> {
        let mut cmd = vec![0x00, 0xA4, 0x02, 0x0C, 0x02];
        cmd.extend_from_slice(fid);
        let res = self.reader.transmit(&cmd).await?;
        if res.len() < 2 { return Err(CivError::Unexpected("Response too short".to_string())); }
        let sw1 = res[res.len()-2];
        let sw2 = res[res.len()-1];
        if sw1 == 0x90 && sw2 == 0x00 { Ok(()) }
        else { Err(CivError::ApduError(sw1, sw2)) }
    }

    /// Helper to Select EF and Read Binary
    async fn read_file(&mut self, file_id: &[u8]) -> Result<Vec<u8>> {
        // 1. Select File
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(file_id);
        let res_sel = self.reader.transmit(&select.to_bytes()).await?;
        Self::check_sw(&res_sel)?;

        // 2. Read Binary Loop
        let mut data = Vec::new();
        let mut offset: u16 = 0;

        loop {
            let p1 = (offset >> 8) as u8;
            let p2 = (offset & 0xFF) as u8;

            // Le=00 means 256 bytes
            let read = ApduCommand::new(CLA_ISO, INS_READ_BINARY, p1, p2).with_le(0x00);

            let res = self.reader.transmit(&read.to_bytes()).await?;

            if res.len() < 2 {
                return Err(CivError::Communication("Response too short".to_string()));
            }

            let sw1 = res[res.len() - 2];
            let sw2 = res[res.len() - 1];
            let chunk = &res[0..res.len() - 2];

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
                return Err(CivError::from_sw(sw1, sw2));
            }
        }

        Ok(data)
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
impl<R: CardReader> IdentityController for DriversLicenseController<R> {
    async fn provide_pin(&mut self, pin_type: &str, pin: &str) -> Result<()> {
        match pin_type {
            "pin1" => self.pin1 = Some(pin.to_string()),
            "pin2" => self.pin2 = Some(pin.to_string()),
            _ => {
                return Err(CivError::InvalidData(format!(
                    "Unknown PIN type for JPDL: {}",
                    pin_type
                )))
            }
        }
        Ok(())
    }

    async fn verify(&mut self) -> Result<bool> {
        self.select_dl_ap().await?;
        if let Some(pin) = self.pin1.clone() {
            self.verify_pin1(&pin).await?;
        }
        let res = self.verify_integrity().await?;
        self.last_verified = res;
        Ok(res)
    }

    async fn read_identity(&mut self) -> Result<CitizenIdentity> {
        if let Some(pin) = self.pin1.clone() {
            self.select_dl_ap().await?;

            self.verify_pin1(&pin).await?;
        }

        let info = self.read_common_data().await?;

        let mut photo_data = None;

        // Try reading photo if PIN2 is available

        if let Some(pin2) = self.pin2.clone() {
            if self.select_dl_photo_ap().await.is_ok() && self.verify_pin2(&pin2).await.is_ok() {
                if let Ok(photo) = self.read_photo().await {
                    photo_data = Some(photo);
                }
            }

            // Re-select DL AP just in case

            let _ = self.select_dl_ap().await;
        }

        Ok(CitizenIdentity {
            full_name: info.name,

            surname: None,

            given_names: None,

            full_name_kana: Some(info.name_kana),

            address: Some(info.address),

            birth_date: info.birth_date,

            gender: "9".to_string(), // Gender not available in EF01 Common Data

            identity_number: info.license_number,

            card_type: "DriversLicense".to_string(),

            issuing_authority: Some("JPN".to_string()),

            expiration_date: Some(info.expire_date),

            photo_data,

            verified: false,

            attributes: std::collections::HashMap::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mock::{DriversLicenseBackend, MockSmartCard};
    use crate::test_utils::TestReader;
    use std::sync::{Arc, Mutex};

    fn setup_dl_mock(reader: &TestReader) -> Arc<Mutex<MockSmartCard>> {
        let mut mock = MockSmartCard::new();
        mock.add_backend(
            file_ids::DF_DL.to_vec(),
            Box::new(DriversLicenseBackend::new()),
        );
        mock.add_backend(
            file_ids::DF_DL_PHOTO.to_vec(),
            Box::new(DriversLicenseBackend::new()),
        );

        let mock = Arc::new(Mutex::new(mock));
        let mock_clone = mock.clone();
        reader.set_handler(move |apdu| mock_clone.lock().unwrap().handle_apdu(apdu));
        mock
    }

    #[tokio::test]
    async fn test_select_dl_ap() {
        let reader = TestReader::new();
        let _mock = setup_dl_mock(&reader);
        let mut controller = DriversLicenseController::new(reader.clone());
        let res = controller.select_dl_ap().await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn test_read_common_data_parsing() {
        let reader = TestReader::new();
        let _mock = setup_dl_mock(&reader);
        let mut controller = DriversLicenseController::new(reader.clone());

        assert!(controller.select_dl_ap().await.is_ok());
        assert!(controller.verify_pin1("123456").await.is_ok());

        let res = controller.read_common_data().await;
        assert!(res.is_ok());
        let info = res.unwrap();

        assert_eq!(info.name, "外民　他蝋");
        assert_eq!(info.color_class, "優良");
        assert_eq!(info.conditions.len(), 1);
        assert_eq!(info.conditions[0], "眼鏡等");
    }

    #[tokio::test]
    async fn test_read_photo() {
        let reader = TestReader::new();
        let _mock = setup_dl_mock(&reader);
        let mut controller = DriversLicenseController::new(reader.clone());

        assert!(controller.select_dl_photo_ap().await.is_ok());
        assert!(controller.verify_pin2("123456").await.is_ok());

        let res = controller.read_photo().await;
        assert!(res.is_ok());
        let _photo = res.unwrap();
    }

    #[tokio::test]
    async fn test_verify_pin_error() {
        let reader = TestReader::new();
        let _mock = setup_dl_mock(&reader);
        let mut controller = DriversLicenseController::new(reader.clone());
        assert!(controller.select_dl_ap().await.is_ok());

        let res = controller.verify_pin("0000", &file_ids::IEF_PIN1).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn test_verify_integrity() {
        let reader = TestReader::new();
        let _mock = setup_dl_mock(&reader);
        let mut controller = DriversLicenseController::new(reader.clone());
        assert!(controller.select_dl_ap().await.is_ok());
        assert!(controller.verify_pin1("123456").await.is_ok());

        let res = controller.verify_integrity().await;
        assert!(res.is_ok());
        assert!(res.unwrap());
    }

    #[tokio::test]
    async fn test_verify_integrity_failure() {
        let reader = TestReader::new();

        // Manual setup to access backend
        let mut backend = DriversLicenseBackend::new();
        backend.corrupt_data(); // Corrupt EF01

        let mut mock = MockSmartCard::new();
        mock.add_backend(file_ids::DF_DL.to_vec(), Box::new(backend));

        let mock_arc = Arc::new(Mutex::new(mock));
        let mock_clone = mock_arc.clone();
        reader.set_handler(move |apdu| mock_clone.lock().unwrap().handle_apdu(apdu));

        let mut controller = DriversLicenseController::new(reader.clone());
        assert!(controller.select_dl_ap().await.is_ok());
        assert!(controller.verify_pin1("123456").await.is_ok());

        let res = controller.verify_integrity().await;

        assert!(res.is_ok());

        assert!(!res.unwrap()); // Should be false
    }

    #[tokio::test]

    async fn test_verify_pin_error_extra() {
        let reader = TestReader::new();

        let _mock = setup_dl_mock(&reader);

        let mut controller = DriversLicenseController::new(reader.clone());

        assert!(controller.verify_pin1("wrong").await.is_err());
    }
}
