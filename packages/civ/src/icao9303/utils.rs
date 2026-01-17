use crate::errors::{CivError, Result};
pub use crate::utils::{parse_ber_tlv, parse_tlv_total_length};

pub fn encode_len(len: usize) -> Vec<u8> {
    if len <= 0x7F {
        vec![len as u8]
    } else if len <= 0xFF {
        vec![0x81, len as u8]
    } else {
        vec![0x82, ((len >> 8) & 0xFF) as u8, (len & 0xFF) as u8]
    }
}

pub fn check_sw(res: &[u8]) -> Result<()> {
    if res.len() < 2 {
        return Err(CivError::Communication("Response too short".to_string()));
    }
    let sw1 = res[res.len() - 2];
    let sw2 = res[res.len() - 1];
    if sw1 == 0x90 && sw2 == 0x00 {
        Ok(())
    } else {
        Err(CivError::from_sw(sw1, sw2))
    }
}

pub fn parse_pace_response(res: &[u8], target_tag: u8) -> Result<Vec<u8>> {
    let tlvs = parse_ber_tlv(res)
        .map_err(|e| CivError::InvalidData(format!("Failed to parse PACE TLV: {}", e)))?;

    fn find_tag_recursive(tlvs: &[crate::utils::BerTlv], target: u32) -> Option<Vec<u8>> {
        for tlv in tlvs {
            if tlv.tag == target {
                return Some(tlv.value.to_vec());
            }
            if let Some(v) = find_tag_recursive(&tlv.children, target) {
                return Some(v);
            }
        }
        None
    }

    find_tag_recursive(&tlvs, target_tag as u32)
        .ok_or_else(|| CivError::NotFound(format!("Tag {:02X} not found", target_tag)))
}

pub fn extract_mrz_from_dg1(dg1: &[u8]) -> Option<String> {
    fn find_mrz_tlv(tlvs: &[crate::utils::BerTlv]) -> Option<Vec<u8>> {
        for tlv in tlvs {
            if tlv.tag == 0x5F1F {
                return Some(tlv.value.clone());
            }
            if let Some(value) = find_mrz_tlv(&tlv.children) {
                return Some(value);
            }
        }
        None
    }

    if let Ok(tlvs) = parse_ber_tlv(dg1) {
        if let Some(value) = find_mrz_tlv(&tlvs) {
            let mut mrz = String::from_utf8_lossy(&value).to_string();
            mrz = mrz.replace('\r', "").replace('\n', "");
            if mrz.len() == 88 {
                mrz.insert(44, '\n');
            }
            return Some(mrz);
        }
    }

    let needle_td3 = [b'P', b'<'];
    let needle_td1 = [b'I', b'<'];
    let pos = dg1
        .windows(2)
        .position(|w| w == needle_td3 || w == needle_td1)?;
    let slice = &dg1[pos..];
    let mut mrz: String = slice
        .iter()
        .map(|b| if b.is_ascii() { *b as char } else { ' ' })
        .collect();
    mrz = mrz.replace('\r', "").replace('\n', "");
    if mrz.len() >= 90 {
        mrz.truncate(90);
    } else if mrz.len() >= 88 {
        mrz.truncate(88);
    }
    if mrz.len() == 88 {
        mrz.insert(44, '\n');
    }
    Some(mrz)
}

pub fn debug_passport(message: &str) {
    if std::env::var("TOBARI_DEBUG").ok().as_deref() == Some("1") {
        println!("DEBUG: {}", message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_len() {
        assert_eq!(encode_len(0x7F), vec![0x7F]);
        assert_eq!(encode_len(0x80), vec![0x81, 0x80]);
        assert_eq!(encode_len(0x100), vec![0x82, 0x01, 0x00]);
    }

    #[test]
    fn test_parse_pace_response_nested() {
        // Tag 0x80 inside 0xA0
        let inner = vec![0x80, 0x02, 0x01, 0x02];
        let outer = vec![0xA0, inner.len() as u8];
        let mut data = outer;
        data.extend_from_slice(&inner);

        let res = parse_pace_response(&data, 0x80).unwrap();
        assert_eq!(res, vec![0x01, 0x02]);
    }
}
