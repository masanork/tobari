use std::collections::HashMap;
use crate::apdu::ApduCommand;
use crate::mock::common::MockBackend;

pub struct ResidenceCardBackend {
    files: HashMap<Vec<u8>, Vec<u8>>,
    current_ef: Option<Vec<u8>>,
}

impl ResidenceCardBackend {
    pub fn new() -> Self {
        let mut files = HashMap::new();
        let addr_bytes = "東京都".as_bytes();
        let mut ef_addr = vec![0xD4, addr_bytes.len() as u8];
        ef_addr.extend_from_slice(addr_bytes);
        files.insert(vec![0x00, 0x01], ef_addr);
        let perm_bytes = "許可".as_bytes();
        let mut ef_perm = vec![0xD5, perm_bytes.len() as u8];
        ef_perm.extend_from_slice(perm_bytes);
        files.insert(vec![0x00, 0x02], ef_perm);
        files.insert(vec![0x00, 0x04], vec![0xD7, 0x01, b'0']);
        Self { files, current_ef: None }
    }

    pub fn corrupt_data(&mut self) {
        if let Some(data) = self.files.get_mut(&vec![0x00, 0x01]) {
            if !data.is_empty() {
                data[0] ^= 0xFF;
            }
        }
    }
}

impl Default for ResidenceCardBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl MockBackend for ResidenceCardBackend {
    fn handle_apdu(&mut self, cmd: &ApduCommand, _aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => {
                if cmd.p1 == 0x02 { self.current_ef = Some(cmd.data.clone()); (vec![], 0x9000) }
                else { (vec![], 0x6A82) }
            },
            0xB0 => {
                if let Some(ef) = &self.current_ef {
                    if let Some(data) = self.files.get(ef) {
                        let offset = ((cmd.p1 as usize) << 8) | (cmd.p2 as usize);
                        if offset >= data.len() { (vec![], 0x6B00) }
                        else { (data[offset..].to_vec(), 0x9000) }
                    } else { (vec![], 0x6A82) }
                } else { (vec![], 0x6986) }
            },
            _ => (vec![], 0x6D00),
        }
    }
}
