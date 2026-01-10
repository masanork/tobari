use civ::mock::MockSmartCard;
use civ::reader::CardReader;
use civ::IdentityController;
use civ::JpkiController;
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
async fn test_jpki_unified_photo() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut controller = JpkiController::new(MockRelay { card });

    // Set PINs
    controller.provide_pin("auth", "1234").await.unwrap();
    
    // Read Identity
    let identity = controller.read_identity().await.unwrap();
    
    assert_eq!(identity.full_name, "Taro");
    // Photo should be present in Mock
    assert!(identity.photo_data.is_some());
    assert_eq!(identity.photo_data.unwrap(), vec![0xAA, 0xBB, 0xCC]);
}

#[tokio::test]
async fn test_passport_unified_photo() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut controller = civ::PassportController::new(MockRelay { card });

    // Set MRZ
    controller.provide_pin("mrz", "123456").await.unwrap();
    
    let identity = controller.read_identity().await.unwrap();
    assert!(identity.photo_data.is_some());
    // Mock Passport DG2 content is defined in generate_mock_sod? No, read_dg2 uses read_file.
    // Let's check PassportBackend::new in mock/passport.rs
}
