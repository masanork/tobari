use anyhow::Result;
use async_trait::async_trait;

/// Abstraction for Smart Card Readers (PC/SC, WebUSB, etc.)
#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
pub trait CardReader {
    /// Transmit an APDU command and return the response.
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>>;

    /// Optional: Get the name of the reader for UI purposes.
    fn name(&self) -> &str {
        "Unknown Reader"
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
pub trait CardReader: Send {
    /// Transmit an APDU command and return the response.
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>>;

    /// Optional: Get the name of the reader for UI purposes.
    fn name(&self) -> &str {
        "Unknown Reader"
    }
}
