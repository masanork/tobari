/// APDU Command structure
pub struct ApduCommand {
    pub cla: u8,
    pub ins: u8,
    pub p1: u8,
    pub p2: u8,
    pub data: Vec<u8>,
    pub le: Option<u8>,
}

impl ApduCommand {
    /// Create a new APDU command builder
    pub fn new(cla: u8, ins: u8, p1: u8, p2: u8) -> Self {
        Self {
            cla,
            ins,
            p1,
            p2,
            data: Vec::new(),
            le: None,
        }
    }

    /// Set command data
    pub fn with_data(mut self, data: &[u8]) -> Self {
        self.data = data.to_vec();
        self
    }

    /// Set expected response length
    pub fn with_le(mut self, le: u8) -> Self {
        self.le = Some(le);
        self
    }

    /// Serialize to bytes
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = vec![self.cla, self.ins, self.p1, self.p2];
        if !self.data.is_empty() {
            bytes.push(self.data.len() as u8);
            bytes.extend_from_slice(&self.data);
        }
        if let Some(le) = self.le {
            bytes.push(le);
        }
        bytes
    }
}

// JPKI / ISO7816 Constants
pub const CLA_ISO: u8 = 0x00;
pub const INS_SELECT_FILE: u8 = 0xA4;
pub const INS_READ_BINARY: u8 = 0xB0;
pub const INS_VERIFY: u8 = 0x20;
pub const INS_COMPUTE_DIGITAL_SIGNATURE: u8 = 0x2A;
pub const INS_GET_CHALLENGE: u8 = 0x84;
pub const INS_EXTERNAL_AUTHENTICATE: u8 = 0x82;
pub const INS_INTERNAL_AUTHENTICATE: u8 = 0x88;

// File IDs (DF/EF)
pub mod file_ids {
    /// JPKI Application AID
    /// D3 92 F0 00 26 01 00 00 00 01
    pub const DF_JPKI: [u8; 10] = [
        0xD3, 0x92, 0xF0, 0x00, 0x26, 0x01, 0x00, 0x00, 0x00, 0x01
    ];

    /// Card Surface Input Support Application AID
    /// D3 92 10 00 31 00 01 01 04 08
    pub const DF_INPUT_SUPPORT: [u8; 10] = [
        0xD3, 0x92, 0x10, 0x00, 0x31, 0x00, 0x01, 0x01, 0x04, 0x08
    ];

    /// Surface (Visual) Application AID (券面事項確認AP)
    /// D3 92 10 00 31 00 01 01 04 02
    pub const DF_SURFACE: [u8; 10] = [
        0xD3, 0x92, 0x10, 0x00, 0x31, 0x00, 0x01, 0x01, 0x04, 0x02
    ];

    /// Authentication PIN EF
    pub const EF_AUTH_PIN: [u8; 2] = [0x00, 0x18];

    /// Signature PIN EF
    pub const EF_SIGN_PIN: [u8; 2] = [0x00, 0x1B];
    
    /// Card Surface Input Support PIN EF
    pub const EF_INPUT_SUPPORT_PIN: [u8; 2] = [0x00, 0x11];

    /// Surface (Visual) PIN EF (uses 12-digit My Number)
    pub const EF_SURFACE_PIN: [u8; 2] = [0x00, 0x13];

    /// My Number EF (under Input Support AP)
    pub const EF_MYNUMBER: [u8; 2] = [0x00, 0x01];

    /// Attributes EF (Basic 4 Info) (under Input Support AP)
    pub const EF_ATTRIBUTES: [u8; 2] = [0x00, 0x02];

    /// Face Photo EF (under Surface AP)
    pub const EF_FACE_PHOTO: [u8; 2] = [0x00, 0x02];

    /// Signature Image EF (under Input Support AP) - Usually 00 03
    pub const EF_SIGNATURE_IMAGE: [u8; 2] = [0x00, 0x03];

    /// Card Surface Information EF (contains Expiration Date, Security Code)
    pub const EF_SURFACE_INFO: [u8; 2] = [0x00, 0x05];
    /// Fallback Surface Info (sometimes 0006)
    pub const EF_SURFACE_INFO_B: [u8; 2] = [0x00, 0x06];

    /// Face Recognition Text EF (under Face Recognition AP)
    pub const EF_FACE_TEXT: [u8; 2] = [0x00, 0x01];
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apdu_simple() {
        let cmd = ApduCommand::new(0x00, 0xA4, 0x04, 0x0C);
        assert_eq!(cmd.to_bytes(), vec![0x00, 0xA4, 0x04, 0x0C]);
    }

    #[test]
    fn test_apdu_with_data() {
        let data = vec![0x01, 0x02, 0x03];
        let cmd = ApduCommand::new(0x00, 0xA4, 0x04, 0x0C).with_data(&data);
        // Header(4) + Len(1) + Data(3)
        assert_eq!(cmd.to_bytes(), vec![0x00, 0xA4, 0x04, 0x0C, 0x03, 0x01, 0x02, 0x03]);
    }

    #[test]
    fn test_apdu_with_le() {
        let cmd = ApduCommand::new(0x00, 0xB0, 0x00, 0x00).with_le(0x20);
        // Header(4) + Le(1)
        assert_eq!(cmd.to_bytes(), vec![0x00, 0xB0, 0x00, 0x00, 0x20]);
    }

    #[test]
    fn test_apdu_full() {
        let data = vec![0xAA, 0xBB];
        let cmd = ApduCommand::new(0x80, 0x2A, 0x00, 0x80)
            .with_data(&data)
            .with_le(0x00);
        // Header(4) + Lc(1) + Data(2) + Le(1)
        assert_eq!(cmd.to_bytes(), vec![0x80, 0x2A, 0x00, 0x80, 0x02, 0xAA, 0xBB, 0x00]);
    }
}
