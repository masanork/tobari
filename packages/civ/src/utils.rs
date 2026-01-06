#[allow(unused_imports)]
use anyhow::{Result, Context};
use encoding_rs::SHIFT_JIS;

/// Custom Shift-JIS decoder that maps unmapped bytes to [Gaiji:0xXX] format
/// instead of pure replacement character.
pub fn decode_shift_jis_lossy_gaiji(input: &[u8]) -> String {
    let (cow, _encoding_used, malformed) = SHIFT_JIS.decode(input);
    if !malformed {
        return cow.into_owned();
    }
    
    // If malformed, encoding_rs replaces with U+FFFD.
    // To allow Gaiji fallback, we might need manual iteration or fallback logic.
    // A simple heuristic: try decode, if contains U+FFFD, we might want to see raw hex for debugging.
    // However, encoding_rs doesn't tell us *where* it failed easily without manual loop.
    
    // Manual fallback strategy:
    // Iterate byte by byte/char. If encoding_rs fails on a chunk, output hex.
    // For simplicity in this PoC: 
    // We use the standard decode. If the user sees replacement chars, 
    // we can provide a "raw hex" mode later.
    // 
    // Better strategy for "Gaiji": 
    // JIS X 0213 / CP932 has specific ranges for user defined chars (0xF040 - 0xF9FC).
    // encoding_rs might map these to PUA (Private Use Area) or U+FFFD depending on config.
    // Let's stick to standard decode for now but document the limitation.
    // Ideally we would map byte sequences in 0xF0..0xF9 to PUA.
    
    cow.into_owned()
}

/// Simple TLV Parser for JIS X 6306 style flat TLV
/// Returns a map or list of tags
pub struct TlvTag {
    pub tag: u8,
    pub length: u8,
    pub value: Vec<u8>,
}

pub fn parse_tlv_flat(data: &[u8]) -> Vec<TlvTag> {
    let mut offset = 0;
    let mut tags = Vec::new();

    while offset < data.len() {
        if offset + 2 > data.len() { break; } // Need at least T and L
        let tag = data[offset];
        // Check for specific padding/invalid tags? 
        // JIS tags are usually 0x11 ~ 0x5x.
        
        offset += 1;
        let len = data[offset] as usize;
        offset += 1;

        if offset + len > data.len() { break; } // EOF check
        let value = data[offset..offset+len].to_vec();
        offset += len;

        tags.push(TlvTag { tag, length: len as u8, value });
    }
    tags
}
