use civ::apdu::ApduCommand;
use civ::reader::CardReader;
use civ::mock::MockSmartCard;
use std::sync::{Arc, Mutex};

// Manual implementation of Reader for Mock
struct MockRelay {
    card: Arc<Mutex<MockSmartCard>>,
}

#[async_trait::async_trait]
impl CardReader for MockRelay {
    async fn transmit(&mut self, apdu: &[u8]) -> anyhow::Result<Vec<u8>> {
        Ok(self.card.lock().unwrap().handle_apdu(apdu))
    }
}

#[tokio::test]
async fn test_extended_apdu_echo() {
    // 1. Setup Mock with LargeDataBackend
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut reader = MockRelay { card };

    // 2. Select LargeDataBackend (A0 00 00 00 00 01)
    let select = ApduCommand::new(0x00, 0xA4, 0x04, 0x00)
        .with_data(&[0xA0, 0x00, 0x00, 0x00, 0x00, 0x01]);
    let res = reader.transmit(&select.to_bytes()).await.unwrap();
    assert_eq!(res, vec![0x90, 0x00]);

    // 3. Send Large Data (4KB)
    // Case 3E or 4E
    let payload = vec![0xEEu8; 4096];
    let echo = ApduCommand::new(0x00, 0x10, 0x00, 0x00)
        .with_data(&payload);
    
    // 4. Transmit and Verify
    let res = reader.transmit(&echo.to_bytes()).await.unwrap();
    
    // Expect: payload + 90 00
    assert_eq!(res.len(), 4096 + 2);
    assert_eq!(&res[0..4096], &payload[..]);
    assert_eq!(&res[4096..], &[0x90, 0x00]);
}

#[tokio::test]
async fn test_extended_apdu_large_response() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut reader = MockRelay { card };

    // Select
    let select = ApduCommand::new(0x00, 0xA4, 0x04, 0x00)
        .with_data(&[0xA0, 0x00, 0x00, 0x00, 0x00, 0x01]);
    reader.transmit(&select.to_bytes()).await.unwrap();

    // Request 3000 bytes response (0x0BB8)
    // Case 2E or 4E
    let req = ApduCommand::new(0x00, 0x11, 0x0B, 0xB8) // P1=0B P2=B8
        .with_le(3000); // 3000 expected
        
    let res = reader.transmit(&req.to_bytes()).await.unwrap();
    
    assert_eq!(res.len(), 3000 + 2);
    assert_eq!(&res[0..3000], &[0xABu8; 3000][..]);
    assert_eq!(&res[3000..], &[0x90, 0x00]);
}
