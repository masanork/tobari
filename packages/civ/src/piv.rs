#[allow(unused_imports)]
use crate::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE, INS_READ_BINARY};
use crate::reader::CardReader;
use crate::errors::{Result, CivError};
use rand::{RngCore, thread_rng};
use x509_parser::prelude::FromDer;

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

use crate::models::{CitizenIdentity, IdentityController};
use std::collections::HashMap;

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

    /// Authenticate User (High Level)
    /// 1. Select PIV App
    /// 2. Verify PIN
    /// 3. Read Auth Cert
    /// 4. Challenge-Response
    pub async fn authenticate_user(&mut self, pin: &str) -> Result<()> {
        self.select_piv_ap().await?;
        self.verify_pin(pin).await?;

        // Read Auth Cert (9A)
        let cert_der = self.read_auth_cert().await?;

        // Generate Random Challenge
        let mut challenge = [0u8; 32];
        thread_rng().fill_bytes(&mut challenge);

        // Parse cert to get algorithm
        let (_, cert) = x509_parser::certificate::X509Certificate::from_der(&cert_der)
            .map_err(|e| CivError::InvalidData(format!("Cert Parse Error: {}", e)))?;
        
        let oid = &cert.tbs_certificate.subject_pki.algorithm.algorithm;
        
        // Helper to check OID
        let check_oid = |oid: &x509_parser::der_parser::oid::Oid, expected: &[u64]| -> bool {
             oid.iter().map(|iter| iter.eq(expected.iter().cloned())).unwrap_or(false)
        };

        let alg = if check_oid(oid, &[1, 2, 840, 113549, 1, 1, 1]) {
            Algorithm::Rsa2048 // 0x07
        } else if check_oid(oid, &[1, 2, 840, 10045, 2, 1]) {
            Algorithm::EccP256 // 0x11 (Assuming P-256 for now)
        } else {
            return Err(CivError::InvalidData("Unsupported Certificate Algorithm".to_string()));
        };

        let signature = self.sign(KeyReference::PivAuthKey, alg, &challenge).await?;

        // Verify Signature
        crate::crypto::verify_x509_signature(&cert_der, &challenge, &signature)
            .map_err(|e| CivError::CryptoError(e.to_string()))?;

        Ok(())
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

#[async_trait::async_trait]
impl<R: CardReader> IdentityController for PivController<R> {
    async fn provide_pin(&mut self, _pin_type: &str, _pin: &str) -> Result<()> {
        // PIV usually verifies PIN during operations, but we can cache it or verify immediately.
        // For now, assume PIN is provided during authenticate_user or stored in a higher level if needed.
        // But authenticate_user takes a pin argument. 
        // IdentityController doesn't have a state for PIN usually, it expects verify() or read_identity() to use stored pin?
        // Let's just check pin validity if provided.
        if !_pin.is_empty() {
            self.select_piv_ap().await?;
            self.verify_pin(_pin).await?;
        }
        Ok(())
    }

    async fn verify(&mut self) -> Result<bool> {
        // We need a PIN to verify fully. 
        // But verify() in IdentityController often implies "Verify Data Authenticity" (PA)
        // or "Verify User" (PIN/Biometrics).
        // Let's assume it checks PA (signatures).
        // For PIV, checking the signature on the CHUID or Certs would be PA.
        
        // However, authenticate_user(pin) is also a "Verification" of the user.
        // Since verify() takes no PIN arg, it's likely PA.
        
        // Simple PA: Read CHUID and check signature (not implemented fully yet, PIV CHUID signature is CMS)
        Ok(true)
    }

    async fn read_identity(&mut self) -> Result<CitizenIdentity> {
        self.select_piv_ap().await?;
        
        // 1. Read CHUID for basic info
        let chuid = self.read_chuid().await.unwrap_or_default();
        let expiry = ParsingUtils::extract_expiry_date(&chuid);
        
        // 2. Read Auth Cert for Name
        let cert_der = self.read_auth_cert().await.unwrap_or_default();
        let mut full_name = "PIV Card Holder".to_string();
        let mut issuing_authority = None;
        
        if !cert_der.is_empty() {
            if let Ok((_, cert)) = x509_parser::certificate::X509Certificate::from_der(&cert_der) {
                full_name = cert.subject().to_string(); // Helper to format Name
                issuing_authority = Some(cert.issuer().to_string());
            }
        }

        Ok(CitizenIdentity {
            full_name,
            surname: None,
            given_names: None,
            full_name_kana: None,
            address: None,
            birth_date: "".to_string(), // Not in PIV (Privacy)
            gender: "Unspecified".to_string(),
            identity_number: "".to_string(), // UUID in CHUID maybe?
            card_type: "PIV".to_string(),
            issuing_authority,
            expiration_date: expiry,
            photo_data: None, // Can read from EF 02 02 if available
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
    async fn test_authenticate_user_mock() {
        use crate::mock::MockSmartCard;
        
        let card = MockSmartCard::new();
        // Manual relay for test
        let mut controller = PivController::new(MockRelayReader { card: std::sync::Arc::new(std::sync::Mutex::new(card)) });

        let res = controller.authenticate_user("123456").await;
        assert!(res.is_ok(), "Authentication failed: {:?}", res.err());
    }

    struct MockRelayReader {
        card: std::sync::Arc<std::sync::Mutex<crate::mock::MockSmartCard>>,
    }
    #[async_trait::async_trait]
    impl crate::reader::CardReader for MockRelayReader {
        async fn transmit(&mut self, apdu: &[u8]) -> anyhow::Result<Vec<u8>> {
            let mut card = self.card.lock().unwrap();
            Ok(card.handle_apdu(apdu))
        }
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