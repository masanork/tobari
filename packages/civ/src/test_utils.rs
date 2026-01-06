use crate::reader::CardReader;
use anyhow::Result;
use async_trait::async_trait;
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;

#[derive(Clone, Default)]
pub struct TestReader {
    pub sent_apdus: Arc<Mutex<Vec<Vec<u8>>>>,
    pub responses: Arc<Mutex<VecDeque<Vec<u8>>>>,
}

impl TestReader {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push_response(&self, res: &[u8]) {
        self.responses.lock().unwrap().push_back(res.to_vec());
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl CardReader for TestReader {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        self.sent_apdus.lock().unwrap().push(apdu.to_vec());
        if let Some(res) = self.responses.lock().unwrap().pop_front() {
            Ok(res)
        } else {
            // Default success 90 00
            Ok(vec![0x90, 0x00])
        }
    }
}
