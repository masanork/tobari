use crate::utils::BerTlv;
use serde::Serialize;
use std::fmt;

#[derive(Debug, Default, Serialize, Clone)]
pub struct BasicInfo {
    pub name: String,
    pub address: String,
    pub birth_date: String,
    pub gender: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub face_photo: Option<String>, // Base64 encoded
}

impl fmt::Display for BasicInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Name: {}\nAddress: {}\nDOB: {}\nGender: {}\nHas Photo: {}",
            self.name,
            self.address,
            self.birth_date,
            self.gender,
            self.face_photo.is_some()
        )
    }
}

pub fn parse_basic_info(data: &[u8]) -> crate::errors::Result<BasicInfo> {
    let mut info = BasicInfo::default();
    let tlvs = parse_jpki_flat_tlv(data);
    fn collect_tags(tlvs: &[BerTlv], map: &mut std::collections::HashMap<u32, String>) {
        for tlv in tlvs {
            // Recurse into common container tags (0x30: Sequence, 0xDF20/FF20: JPKI containers)
            if tlv.tag == 0x30 || tlv.tag == 0xDF20 || tlv.tag == 0xFF20 {
                let nested = parse_jpki_flat_tlv(&tlv.value);
                collect_tags(&nested, map);
            }
            if let Ok(value) = String::from_utf8(tlv.value.clone()) {
                map.insert(tlv.tag, value);
            }
        }
    }
    let mut tag_map = std::collections::HashMap::new();
    collect_tags(&tlvs, &mut tag_map);
    
    if let Some(v) = tag_map.get(&0xDF22) { info.name = v.clone(); }
    if let Some(v) = tag_map.get(&0xDF23) { info.address = v.clone(); }
    if let Some(v) = tag_map.get(&0xDF24) { info.birth_date = v.clone(); }
    if let Some(v) = tag_map.get(&0xDF25) { info.gender = v.clone(); }
    
    Ok(info)
}

pub fn parse_jpki_flat_tlv(data: &[u8]) -> Vec<BerTlv> {
    let mut tlvs = Vec::new();
    let mut i = 0;

    while i < data.len() {
        let first_tag_byte = data[i];
        if first_tag_byte == 0x00 {
            i += 1;
            continue;
        }
        if first_tag_byte == 0xFF {
            if i + 1 >= data.len() || data[i + 1] == 0xFF {
                i += 1;
                continue;
            }
        }

        let mut tag: u32 = first_tag_byte as u32;
        i += 1;

        if (first_tag_byte & 0x1F) == 0x1F {
            while i < data.len() {
                let next_byte = data[i];
                tag = (tag << 8) | (next_byte as u32);
                i += 1;
                if (next_byte & 0x80) == 0 {
                    break;
                }
            }
        }

        if i >= data.len() {
            break;
        }
        let first_len_byte = data[i];
        i += 1;

        let mut len: usize = 0;
        if first_len_byte <= 0x7F {
            len = first_len_byte as usize;
        } else {
            let len_bytes_count = (first_len_byte & 0x7F) as usize;
            for _ in 0..len_bytes_count {
                if i >= data.len() {
                    break;
                }
                len = (len << 8) | (data[i] as usize);
                i += 1;
            }
        }

        if i + len > data.len() {
            let remaining = data.len().saturating_sub(i);
            let value = data[i..i + remaining].to_vec();
            tlvs.push(BerTlv {
                tag,
                value,
                children: Vec::new(),
            });
            break;
        }

        let value = data[i..i + len].to_vec();
        tlvs.push(BerTlv {
            tag,
            value,
            children: Vec::new(),
        });
        i += len;
    }

    tlvs
}

pub fn extract_face_photo(data: &[u8]) -> Option<Vec<u8>> {
    let mut i = 0;
    while i + 2 <= data.len() {
        let b1 = data[i];
        let b2 = data[i + 1];
        if (b1 == 0xFF && b2 == 0xFF) || (b1 == 0x00 && b2 == 0x00) {
            i += 1;
            continue;
        }

        let tag = ((b1 as u16) << 8) | (b2 as u16);
        i += 2;
        if i >= data.len() {
            break;
        }

        let mut value_len = data[i] as usize;
        i += 1;

        if value_len == 0x81 {
            if i >= data.len() { break; }
            value_len = data[i] as usize;
            i += 1;
        } else if value_len == 0x82 {
            if i + 1 >= data.len() { break; }
            value_len = ((data[i] as usize) << 8) | (data[i + 1] as usize);
            i += 2;
        } else if value_len == 0x83 {
            if i + 2 >= data.len() { break; }
            value_len = ((data[i] as usize) << 16) | ((data[i + 1] as usize) << 8) | (data[i + 2] as usize);
            i += 3;
        }

        if i + value_len > data.len() {
            break;
        }

        if tag == 0xDF27 {
            return Some(data[i..i + value_len].to_vec());
        }

        if tag == 0xDF20 || tag == 0xFF20 || tag == 0xDF21 || tag == 0xFF21 {
            if let Some(found) = extract_face_photo(&data[i..i + value_len]) {
                return Some(found);
            }
        }

        i += value_len;
    }

    // Direct scan fallbacks
    let mut j = 0;
    while j + 3 <= data.len() {
        if data[j] == 0xDF && data[j + 1] == 0x27 {
            let mut len = data[j + 2] as usize;
            let mut k = j + 3;
            if len == 0x81 { if k < data.len() { len = data[k] as usize; k += 1; } }
            else if len == 0x82 { if k + 1 < data.len() { len = ((data[k] as usize) << 8) | (data[k + 1] as usize); k += 2; } }
            if k + len <= data.len() { return Some(data[k..k + len].to_vec()); }
        }
        j += 1;
    }

    if let Some(offset) = data.windows(12).position(|w| {
        w == [0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20, 0x0D, 0x0A, 0x87, 0x0A]
    }) {
        return Some(data[offset..].to_vec());
    }
    if let Some(offset) = data.windows(2).position(|w| w == [0xFF, 0x4F]) {
        return Some(data[offset..].to_vec());
    }

    None
}

pub fn debug_log(message: &str) {
    if std::env::var("TOBARI_DEBUG").ok().as_deref() == Some("1") {
        println!("DEBUG: {}", message);
    }
}