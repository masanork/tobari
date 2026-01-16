/// APDU Command structure
#[derive(Clone, Debug)]
pub struct ApduCommand {
    pub cla: u8,
    pub ins: u8,
    pub p1: u8,
    pub p2: u8,
    pub data: Vec<u8>,
    pub le: Option<usize>, // Updated to usize for Extended Le support
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
    /// Pass 0 (or 256/65536) to request "Max Length" depending on the APDU case.
    /// Note: In Short APDU, Le=0 means 256. In Extended, Le=0 means 65536.
    pub fn with_le(mut self, le: usize) -> Self {
        self.le = Some(le);
        self
    }

    /// Serialize to bytes handling Short and Extended APDU formats
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = vec![self.cla, self.ins, self.p1, self.p2];
        let lc = self.data.len();
        let le = self.le;

        // Determine if we need Extended APDU
        // Extended is needed if Lc > 255 OR Le > 256
        // Note: If Le is 0, it means max length (256 for short, 65536 for extended).
        // If lc is 0 and le is 0, it's typically a Case 2S requesting 256 bytes.
        // If we want 65536 bytes with no data, we'd explicitly set le to 65536.
        let is_extended = lc > 255 || le.is_some_and(|l| l > 256);

        if !is_extended {
            // --- Short APDU ---
            // Case 3S or 4S
            if lc > 0 {
                bytes.push(lc as u8);
                bytes.extend_from_slice(&self.data);
            }

            // Case 2S or 4S
            if let Some(l) = le {
                // For Short APDU, Le=256 is encoded as 0x00
                let l_u8 = if l == 256 { 0x00 } else { l as u8 };
                bytes.push(l_u8);
            }
        } else {
            // --- Extended APDU ---
            // Case 2E (No data, Le), Case 3E (Data, No Le), Case 4E (Data, Le)

            // If there's data (Case 3E or 4E)
            if lc > 0 {
                // Lc is 3 bytes: 00 LcHigh LcLow
                bytes.push(0x00); // Indicates extended length field follows
                bytes.push((lc >> 8) as u8);
                bytes.push((lc & 0xFF) as u8);
                bytes.extend_from_slice(&self.data);
            }

            // If there's an expected response length (Case 2E or 4E)
            if let Some(l) = le {
                // If no data (Case 2E), the 0x00 byte for extended length must precede Le
                if lc == 0 {
                    bytes.push(0x00); // Indicates extended length field follows
                }
                // Le is 2 bytes: LeHigh LeLow
                // For Extended APDU, Le=65536 is encoded as 0x0000
                let l_val = if l == 65536 { 0 } else { l };
                bytes.push((l_val >> 8) as u8);
                bytes.push((l_val & 0xFF) as u8);
            }
        }

        bytes
    }

    /// Parse raw bytes into an ApduCommand
    /// Supports Short and Extended APDU formats (Cases 1, 2, 3, 4)
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < 4 {
            return Err("APDU too short".to_string());
        }

        let cla = bytes[0];
        let ins = bytes[1];
        let p1 = bytes[2];
        let p2 = bytes[3];
        let mut cmd = Self::new(cla, ins, p1, p2);

        if bytes.len() == 4 {
            return Ok(cmd); // Case 1
        }

        let mut offset = 4;
        let l1 = bytes[offset] as usize;
        offset += 1;

        if l1 != 0 {
            // --- Short APDU ---
            if bytes.len() == 5 {
                // Case 2S: Header + Le
                cmd.le = Some(if l1 == 0 { 256 } else { l1 });
                return Ok(cmd);
            }

            // Case 3S/4S
            let lc = l1;
            if bytes.len() < offset + lc {
                return Err("APDU Lc exceeds buffer".to_string());
            }
            cmd.data = bytes[offset..offset + lc].to_vec();
            offset += lc;

            if bytes.len() > offset {
                // Case 4S: Header + Lc + Data + Le
                let le = bytes[offset] as usize;
                cmd.le = Some(if le == 0 { 256 } else { le });
            }
        } else {
            // --- Extended APDU (or Short Case 2S/4S with Lc=0, but ISO says 00 prefix is Extended) ---
            if bytes.len() == 5 {
                // Case 2S with Le=0 (256 bytes)
                cmd.le = Some(256);
                return Ok(cmd);
            }

            if bytes.len() < offset + 2 {
                return Err("Invalid Extended APDU".to_string());
            }

            // Extended length indicator (00) was at offset 4.
            // Next 2 bytes could be Lc or Le
            let l_high = bytes[offset] as usize;
            let l_low = bytes[offset + 1] as usize;
            offset += 2;
            let val = (l_high << 8) | l_low;

            if bytes.len() == 7 {
                // Case 2E: Header + 00 + LeHigh + LeLow
                cmd.le = Some(if val == 0 { 65536 } else { val });
                return Ok(cmd);
            }

            // Case 3E/4E
            let lc = val;
            if bytes.len() < offset + lc {
                return Err("Extended APDU Lc exceeds buffer".to_string());
            }
            cmd.data = bytes[offset..offset + lc].to_vec();
            offset += lc;

            if bytes.len() >= offset + 2 {
                // Case 4E: Header + 00 + Lc + Data + LeHigh + LeLow
                let le_h = bytes[offset] as usize;
                let le_l = bytes[offset + 1] as usize;
                let le = (le_h << 8) | le_l;
                cmd.le = Some(if le == 0 { 65536 } else { le });
            }
        }

        Ok(cmd)
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
    pub const DF_JPKI: [u8; 10] = [0xD3, 0x92, 0xF0, 0x00, 0x26, 0x01, 0x00, 0x00, 0x00, 0x01];

    /// Card Surface Input Support Application AID
    /// D3 92 10 00 31 00 01 01 04 08
    pub const DF_INPUT_SUPPORT: [u8; 10] =
        [0xD3, 0x92, 0x10, 0x00, 0x31, 0x00, 0x01, 0x01, 0x04, 0x08];

    /// Surface (Visual) Application AID (券面事項確認AP)
    /// D3 92 10 00 31 00 01 01 04 02
    pub const DF_SURFACE: [u8; 10] = [0xD3, 0x92, 0x10, 0x00, 0x31, 0x00, 0x01, 0x01, 0x04, 0x02];

    /// Authentication PIN EF
    pub const EF_AUTH_PIN: [u8; 2] = [0x00, 0x18];

    /// Signature PIN EF
    pub const EF_SIGN_PIN: [u8; 2] = [0x00, 0x1B];

    /// Card Surface Input Support PIN EF
    pub const EF_INPUT_SUPPORT_PIN: [u8; 2] = [0x00, 0x11];

    /// Surface (Visual) PIN EF (uses 12-digit My Number)
    pub const EF_SURFACE_PIN: [u8; 2] = [0x00, 0x13];

    /// Match Number B PIN EF (for Card AP, uses 12-digit My Number)
    pub const EF_MATCH_B_PIN: [u8; 2] = [0x00, 0x14];

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
        assert_eq!(
            cmd.to_bytes(),
            vec![0x00, 0xA4, 0x04, 0x0C, 0x03, 0x01, 0x02, 0x03]
        );
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
            .with_le(0x00); // Le=0 means 256 for short APDU
                            // Header(4) + Lc(1) + Data(2) + Le(1)
        assert_eq!(
            cmd.to_bytes(),
            vec![0x80, 0x2A, 0x00, 0x80, 0x02, 0xAA, 0xBB, 0x00]
        );
    }

    #[test]
    fn test_extended_apdu_data() {
        // Create 260 bytes of data (exceeds 255)
        let data = vec![0xAA; 260];
        let cmd = ApduCommand::new(0x00, 0x20, 0x00, 0x00).with_data(&data);

        let bytes = cmd.to_bytes();
        // Check Header
        assert_eq!(bytes[0..4], [0x00, 0x20, 0x00, 0x00]);
        // Check Extended Lc: 00 01 04 (0x0104 = 260)
        assert_eq!(bytes[4..7], [0x00, 0x01, 0x04]);
        // Check data content
        assert_eq!(bytes[7..7 + 260], data[..]);
        // No Le, so total length is 4 (header) + 3 (Lc) + 260 (data) = 267
        assert_eq!(bytes.len(), 267);
    }

    #[test]
    fn test_extended_apdu_le() {
        // Request 1000 bytes (exceeds 256)
        let cmd = ApduCommand::new(0x00, 0xB0, 0x00, 0x00).with_le(1000);

        let bytes = cmd.to_bytes();
        // Case 2E: Header + 00 + LeHigh + LeLow
        // 1000 = 0x03E8
        assert_eq!(bytes, vec![0x00, 0xB0, 0x00, 0x00, 0x00, 0x03, 0xE8]);
    }

    #[test]
    fn test_extended_apdu_le_max() {
        // Request 65536 bytes (max for extended, encoded as 0x0000)
        let cmd = ApduCommand::new(0x00, 0xB0, 0x00, 0x00).with_le(65536);

        let bytes = cmd.to_bytes();
        // Case 2E: Header + 00 + LeHigh + LeLow
        assert_eq!(bytes, vec![0x00, 0xB0, 0x00, 0x00, 0x00, 0x00, 0x00]);
    }

    #[test]
    fn test_extended_apdu_full() {
        // Case 4E: Data and Le
        let data = vec![0xAA; 260];
        let cmd = ApduCommand::new(0x00, 0x2A, 0x00, 0x00)
            .with_data(&data)
            .with_le(1000);

        let bytes = cmd.to_bytes();
        // Header
        assert_eq!(bytes[0..4], [0x00, 0x2A, 0x00, 0x00]);
        // Lc: 00 01 04
        assert_eq!(bytes[4..7], [0x00, 0x01, 0x04]);
        // Data
        assert_eq!(bytes[7..7 + 260], data[..]);
        // Le: 03 E8
        assert_eq!(bytes[7 + 260..], [0x03, 0xE8]);
        // Total length: 4 (header) + 3 (Lc) + 260 (data) + 2 (Le) = 269
        assert_eq!(bytes.len(), 269);
    }

    #[test]
    fn test_extended_apdu_full_le_max() {
        // Case 4E: Data and Le=65536
        let data = vec![0xAA; 260];
        let cmd = ApduCommand::new(0x00, 0x2A, 0x00, 0x00)
            .with_data(&data)
            .with_le(65536);

        let bytes = cmd.to_bytes();
        // Header
        assert_eq!(bytes[0..4], [0x00, 0x2A, 0x00, 0x00]);
        // Lc: 00 01 04
        assert_eq!(bytes[4..7], [0x00, 0x01, 0x04]);
        // Data
        assert_eq!(bytes[7..7 + 260], data[..]);
        // Le: 00 00
        assert_eq!(bytes[7 + 260..], [0x00, 0x00]);
        // Total length: 4 (header) + 3 (Lc) + 260 (data) + 2 (Le) = 269
        assert_eq!(bytes.len(), 269);
    }
}
