#[cfg(not(target_arch = "wasm32"))]
use std::{thread, time};
#[cfg(not(target_arch = "wasm32"))]
use crate::reader::CardReader;
#[cfg(not(target_arch = "wasm32"))]
use anyhow::{anyhow, Result};
#[cfg(not(target_arch = "wasm32"))]
use async_trait::async_trait;
#[cfg(not(target_arch = "wasm32"))]
use pcsc::{Context as PcscContext, Scope, Card, ShareMode, Protocols, Error};

// Standard Extended APDU Max Length is 65536 bytes + 2 status bytes.
// Using a slightly larger buffer to be safe.
#[cfg(not(target_arch = "wasm32"))]
const EXTENDED_BUFFER_SIZE: usize = 65540;

#[cfg(not(target_arch = "wasm32"))]
pub struct PcscReader {
    ctx: PcscContext,
    card: Option<Card>,
}

#[cfg(not(target_arch = "wasm32"))]
impl PcscReader {
    pub fn new() -> Result<Self> {
        let ctx = PcscContext::establish(Scope::User)
            .map_err(|e| anyhow!("Failed to establish PC/SC context: {}", e))?;
        Ok(Self { ctx, card: None })
    }

    pub fn connect(&mut self) -> Result<String> {
        let mut readers_buf = [0; 2048];
        let mut readers = self.ctx.list_readers(&mut readers_buf)
            .map_err(|e| anyhow!("Failed to list readers: {}", e))?;

        // Use the first reader found
        let reader_name = readers.next()
            .ok_or_else(|| anyhow!("No smart card reader found"))?;

        let name_str = reader_name.to_str()
            .map_err(|e| anyhow!("Invalid reader name: {}", e))?
            .to_string();

        // Retry logic for card connection
        // Wait up to 5 seconds for a card to be inserted/recognized
        let start = time::Instant::now();
        let timeout = time::Duration::from_secs(5);

        loop {
            match self.ctx.connect(reader_name, ShareMode::Shared, Protocols::ANY) {
                Ok(card) => {
                    self.card = Some(card);
                    return Ok(name_str);
                },
                Err(Error::NoSmartcard) | Err(Error::RemovedCard) => {
                    if start.elapsed() > timeout {
                         return Err(anyhow!("Card not found in reader '{}'. Please ensure the card is inserted correctly.", name_str));
                    }
                    thread::sleep(time::Duration::from_millis(500));
                    continue;
                },
                Err(e) => {
                     return Err(anyhow!("Failed to connect to card: {}", e));
                }
            }
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl CardReader for PcscReader {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        let card = self.card.as_ref().ok_or_else(|| anyhow!("Card not connected"))?;
        
        // Use a heap-allocated buffer for large sizes to avoid stack overflow
        let mut resp_buf = vec![0u8; EXTENDED_BUFFER_SIZE];
        let resp = card.transmit(apdu, &mut resp_buf)
            .map_err(|e| anyhow!("Transmit failed: {}", e))?;

        Ok(resp.to_vec())
    }
}
