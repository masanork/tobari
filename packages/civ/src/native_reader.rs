use crate::errors::{CivError, Result};
use crate::reader::CardReader;
use async_trait::async_trait;
use pcsc::{Context, Protocols, Scope, ShareMode, MAX_BUFFER_SIZE};
use std::ffi::CString;

pub struct PcscReader {
    ctx: Context,
    reader_name: String,
}

impl PcscReader {
    pub fn new() -> Result<Self> {
        let ctx = Context::establish(Scope::User)
            .map_err(|e| CivError::Communication(format!("PCSC Context failed: {}", e)))?;
        
        let mut readers_buf = [0; 2048];
        let mut readers = ctx.list_readers(&mut readers_buf)
            .map_err(|e| CivError::Communication(format!("List readers failed: {}", e)))?;

        let reader = readers.next()
            .ok_or_else(|| CivError::NotFound("No card reader found".to_string()))?;

        Ok(Self {
            ctx,
            reader_name: reader.to_str().unwrap_or_default().to_string(),
        })
    }

    pub fn list_readers() -> Result<Vec<String>> {
        let ctx = Context::establish(Scope::User)
            .map_err(|e| CivError::Communication(format!("PCSC Context failed: {}", e)))?;
        let mut readers_buf = [0; 2048];
        let readers = ctx.list_readers(&mut readers_buf)
            .map_err(|e| CivError::Communication(format!("List readers failed: {}", e)))?;
        Ok(readers.map(|r| r.to_str().unwrap_or_default().to_string()).collect())
    }

    pub fn set_reader(&mut self, name: &str) {
        self.reader_name = name.to_string();
    }
}

#[async_trait]
impl CardReader for PcscReader {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        let c_reader_name = CString::new(self.reader_name.clone())
            .map_err(|e| CivError::Communication(format!("Invalid reader name: {}", e)))?;
            
        let card = self.ctx.connect(&c_reader_name, ShareMode::Shared, Protocols::ANY)
            .map_err(|e| CivError::Communication(format!("Connect failed: {}", e)))?;

        let mut resp_buf = [0; MAX_BUFFER_SIZE];
        let res = card.transmit(apdu, &mut resp_buf)
            .map_err(|e| CivError::Communication(format!("Transmit failed: {}", e)))?;

        Ok(res.to_vec())
    }
}
