use crate::reader::CardReader;
use anyhow::Result;
use async_trait::async_trait;
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;

pub type ApduHandler = Box<dyn FnMut(&[u8]) -> Vec<u8> + Send>;

#[derive(Clone, Default)]
pub struct TestReader {
    pub sent_apdus: Arc<Mutex<Vec<Vec<u8>>>>,
    pub responses: Arc<Mutex<VecDeque<Vec<u8>>>>,
    pub handler: Arc<Mutex<Option<ApduHandler>>>,
    pub force_failure: Arc<Mutex<Option<(u8, u8)>>>, // SW1, SW2
    pub transport_error: Arc<Mutex<bool>>,
}

impl TestReader {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_transport_error(&self, enabled: bool) {
        *self.transport_error.lock().unwrap() = enabled;
    }

    pub fn set_failure(&self, sw1: u8, sw2: u8) {
        *self.force_failure.lock().unwrap() = Some((sw1, sw2));
    }

    pub fn push_response(&self, res: &[u8]) {
        self.responses.lock().unwrap().push_back(res.to_vec());
    }

    pub fn set_handler<F>(&self, handler: F)
    where
        F: FnMut(&[u8]) -> Vec<u8> + Send + 'static,
    {
        *self.handler.lock().unwrap() = Some(Box::new(handler));
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl CardReader for TestReader {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        self.sent_apdus.lock().unwrap().push(apdu.to_vec());
        
        if *self.transport_error.lock().unwrap() {
            return Err(anyhow::anyhow!("Transport error simulated"));
        }

        if let Some((sw1, sw2)) = *self.force_failure.lock().unwrap() {
            return Ok(vec![sw1, sw2]);
        }

        // Try handler first
        {
            let mut guard = self.handler.lock().unwrap();
            if let Some(handler) = guard.as_mut() {
                return Ok(handler(apdu));
            }
        }

        // Fallback to queue
        if let Some(res) = self.responses.lock().unwrap().pop_front() {
            Ok(res)
        } else {
            // Default success 90 00
            Ok(vec![0x90, 0x00])
        }
    }
}
