use wasm_bindgen::prelude::*;
use crate::jpki::JpkiController;
use crate::jpdl::DriversLicenseController;
use crate::jprc::ResidenceCardController;
use crate::passport::PassportController;
use crate::piv::PivController;
use crate::transport::WebUsbReader;
use crate::mock::MockSmartCard;
use crate::reader::CardReader;
use crate::models::IdentityController;
use std::sync::{Arc, Mutex};
use async_trait::async_trait;

// Enum to hold either a WebUSB reader or a Mock reader
#[derive(Clone)]
enum WasmReader {
    Web(Arc<Mutex<WebUsbReader>>),
    Mock(Arc<Mutex<MockSmartCard>>),
}

#[async_trait(?Send)]
impl CardReader for WasmReader {
    async fn transmit(&mut self, apdu: &[u8]) -> anyhow::Result<Vec<u8>> {
        match self {
            WasmReader::Web(r) => r.lock().unwrap().transmit(apdu).await,
            WasmReader::Mock(m) => Ok(m.lock().unwrap().handle_apdu(apdu)),
        }
    }
}

#[wasm_bindgen]
pub struct CivContext {
    reader: WasmReader,
}

#[wasm_bindgen]
impl CivContext {
    /// Initialize with a Mock Reader
    pub fn new_mock() -> Self {
        use crate::mock::*;
        use crate::apdu::file_ids as f;
        let mut mock = MockSmartCard::new();
        
        // JPKI
        mock.add_backend(f::DF_JPKI.to_vec(), Box::new(JpkiBackend::new()));
        mock.add_backend(f::DF_INPUT_SUPPORT.to_vec(), Box::new(JpkiBackend::new()));
        mock.add_backend(f::DF_SURFACE.to_vec(), Box::new(JpkiBackend::new()));
        
        // DL
        mock.add_backend(crate::jpdl::file_ids::DF_DL.to_vec(), Box::new(DriversLicenseBackend::new()));
        mock.add_backend(crate::jpdl::file_ids::DF_DL_PHOTO.to_vec(), Box::new(DriversLicenseBackend::new()));
        
        // RC
        mock.add_backend(crate::jprc::file_ids::DF1.to_vec(), Box::new(ResidenceCardBackend::new()));
        mock.add_backend(crate::jprc::file_ids::DF2.to_vec(), Box::new(ResidenceCardBackend::new()));
        
        // Passport
        mock.add_backend(crate::passport::file_ids::DF_ICAO.to_vec(), Box::new(PassportBackend::new("123456"))); // Default MRZ

        // PIV
        mock.add_backend(crate::piv::file_ids::DF_PIV.to_vec(), Box::new(PivBackend::new()));

        Self {
            reader: WasmReader::Mock(Arc::new(Mutex::new(mock))),
        }
    }

    /// Initialize with a JavaScript CardReader object
    /// The JS object must have a `transmit(apdu: Uint8Array): Promise<Uint8Array>` method.
    pub fn new_web(js_reader: JsValue) -> Self {
        Self {
            reader: WasmReader::Web(Arc::new(Mutex::new(WebUsbReader::new(js_reader)))),
        }
    }

    /// Read Identity
    /// card_type: "jpki", "dl", "rc", "passport", "piv"
    /// pin: PIN or MRZ
    pub async fn read_identity(&mut self, card_type: &str, pin: &str) -> Result<JsValue, JsValue> {
        let mut controller: Box<dyn IdentityController> = match card_type {
            "jpki" => Box::new(JpkiController::new(self.reader.clone())),
            "dl" => Box::new(DriversLicenseController::new(self.reader.clone())),
            "rc" => Box::new(ResidenceCardController::new(self.reader.clone())),
            "passport" => Box::new(PassportController::new(self.reader.clone())),
            "piv" => Box::new(PivController::new(self.reader.clone())),
            _ => return Err(JsValue::from_str("Unknown card type")),
        };

        // Provide PIN based on type
        // TODO: More granular PIN types support in Wasm
        if card_type == "passport" {
            controller.provide_pin("mrz", pin).await.map_err(|e| JsValue::from_str(&e.to_string()))?;
        } else if card_type == "dl" {
            controller.provide_pin("pin1", pin).await.map_err(|e| JsValue::from_str(&e.to_string()))?;
        } else if card_type == "jpki" {
            controller.provide_pin("auth", pin).await.map_err(|e| JsValue::from_str(&e.to_string()))?;
        } else {
            controller.provide_pin("pin", pin).await.map_err(|e| JsValue::from_str(&e.to_string()))?;
        }

        let identity = controller.read_identity().await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        serde_wasm_bindgen::to_value(&identity)
            .map_err(|e| JsValue::from_str("Serialization failed"))
    }
}
