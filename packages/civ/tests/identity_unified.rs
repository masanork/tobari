use civ::mock::MockSmartCard;
use civ::reader::CardReader;
use civ::test_utils::TestReader;
use civ::models::IdentityController;
use civ::jpki::JpkiController;
use civ::mykad::MyKadController;
use civ::passport::PassportController;
use civ::jprc::ResidenceCardController;
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
async fn test_failure_paths_all_cards() {
    let reader = TestReader::new();
    reader.set_failure(0x6A, 0x82); // Application not found

    // JPKI
    let mut c: JpkiController<TestReader> = JpkiController::new(reader.clone());
    assert!(c.read_identity().await.is_err());

    // Passport
    let mut c: PassportController<TestReader> = PassportController::new(reader.clone());
    assert!(c.read_identity().await.is_err());

    // Thai
    let mut c: ThaiController<TestReader> = ThaiController::new(reader.clone());
    assert!(c.read_identity().await.is_err());

    // MyKad
    let mut c: MyKadController<TestReader> = MyKadController::new(reader.clone());
    assert!(c.read_identity().await.is_err());

    // RC
    let mut c: ResidenceCardController<TestReader> = ResidenceCardController::new(reader.clone());
    assert!(c.read_identity().await.is_err());
}

#[tokio::test]
async fn test_jpki_unified_photo() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut controller: JpkiController<MockRelay> = JpkiController::new(MockRelay { card });

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
    let mut controller: PassportController<MockRelay> = PassportController::new(MockRelay { card });

    // Set MRZ
    controller.provide_pin("mrz", "123456").await.unwrap();

    let identity = controller.read_identity().await.unwrap();
    assert!(identity.photo_data.is_some());
}

#[tokio::test]
async fn test_thai_unified() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut controller: ThaiController<MockRelay> = ThaiController::new(MockRelay { card });

    let identity = controller.read_identity().await.unwrap();
    assert_eq!(identity.card_type, "ThaiID");
    assert!(identity.full_name.contains("Somchai"));
    assert_eq!(identity.gender, "1");
}

#[tokio::test]
async fn test_mykad_unified() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut controller: MyKadController<MockRelay> = MyKadController::new(MockRelay { card });

    let identity = controller.read_identity().await.unwrap();
    assert_eq!(identity.card_type, "MyKad");
    // Mock data check (from mock/mykad.rs)
    assert!(identity.full_name.contains("ALI BIN ABU"));
    assert_eq!(identity.identity_number, "800101141234");
    assert_eq!(identity.birth_date, "1980-01-01");
    // Photo reading not yet implemented for MyKad
    assert!(identity.photo_data.is_none());
    assert_eq!(identity.gender, "Male");
}

#[tokio::test]
async fn test_jprc_unified_details() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut controller: ResidenceCardController<MockRelay> = ResidenceCardController::new(MockRelay { card });

    let identity = controller.read_identity().await.unwrap();
    assert_eq!(identity.card_type, "ResidenceCard");
    assert_eq!(identity.address.unwrap(), "東京都");
    // Check attributes
    assert_eq!(identity.attributes.get("residence_status").unwrap(), "許可");
    assert_eq!(identity.attributes.get("update_status").unwrap(), "0");

    // Photo reading
    let photo = controller.read_photo().await.unwrap();
    assert!(!photo.is_empty());
}

#[tokio::test]
async fn test_mykad_read_failure() {
    struct ErrorRelay;
    #[async_trait::async_trait]
    impl CardReader for ErrorRelay {
        async fn transmit(&mut self, _apdu: &[u8]) -> Result<Vec<u8>, CivError> {
            Ok(vec![0x6F, 0x00])
        }
    }

    let mut controller: MyKadController<ErrorRelay> = MyKadController::new(ErrorRelay);
    let res = controller.read_identity().await;
    assert!(res.is_err());
}

#[tokio::test]
async fn test_mykad_address_full() {
    let card = Arc::new(Mutex::new(MockSmartCard::new()));
    let mut controller: MyKadController<MockRelay> = MyKadController::new(MockRelay { card });

    controller.select_jpn_ap().await.unwrap();
    // Read Line 1
    let addr = controller.read_info(0x0111, 0x0203, 30).await.unwrap();
    assert!(String::from_utf8_lossy(&addr).contains("123 Jalan Ampang"));
}