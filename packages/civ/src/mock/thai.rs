use crate::apdu::ApduCommand;
use crate::mock::common::MockBackend;

pub struct ThaiBackend {
    data: Vec<u8>,
    pub fail_once: bool,
}

impl ThaiBackend {
    pub fn new() -> Self {
        // Create a large buffer representing the virtual binary file
        let mut data = vec![0u8; 8192];
        
        // CID (0004): 1234567890123
        data[0x0004..0x0004+13].copy_from_slice(b"1234567890123");
        
        // Full Name Thai (0011): "สม"
        let name_thai = hex::decode("CAC1").unwrap();
        data[0x0011..0x0011+name_thai.len()].copy_from_slice(&name_thai);
        
        // Full Name En (0075): "Somchai Mankong"
        data[0x0075..0x0075+15].copy_from_slice(b"Somchai Mankong");
        
        // DOB (00D9): 25330101 (BE 2533 = AD 1990)
        data[0x00D9..0x00D9+8].copy_from_slice(b"25330101");
        
        // Gender (00E1): 1 (Male)
        data[0x00E1] = b'1';

        Self { data, fail_once: false }
    }
}

impl Default for ThaiBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl MockBackend for ThaiBackend {
    fn handle_apdu(&mut self, cmd: &ApduCommand, _aid: &[u8]) -> (Vec<u8>, u16) {
        match cmd.ins {
            0xA4 => (vec![], 0x9000), // SELECT
            0xB0 => { // READ BINARY
                if self.fail_once {
                    self.fail_once = false;
                    return (vec![0x00; 1], 0x9000); // Return too short data
                }
                let offset = ((cmd.p1 as usize) << 8) | (cmd.p2 as usize);
                // Simulate quirky Thai ID behavior: 
                // If data is provided (extra params), it's the [02 00] case.
                let len = if cmd.data == [0x02, 0x00] {
                    cmd.le.unwrap_or(0)
                } else if !cmd.data.is_empty() {
                    // Unexpected data
                    return (vec![], 0x6700);
                } else {
                    cmd.le.unwrap_or(0)
                };

                if offset + len > self.data.len() {
                    (vec![], 0x6B00)
                } else {
                    (self.data[offset..offset+len].to_vec(), 0x9000)
                }
            },
            _ => (vec![], 0x6D00),
        }
    }
}
