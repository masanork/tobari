use crate::reader::CardReader;
use crate::errors::{CivError, Result};
use async_trait::async_trait;
use std::sync::{Arc, Mutex};

pub type ApduHandler = Box<dyn Fn(&[u8]) -> Vec<u8> + Send + Sync>;

#[derive(Clone)]
pub struct TestReader {
    responses: Arc<Mutex<Vec<Vec<u8>>>>,
    pub sent_apdus: Arc<Mutex<Vec<Vec<u8>>>>,
    handler: Arc<Mutex<Option<ApduHandler>>>,
    failure: Arc<Mutex<Option<(u8, u8)>>>,
}

impl Default for TestReader {
    fn default() -> Self {
        Self::new()
    }
}

impl TestReader {
    pub fn new() -> Self {
        Self {
            responses: Arc::new(Mutex::new(Vec::new())),
            sent_apdus: Arc::new(Mutex::new(Vec::new())),
            handler: Arc::new(Mutex::new(Option::None)),
            failure: Arc::new(Mutex::new(Option::None)),
        }
    }

    pub fn push_response(&self, res: &[u8]) {
        self.responses.lock().unwrap().push(res.to_vec());
    }

    pub fn set_handler<F>(&self, f: F)
    where
        F: Fn(&[u8]) -> Vec<u8> + Send + Sync + 'static,
    {
        *self.handler.lock().unwrap() = Some(Box::new(f));
    }

    pub fn set_failure(&self, sw1: u8, sw2: u8) {
        *self.failure.lock().unwrap() = Some((sw1, sw2));
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl CardReader for TestReader {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        self.sent_apdus.lock().unwrap().push(apdu.to_vec());

        if let Some((sw1, sw2)) = *self.failure.lock().unwrap() {
            return Err(CivError::from_sw(sw1, sw2));
        }

        if let Some(ref handler) = *self.handler.lock().unwrap() {
            return Ok(handler(apdu));
        }

        let mut responses = self.responses.lock().unwrap();
        if responses.is_empty() {
            return Err(CivError::Communication("No more responses in TestReader".to_string()));
        }
        Ok(responses.remove(0))
    }
}
