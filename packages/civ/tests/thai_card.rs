use civ::mock::MockSmartCard;
use civ::reader::CardReader;
use civ::test_utils::TestReader;
use civ::models::IdentityController;
use civ::thai::ThaiController;
use civ::errors::CivError;
use std::sync::{Arc, Mutex};

struct MockRelay {
    card: Arc<Mutex<MockSmartCard>>,
}

#[async_trait::async_trait]
impl CardReader for MockRelay {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>, CivError> {
        Ok(self.card.lock().unwrap().handle_apdu(apdu))
    }
}

#[tokio::test]
async fn test_thai_read_identity() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut controller: ThaiController<MockRelay> = ThaiController::new(MockRelay { card });

    let identity = controller.read_identity().await.unwrap();
    assert_eq!(identity.card_type, "ThaiID");
    assert!(identity.full_name.contains("Somchai"));
    // BE 2533 -> AD 1990
    assert_eq!(identity.birth_date, "1990-01-01");
    assert_eq!(identity.gender, "1");
}

#[tokio::test]
async fn test_thai_read_identity_failure_at_cid() {
    let reader = TestReader::new();
    let mut controller: ThaiController<TestReader> = ThaiController::new(reader.clone());

    // Succeed at select, fail at read_data (cid)
    reader.push_response(&[0x90, 0x00]); // select ap
    reader.set_failure(0x6A, 0x82);

    let res = controller.read_identity().await;
    assert!(res.is_err());
}

#[tokio::test]
async fn test_thai_read_raw_data() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut controller: ThaiController<MockRelay> = ThaiController::new(MockRelay { card });

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
    card.add_backend(
        vec![0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01],
        Box::new(backend),
    );

    let relay = MockRelay {
        card: Arc::new(Mutex::new(card)),
    };
    let mut controller: ThaiController<MockRelay> = ThaiController::new(relay);

    controller.select_thai_ap().await.unwrap();

    let cid = controller.read_data(0x0004, 13).await.unwrap();
    assert_eq!(cid, b"1234567890123");
}

#[tokio::test]
async fn test_thai_selection_failure() {
    struct ErrorRelay;
    #[async_trait::async_trait]
    impl CardReader for ErrorRelay {
        async fn transmit(&mut self, _apdu: &[u8]) -> Result<Vec<u8>, CivError> {
            Ok(vec![0x6A, 0x82])
        }
    }

    let mut controller: ThaiController<ErrorRelay> = ThaiController::new(ErrorRelay);
    assert!(controller.select_thai_ap().await.is_err());
}