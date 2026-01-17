use civ::mock::jpdl::DriversLicenseBackend;
use civ::mock::MockSmartCard;
use civ::reader::CardReader;
use civ::jpdl::DriversLicenseController;
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
async fn test_jpdl_signature_verification() {
    // 1. Setup Mock Backend with dynamic key
    let mut backend = DriversLicenseBackend::new();
    let pub_key = backend.get_public_key_bytes();

    let mut card = MockSmartCard::new();
    // Overwrite default DL backend with our instance
    card.add_backend(civ::jpdl::file_ids::DF_DL.to_vec(), Box::new(backend));

    let relay = MockRelay {
        card: Arc::new(Mutex::new(card)),
    };
    let mut controller: DriversLicenseController<MockRelay> = DriversLicenseController::new(relay);

    // 2. Perform verification
    controller.select_dl_ap().await.unwrap();
    controller.verify_pin1("123456").await.unwrap();

    // 3. Verify Signature using the extracted public key
    let valid = controller.verify_signature(&pub_key).await.unwrap();
    assert!(valid, "Signature verification failed");
}

#[tokio::test]
async fn test_jpdl_signature_verification_failure() {
    let mut backend = DriversLicenseBackend::new();
    let pub_key = backend.get_public_key_bytes();

    // Tamper data
    backend.corrupt_data();

    let mut card = MockSmartCard::new();
    card.add_backend(civ::jpdl::file_ids::DF_DL.to_vec(), Box::new(backend));

    let relay = MockRelay {
        card: Arc::new(Mutex::new(card)),
    };
    let mut controller: DriversLicenseController<MockRelay> = DriversLicenseController::new(relay);

    controller.select_dl_ap().await.unwrap();
    controller.verify_pin1("123456").await.unwrap();

    // Should fail because hash mismatch (and signature over hash mismatch)
    let valid = controller.verify_signature(&pub_key).await.unwrap();
    assert!(
        !valid,
        "Signature verification should fail on tampered data"
    );
}