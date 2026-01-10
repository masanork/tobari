use civ::mock::MockSmartCard;
use civ::reader::CardReader;
use civ::ThaiController;
use civ::IdentityController;
use std::sync::{Arc, Mutex};

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
async fn test_thai_read_identity() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut controller = ThaiController::new(MockRelay { card });

    let identity = controller.read_identity().await.unwrap();
    
    assert_eq!(identity.card_type, "ThaiID");
    assert_eq!(identity.identity_number, "1234567890123");
    // Should be TIS-620 decoded
    assert!(identity.full_name.contains("สม"));
    
    let en_name = identity.attributes.get("full_name_en");
    assert!(en_name.is_some());
    assert_eq!(en_name.unwrap(), "Somchai Mankong");
    
    // BE 2533 -> AD 1990
    assert_eq!(identity.birth_date, "1990-01-01");
}

#[tokio::test]
async fn test_thai_read_raw_data() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut controller = ThaiController::new(MockRelay { card });
    
    controller.select_thai_ap().await.unwrap();
    
    // Read CID directly
    let cid = controller.read_data(0x0004, 13).await.unwrap();
    assert_eq!(cid, b"1234567890123");
}

#[tokio::test]
async fn test_thai_read_data_retry() {
    let mut backend = civ::mock::thai::ThaiBackend::new();
    backend.fail_once = true; // Trigger retry logic in controller
    
    let mut card = MockSmartCard::new();
    card.add_backend(civ::thai::file_ids::DF_THAI.to_vec(), Box::new(backend));
    
    let relay = MockRelay { card: Arc::new(Mutex::new(card)) };
    let mut controller = ThaiController::new(relay);
    
    controller.select_thai_ap().await.unwrap();
    
    // This should trigger retry because the first response will be too short
    let cid = controller.read_data(0x0004, 13).await.unwrap();
    assert_eq!(cid, b"1234567890123");
}
