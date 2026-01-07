use wasm_bindgen::prelude::*;
use crate::jpki::JpkiController;
use crate::transport::WebUsbReader;

#[wasm_bindgen]
pub struct WasmJpkiController {
    inner: JpkiController<WebUsbReader>,
}

#[wasm_bindgen]
impl WasmJpkiController {
    #[wasm_bindgen(constructor)]
    pub fn new(reader: WebUsbReader) -> Self {
        Self {
            inner: JpkiController::new(reader),
        }
    }

    /// Read Basic 4 Information (Name, Address, DOB, Gender)
    /// Requires the 4-digit Input Support PIN.
    pub async fn read_attributes(&mut self, pin: String) -> Result<JsValue, JsValue> {
        let info = self.inner.read_attributes(&pin, None, None).await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
            
        serde_wasm_bindgen::to_value(&info)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Read My Number (Individual Number)
    /// Requires the 4-digit Input Support PIN.
    pub async fn read_mynumber(&mut self, pin: String) -> Result<String, JsValue> {
        self.inner.read_mynumber(&pin).await
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
