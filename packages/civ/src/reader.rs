use crate::errors::Result;
use async_trait::async_trait;

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
pub trait CardReader: Send {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>>;
}
