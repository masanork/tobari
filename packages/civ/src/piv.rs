#[allow(unused_imports)]
use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY};
use crate::reader::CardReader;
use crate::errors::{Result, CivError};

/// US PIV (Personal Identity Verification) Controller
/// Based on NIST SP 800-73-5
pub struct PivController<R: CardReader> {
    reader: R,
}

pub mod file_ids {
    /// PIV Card Application AID
    /// A0 00 00 03 08 00 00 10 00 01 00
    pub const DF_PIV: [u8; 11] = [
        0xA0, 0x00, 0x00, 0x03, 0x08, 0x00, 0x00, 0x10, 0x00, 0x01, 0x00
    ];

    /// Card Capability Container (CCC)
    /// Tag: 0xDB00
    pub const EF_CCC: [u8; 3] = [0xDB, 0x00, 0x00]; // Often accessed via GET DATA

    /// Card Holder Unique Identifier (CHUID)
    /// Tag: 0x3000
    /// Object ID: 5FC102
    pub const EF_CHUID: [u8; 3] = [0x30, 0x00, 0x00]; 

    // Data Object Tags (for GET DATA)
    pub const TAG_CHUID: [u8; 3] = [0x5F, 0xC1, 0x02];
    pub const TAG_AUTH_CERT: [u8; 3] = [0x5F, 0xC1, 0x05];
    pub const TAG_SIGN_CERT: [u8; 3] = [0x5F, 0xC1, 0x0A];
    pub const TAG_KEY_MGMT_CERT: [u8; 3] = [0x5F, 0xC1, 0x0B];
    pub const TAG_CARD_AUTH_CERT: [u8; 3] = [0x5F, 0xC1, 0x01]; // X.509 Certificate for Card Authentication
    pub const TAG_SECURITY_OBJECT: [u8; 3] = [0x5F, 0xC1, 0x06];
    pub const TAG_DISCOVERY_OBJECT: [u8; 3] = [0x5F, 0xC1, 0x07];
}

#[derive(Debug, Clone, Copy)]
pub enum Algorithm {
    TripleDes = 0x03,
    Rsa2048 = 0x07,
    EccP256 = 0x11,
    EccP384 = 0x14,
}

#[derive(Debug, Clone, Copy)]
pub enum KeyReference {
    GlobalPin = 0x00,
    PivCardApplicationPin = 0x80,
    PivCardApplicationGlobalPin = 0x96, // Primary PIN
    PivCardApplicationPinRetry = 0x97, // PIN Retry Count
    PivAuthKey = 0x9A,
    PivSignKey = 0x9C,
    PivKeyMgmtKey = 0x9D,
    PivCardAuthKey = 0x9E,
}

impl<R: CardReader> PivController<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }

    /// Select PIV Application
    pub async fn select_piv_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
            .with_data(&file_ids::DF_PIV);
        
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    /// Verify PIN (verify against PIV Card Application PIN 0x80)
    pub async fn verify_pin(&mut self, pin: &str) -> Result<()> {
        let mut pin_bytes = pin.as_bytes().to_vec();
        // PIV PIN is usually 6-8 digits, padded with 0xFF to 8 bytes if needed used in some cards?
        // NIST SP 800-73-5 Part 2 says: "If the PIN is less than 8 bytes, the PIN shall be padded with 0xFF bytes to the right."
        while pin_bytes.len() < 8 {
            pin_bytes.push(0xFF);
        }

        let apdu = ApduCommand::new(CLA_ISO, 0x20, 0x00, KeyReference::PivCardApplicationPin as u8)
            .with_data(&pin_bytes);

        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    /// General Authenticate
    /// Used for cryptographic operations (Sign, Decrypt, Challenge-Response)
    pub async fn general_authenticate(
        &mut self,
        alg: Algorithm,
        key_ref: KeyReference,
        payload: &[u8],
        _is_sign: bool, // true for SIGN (Internal Authenticate), false for Decrypt/External
    ) -> Result<Vec<u8>> {
        let mut data = Vec::new();
        // 7C Tag
        data.push(0x7C);
        
        let mut template_content = Vec::new();
        
        // Tag 82 (Response) - Empty to indicate we want a result
        template_content.push(0x82);
        template_content.push(0x00);

        // Tag 81 (Challenge / Data input)
        template_content.push(0x81);
        if payload.len() > 255 {
             return Err(CivError::InvalidData("Payload too large for simple encoder".to_string()));
        }
        template_content.push(payload.len() as u8);
        template_content.extend_from_slice(payload);

        // Encode 7C length
        data.push(template_content.len() as u8); 
        data.extend(template_content);

        let apdu = ApduCommand::new(0x00, 0x87, alg as u8, key_ref as u8)
            .with_data(&data);

        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)?;

        // Parse Response
        // Expect: 7C L 82 L { Data }
        if res.len() > 4 && res[0] == 0x7C {
            let mut i = 2; // skip 7C L
            while i < res.len() - 2 { // -2 for SW
                if res[i] == 0x82 {
                    let len = res[i+1] as usize;
                    if i + 2 + len <= res.len() - 2 {
                        return Ok(res[i+2..i+2+len].to_vec());
                    }
                }
                i += 1;
            }
        }
        
        Ok(res[0..res.len()-2].to_vec()) // Fallback
    }

    /// Read CHUID (Card Holder Unique Identifier)
    pub async fn read_chuid(&mut self) -> Result<Vec<u8>> {
        let tag_data = [0x5C, 0x03, 0x5F, 0xC1, 0x02];
        self.get_data(&tag_data).await
    }

    /// Read PIV Authentication Certificate (X.509)
    pub async fn read_auth_cert(&mut self) -> Result<Vec<u8>> {
         let tag_data = [0x5C, 0x03, 0x5F, 0xC1, 0x05];
         self.get_data(&tag_data).await
    }

    /// Read Certificate by Key Reference
    pub async fn read_cert(&mut self, key_ref: KeyReference) -> Result<Vec<u8>> {
        let tag = match key_ref {
            KeyReference::PivAuthKey => file_ids::TAG_AUTH_CERT,
            KeyReference::PivSignKey => file_ids::TAG_SIGN_CERT,
            KeyReference::PivKeyMgmtKey => file_ids::TAG_KEY_MGMT_CERT,
            KeyReference::PivCardAuthKey => file_ids::TAG_CARD_AUTH_CERT,
            _ => return Err(CivError::InvalidData("Invalid Key Reference for Certificate".to_string())),
        };
        let mut tag_data = vec![0x5C, 0x03];
        tag_data.extend_from_slice(&tag);
        
        self.get_data(&tag_data).await
    }

    /// Sign data
    pub async fn sign(&mut self, key_ref: KeyReference, alg: Algorithm, data: &[u8]) -> Result<Vec<u8>> {
        self.general_authenticate(alg, key_ref, data, true).await
    }

    /// Generic PIV GET DATA
    async fn get_data(&mut self, tag_data: &[u8]) -> Result<Vec<u8>> {
        let apdu = ApduCommand::new(CLA_ISO, 0xCB, 0x3F, 0xFF)
            .with_data(tag_data);

        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)?;
        
        if res.len() >= 2 {
            Ok(res[0..res.len()-2].to_vec())
        } else {
            Err(CivError::Communication("Response too short".to_string()))
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestReader;

    #[tokio::test]
    async fn test_select_piv_ap() {
        let reader = TestReader::new();
        let mut controller = PivController::new(reader.clone());
        reader.push_response(&[0x90, 0x00]);

        let res = controller.select_piv_ap().await;
        assert!(res.is_ok());

        let apdus = reader.sent_apdus.lock().unwrap();
        assert_eq!(apdus.len(), 1);
        assert_eq!(apdus[0][1], 0xA4); // SELECT
        assert_eq!(&apdus[0][5..], &file_ids::DF_PIV);
    }

    #[tokio::test]
    async fn test_verify_pin_padding() {
        let reader = TestReader::new();
        let mut controller = PivController::new(reader.clone());
        reader.push_response(&[0x90, 0x00]);

        let res = controller.verify_pin("123456").await;
        assert!(res.is_ok());

        let apdus = reader.sent_apdus.lock().unwrap();
        let expected_data = [b'1', b'2', b'3', b'4', b'5', b'6', 0xFF, 0xFF];
        assert_eq!(&apdus[0][5..13], &expected_data);
    }

    #[tokio::test]
    async fn test_get_data_chuid() {
        let reader = TestReader::new();
        let mut controller = PivController::new(reader.clone());
        let mock_chuid = vec![0x53, 0x03, 0x01, 0x02, 0x03, 0x90, 0x00];
        reader.push_response(&mock_chuid);

        let res = controller.read_chuid().await;
        assert!(res.is_ok());
        assert_eq!(res.unwrap(), vec![0x53, 0x03, 0x01, 0x02, 0x03]);

        let apdus = reader.sent_apdus.lock().unwrap();
        assert_eq!(apdus[0][1], 0xCB); // GET DATA
    }

    #[tokio::test]
    async fn test_sign_template() {
        let reader = TestReader::new();
        let mut controller = PivController::new(reader.clone());
        reader.push_response(&[0x7C, 0x05, 0x82, 0x03, 0xAA, 0xBB, 0xCC, 0x90, 0x00]);

        let dummy_hash = [0x11; 32];
        let res = controller.sign(KeyReference::PivSignKey, Algorithm::EccP256, &dummy_hash).await;
        
        assert!(res.is_ok());
        assert_eq!(res.unwrap(), vec![0xAA, 0xBB, 0xCC]);

        let apdus = reader.sent_apdus.lock().unwrap();
        assert_eq!(apdus[0][1], 0x87); // GENERAL AUTH
        let data = &apdus[0][5..];
        assert_eq!(data[0], 0x7C);
        assert!(data.iter().any(|&b| b == 0x81)); // Challenge tag
        assert!(data.iter().any(|&b| b == 0x82)); // Response tag
    }
}

pub struct ParsingUtils;
impl ParsingUtils {
    pub fn extract_expiry_date(chuid: &[u8]) -> Option<String> {
        let mut i = 0;
        while i < chuid.len() - 5 {
             if chuid[i] == 0x35 && chuid[i+1] == 0x08 {
                  let date_bytes = &chuid[i+2..i+10];
                  return Some(String::from_utf8_lossy(date_bytes).to_string());
             }
             i += 1;
        }
        None
    }
}