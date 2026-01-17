use crate::apdu::ApduCommand;
use crate::errors::{CivError, Result};
use crate::models::{CitizenIdentity, IdentityController};
use crate::reader::CardReader;
use async_trait::async_trait;
use std::sync::{Arc, Mutex};

/// US PIV (NIST SP 800-73) Application Controller
pub struct PivController<R: CardReader> {
    reader: R,
    pin: Option<String>,
    last_verified: bool,
}

pub mod file_ids {
    /// PIV Application AID
    pub const AID_PIV: [u8; 11] = [0xA0, 0x00, 0x00, 0x03, 0x08, 0x00, 0x00, 0x10, 0x00, 0x01, 0x00];
    /// Alias for mock
    pub const DF_PIV: [u8; 11] = AID_PIV;
    
    /// Data Objects
    pub const OBJ_CHUID: [u8; 3] = [0x5F, 0xC1, 0x02];
    pub const OBJ_CERT_AUTH: [u8; 3] = [0x5F, 0xC1, 0x05];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyReference {
    ApplicationPin = 0x80,
    CardAuthentication = 0x9E,
}

impl<R: CardReader> PivController<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            pin: None,
            last_verified: false,
        }
    }

    pub async fn select_piv_ap(&mut self) -> Result<()> {
        let apdu = ApduCommand::new(0x00, 0xA4, 0x04, 0x00).with_data(&file_ids::AID_PIV);
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    pub async fn verify_pin(&mut self, pin: &str) -> Result<()> {
        let mut pin_data = pin.as_bytes().to_vec();
        while pin_data.len() < 8 {
            pin_data.push(0xFF);
        }
        let apdu = ApduCommand::new(0x00, 0x20, 0x00, 0x80).with_data(&pin_data);
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    pub async fn read_data_object(&mut self, obj_id: &[u8]) -> Result<Vec<u8>> {
        let mut data = vec![0x5C, obj_id.len() as u8];
        data.extend_from_slice(obj_id);
        
        let apdu = ApduCommand::new(0x00, 0xCB, 0x3F, 0xFF).with_data(&data).with_le(0x00);
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)?;
        Ok(res[0..res.len()-2].to_vec())
    }

    fn check_sw(res: &[u8]) -> Result<()> {
        if res.len() < 2 { return Err(CivError::Communication("Too short".to_string())); }
        let (sw1, sw2) = (res[res.len()-2], res[res.len()-1]);
        if sw1 == 0x90 && sw2 == 0x00 { Ok(()) } else { Err(CivError::from_sw(sw1, sw2)) }
    }
}

#[async_trait]
impl<R: CardReader + Send> IdentityController for PivController<R> {
    async fn provide_pin(&mut self, _pin_type: &str, pin: &str) -> Result<()> {
        self.pin = Some(pin.to_string());
        self.select_piv_ap().await?;
        self.verify_pin(pin).await?;
        Ok(())
    }

    async fn verify(&mut self) -> Result<bool> {
        self.last_verified = true;
        Ok(true)
    }

    async fn read_identity(&mut self) -> Result<CitizenIdentity> {
        self.select_piv_ap().await?;
        let chuid = self.read_data_object(&file_ids::OBJ_CHUID).await?;
        
        Ok(CitizenIdentity {
            full_name: "PIV HOLDER".to_string(),
            card_type: "PIV".to_string(),
            identity_number: hex::encode(&chuid),
            verified: self.last_verified,
            ..Default::default()
        })
    }
}

#[cfg(feature = "mock")]
pub struct MockRelayReader {
    pub card: Arc<Mutex<crate::mock::MockSmartCard>>,
}

#[cfg(feature = "mock")]
#[async_trait]
impl CardReader for MockRelayReader {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        Ok(self.card.lock().unwrap().handle_apdu(apdu))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::TestReader;

    #[tokio::test]
    async fn test_piv_flow() {
        let reader = TestReader::new();
        // provide_pin sequence: select_piv_ap -> verify_pin
        reader.push_response(&[0x90, 0x00]); 
        reader.push_response(&[0x90, 0x00]); 
        
        // read_identity sequence: select_piv_ap -> read_data_object
        reader.push_response(&[0x90, 0x00]); 
        reader.push_response(&[0x53, 0x02, 0x01, 0x02, 0x90, 0x00]); 
        
        let mut controller: PivController<TestReader> = PivController::new(reader.clone());
        controller.provide_pin("piv", "123456").await.unwrap();
        let res = controller.read_identity().await;
        assert!(res.is_ok());
    }
}