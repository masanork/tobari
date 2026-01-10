use std::collections::HashMap;
use once_cell::sync::Lazy;

/// Gaiji (External Character) Mapper
/// Handles conversion from JPDL/JPRC specific private use characters to Unicode.
pub struct GaijiMapper {
    // Map from Shift-JIS 2-byte code (or similar) to Unicode String
    map: HashMap<u16, String>,
}

impl GaijiMapper {
    pub fn new() -> Self {
        let mut map = HashMap::new();
        // Example placeholder data (Police Agency specific Gaiji)
        // Real table would be much larger.
        // F040 -> ☹ (Example)
        map.insert(0xF040, "☹".to_string()); 
        Self { map }
    }

    /// Convert a 2-byte Gaiji code to a Unicode string.
    /// If not found, returns a fallback replacement character.
    pub fn map_code(&self, code: u16) -> Option<&String> {
        self.map.get(&code)
    }
}

impl Default for GaijiMapper {
    fn default() -> Self {
        Self::new()
    }
}

pub static GLOBAL_GAIJI_MAPPER: Lazy<GaijiMapper> = Lazy::new(|| {
    GaijiMapper::new()
});

/// Decode byte slice with Gaiji support (Shift-JIS based)
/// This is a specialized decoder that detects Gaiji regions (e.g. F0xx - F9xx in CP932)
/// and looks them up.
pub fn decode_gaiji_string(bytes: &[u8]) -> String {
    let mut result = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let b1 = bytes[i];
        if i + 1 < bytes.len() {
            let b2 = bytes[i+1];
            // Check for Shift-JIS double byte range
            // Lead byte: 81-9F, E0-FC
            if (0x81..=0x9F).contains(&b1) || (0xE0..=0xFC).contains(&b1) {
                // Check if it's in the Gaiji area (E0-F9 usually reserved for vendors/UDC)
                // JPDL specific: often F040 ~
                let code = ((b1 as u16) << 8) | (b2 as u16);
                
                // Try Gaiji map first
                if let Some(mapped) = GLOBAL_GAIJI_MAPPER.map_code(code) {
                    result.push_str(mapped);
                    i += 2;
                    continue;
                }
                
                // Fallback to standard Shift-JIS decode
                let slice = &[b1, b2];
                let (cow, _, _) = encoding_rs::SHIFT_JIS.decode(slice);
                result.push_str(&cow);
                i += 2;
                continue;
            }
        }
        
        // Single byte (ASCII/JIS X 0201)
        if b1 <= 0x7F {
            result.push(b1 as char);
        } else if (0xA1..=0xDF).contains(&b1) {
            // Half-width Katakana
            let slice = &[b1];
            let (cow, _, _) = encoding_rs::SHIFT_JIS.decode(slice);
            result.push_str(&cow);
        } else {
            // Invalid single byte or broken stream
            result.push(std::char::REPLACEMENT_CHARACTER);
        }
        i += 1;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_gaiji_basic() {
        // Standard ASCII
        assert_eq!(decode_gaiji_string(b"ABC"), "ABC");
        // Half-width Katakana
        assert_eq!(decode_gaiji_string(&[0xB1]), "ｱ");
    }

    #[test]
    fn test_decode_gaiji_mapped() {
        // F0 40 is our example gaiji
        let data = vec![0xF0, 0x40];
        assert_eq!(decode_gaiji_string(&data), "☹");
    }

    #[test]
    fn test_decode_gaiji_fallback() {
        // Double byte non-gaiji (SJIS 'あ' is 82 A0)
        let data = vec![0x82, 0xA0];
        assert_eq!(decode_gaiji_string(&data), "あ");
    }

    #[test]
    fn test_decode_invalid() {
        // Single 0x82 without b2 -> falls through to "else" and adds REPLACEMENT_CHARACTER
        assert_eq!(decode_gaiji_string(&[0x82]), "\u{FFFD}");
    }
}
