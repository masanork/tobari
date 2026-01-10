use crate::apdu::ApduCommand;
use crate::mock::common::MockBackend;
use std::collections::HashMap;

pub struct MyKadBackend {
    pub records: HashMap<(u16, u16), Vec<u8>>,
    current_length: u8,
    current_target: Option<(u16, u16)>,
}

impl MyKadBackend {
    pub fn new() -> Self {
        let mut records = HashMap::new();

        // IC Number (0111, 001A)
        // 12 digits: 800101-14-1234
        records.insert((0x0111, 0x001A), b"800101141234 ".to_vec());

        // Name (0111, 00E9)
        let mut name = vec![b' '; 40];
        let name_bytes = b"ALI BIN ABU";
        name[0..name_bytes.len()].copy_from_slice(name_bytes);
        records.insert((0x0111, 0x00E9), name);

        // Gender (0111, 011C)
        records.insert((0x0111, 0x011C), b"M".to_vec());

        // Address (0111, 0203)
        let mut addr = vec![b' '; 30];
        let addr_bytes = b"123 Jalan Ampang";
        addr[0..addr_bytes.len()].copy_from_slice(addr_bytes);
        records.insert((0x0111, 0x0203), addr);

        Self {
            records,
            current_length: 0,
            current_target: None,
        }
    }
}

impl Default for MyKadBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl MockBackend for MyKadBackend {
    fn handle_apdu(&mut self, cmd: &ApduCommand, _aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => (vec![], 0x9000), // SELECT
            0xC1 => {
                // SET LENGTH
                if cmd.data.len() == 1 {
                    self.current_length = cmd.data[0];
                    (vec![], 0x9000)
                } else {
                    (vec![], 0x6700)
                }
            }
            0xA1 => {
                // SELECT INFO
                if cmd.data.len() == 4 {
                    let file_id = ((cmd.data[0] as u16) << 8) | (cmd.data[1] as u16);
                    let offset = ((cmd.data[2] as u16) << 8) | (cmd.data[3] as u16);
                    self.current_target = Some((file_id, offset));
                    (vec![], 0x9000)
                } else {
                    (vec![], 0x6700)
                }
            }
            0xB1 => {
                // READ INFO
                if let Some(key) = self.current_target {
                    if let Some(data) = self.records.get(&key) {
                        let len = self.current_length as usize;
                        if len <= data.len() {
                            (data[0..len].to_vec(), 0x9000)
                        } else {
                            (vec![], 0x6C00) // Wrong length
                        }
                    } else {
                        (vec![], 0x6A82) // File not found
                    }
                } else {
                    (vec![], 0x6985) // Condition not satisfied
                }
            }
            _ => (vec![], 0x6D00),
        }
    }
}
