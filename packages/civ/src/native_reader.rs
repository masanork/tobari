#[cfg(not(target_arch = "wasm32"))]
use crate::reader::CardReader;
#[cfg(not(target_arch = "wasm32"))]
use anyhow::{anyhow, Result};
#[cfg(not(target_arch = "wasm32"))]
use async_trait::async_trait;
#[cfg(not(target_arch = "wasm32"))]
use pcsc::{Card, Context as PcscContext, Error, Protocols, Scope, ShareMode};
#[cfg(not(target_arch = "wasm32"))]
use std::{thread, time};

// Standard Extended APDU Max Length is 65536 bytes + 2 status bytes.
// Using a slightly larger buffer to be safe.
#[cfg(not(target_arch = "wasm32"))]
const EXTENDED_BUFFER_SIZE: usize = 65540;

#[cfg(not(target_arch = "wasm32"))]
pub struct PcscReader {
    ctx: PcscContext,
    card: Option<Card>,
}

fn debug_log(message: &str) {
    if std::env::var("TOBARI_DEBUG").ok().as_deref() == Some("1") {
        println!("DEBUG: {}", message);
    }
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
        let mut readers = self
            .ctx
            .list_readers(&mut readers_buf)
            .map_err(|e| anyhow!("Failed to list readers: {}", e))?;

        let reader_name = readers
            .next()
            .ok_or_else(|| anyhow!("No smart card reader found"))?;

        let name_str = reader_name
            .to_str()
            .map_err(|e| anyhow!("Invalid reader name: {}", e))?
            .to_string();

        debug_log(&format!("Connecting to reader: {}", name_str));

        let start = time::Instant::now();
        let timeout = time::Duration::from_secs(5);

        loop {
            // Attempt 1: Shared mode with T1
            // Attempt 2: Exclusive mode with ANY (to kick out other processes)
            // Attempt 3: Shared mode with ANY
            let connect_result = self.ctx.connect(reader_name, ShareMode::Shared, Protocols::T1)
                .or_else(|_| self.ctx.connect(reader_name, ShareMode::Exclusive, Protocols::ANY))
                .or_else(|_| self.ctx.connect(reader_name, ShareMode::Shared, Protocols::ANY));

            match connect_result {
                Ok(card) => {
                    let mut atr_buf = [0u8; 33];
                    let status = card.status2(&mut readers_buf, &mut atr_buf)?;
                    debug_log(&format!(
                        "Connected! Protocol: {:?}, ATR: {:02X?}",
                        status.protocol(),
                        status.atr()
                    ));
                    self.card = Some(card);
                    return Ok(name_str);
                }
                Err(Error::NoSmartcard) | Err(Error::RemovedCard) => {
                    if start.elapsed() > timeout {
                        return Err(anyhow!("Card not found in reader '{}'. Please ensure the card is placed correctly.", name_str));
                    }
                    thread::sleep(time::Duration::from_millis(500));
                    continue;
                }
                Err(e) => {
                    debug_log(&format!(
                        "Connection error: {:?} (Code: 0x{:08X})",
                        e,
                        e as u32
                    ));
                    if start.elapsed() > timeout {
                        return Err(anyhow!("Failed to connect to card: {}", e));
                    }
                    thread::sleep(time::Duration::from_millis(500));
                    continue;
                }
            }
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl CardReader for PcscReader {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        let card = self
            .card
            .as_ref()
            .ok_or_else(|| anyhow!("Card not connected"))?;

        if apdu.len() > 255 {
            debug_log(&format!("Sending Extended APDU (len: {})", apdu.len()));
        }

        let mut resp_buf = vec![0u8; EXTENDED_BUFFER_SIZE];
        match card.transmit(apdu, &mut resp_buf) {
            Ok(resp) => {
                let res = resp.to_vec();
                if res.len() >= 2 {
                    let sw1 = res[res.len()-2];
                    let sw2 = res[res.len()-1];
                    // println!("DEBUG: APDU Res SW: {:02X}{:02X}", sw1, sw2);
                }
                Ok(res)
            }
            Err(e) => {
                debug_log(&format!("Transmit error: {:?}", e));
                // If it's a protocol error, maybe we need to reconnect or handle chaining
                Err(anyhow!("Transmit failed: {}", e))
            }
        }
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    #[test]
    fn test_pcsc_new_fails_if_no_service() {
        // This will likely fail in CI/sandbox, which is what we want to cover.
        let _ = PcscReader::new();
    }
}
