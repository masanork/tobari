use crate::reader::CardReader;
use crate::errors::{Result, CivError};
use async_trait::async_trait;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmReader {
    // JS object that implements transmit(apdu: Uint8Array): Promise<Uint8Array>
    js_reader: JsValue,
}

#[wasm_bindgen]
impl WasmReader {
    #[wasm_bindgen(constructor)]
    pub fn new(js_reader: JsValue) -> Self {
        Self { js_reader }
    }
}

#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
impl CardReader for WasmReader {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        use wasm_bindgen_futures::JsFuture;
        let apdu_js = js_sys::Uint8Array::from(apdu);
        let promise = js_sys::Reflect::get(&self.js_reader, &JsValue::from_str("transmit"))
            .map_err(|e| CivError::Communication(format!("No transmit method: {:?}", e)))?;
        let function = js_sys::Function::from(promise);
        let result_promise = function.call1(&self.js_reader, &apdu_js)
            .map_err(|e| CivError::Communication(format!("Transmit call failed: {:?}", e)))?;
        let result = JsFuture::from(js_sys::Promise::from(result_promise)).await
            .map_err(|e| CivError::Communication(format!("Transmit await failed: {:?}", e)))?;
        let uint8_array = js_sys::Uint8Array::new(&result);
        Ok(uint8_array.to_vec())
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl CardReader for WasmReader {
    async fn transmit(&mut self, _apdu: &[u8]) -> Result<Vec<u8>> {
        Err(CivError::Communication("WasmReader only available on wasm32".to_string()))
    }
}

// In WASM, we don't need Send. On other platforms, we need it but WasmReader won't be used.
#[cfg(not(target_arch = "wasm32"))]
unsafe impl Send for WasmReader {}
