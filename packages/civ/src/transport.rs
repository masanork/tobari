#[cfg(target_arch = "wasm32")]
use crate::reader::CardReader;
#[cfg(target_arch = "wasm32")]
use anyhow::{anyhow, Result};
#[cfg(target_arch = "wasm32")]
use async_trait::async_trait;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsCast;

/// Rust wrapper for JavaScript's WebUSB CardReader implementation.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct WebUsbReader {
    js_transport: JsValue,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WebUsbReader {
    #[wasm_bindgen(constructor)]
    pub fn new(js_transport: JsValue) -> Self {
        Self { js_transport }
    }
}

// Define a structural type for the JS object to avoid extending JsValue directly
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    type JsCardReader;

    #[wasm_bindgen(method, catch, js_name = transmit)]
    async fn transmit(this: &JsCardReader, apdu: &[u8]) -> Result<JsValue, JsValue>;
}

#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
impl CardReader for WebUsbReader {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        // Cast generic JsValue to our specific JS type signature
        let reader: &JsCardReader = self.js_transport.unchecked_ref();

        // Call the JS method
        let resp_value = reader
            .transmit(apdu)
            .await
            .map_err(|e| anyhow!("JS Error during transmit: {:?}", e))?;

        if !resp_value.is_object() {
            return Err(anyhow!("JS transmit returned non-object"));
        }

        let resp_array = js_sys::Uint8Array::new(&resp_value);
        Ok(resp_array.to_vec())
    }
}
