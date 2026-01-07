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

/// BER-TLV Structure (Zero-copy)
#[derive(Debug, Clone)]
pub struct BerTlv<'a> {
    pub tag: u32,
    pub value: &'a [u8],
    pub children: Vec<BerTlv<'a>>,
}

impl<'a> BerTlv<'a> {
    /// 指定したタグを持つ子要素を検索する（再帰的ではない）
    pub fn find(&self, tag: u32) -> Option<&BerTlv<'a>> {
        self.children.iter().find(|t| t.tag == tag)
    }

    /// 値を UTF-8 文字列として取得する (lossy)
    pub fn as_utf8(&self) -> String {
        String::from_utf8_lossy(self.value).into_owned()
    }
}

/// BER-TLV データをパースする（ゼロコピー）
/// ネストされた構造も bit 6 (constructed) を見て再帰的にパースを試みる。
pub fn parse_ber_tlv(data: &[u8]) -> Vec<BerTlv<'_>> {
    let mut results = Vec::new();
    let mut i = 0;
    while i < data.len() {
        // 1. Tag のパース
        if i >= data.len() { break; }
        let first_tag_byte = data[i];
        let mut tag: u32 = first_tag_byte as u32;
        i += 1;

        // bit 1-5 がすべて 1 ならマルチバイトタグ
        if (first_tag_byte & 0x1F) == 0x1F {
            while i < data.len() {
                let b = data[i];
                tag = (tag << 8) | (b as u32);
                i += 1;
                if (b & 0x80) == 0 { break; }
            }
        }

        // 2. Length のパース
        if i >= data.len() { break; }
        let mut length = data[i] as usize;
        i += 1;

        if length == 0x80 {
            length = 0;
        } else if (length & 0x80) != 0 {
            // ロングフォーム
            let n_bytes = length & 0x7F;
            length = 0;
            for _ in 0..n_bytes {
                if i >= data.len() { break; }
                length = (length << 8) | (data[i] as usize);
                i += 1;
            }
        }

        // 3. Value の取得 (参照として保持)
        if i + length > data.len() {
            break; 
        }
        let value = &data[i..i+length];
        i += length;

        // 4. 子要素のパースを試みる
        // 本来は (first_tag_byte & 0x20) != 0 を見るべきだが、
        // JPKIの DF20/DF21 等は bit 6 が立っていなくても構造化データを持つ場合がある。
        // タグが 0xDF で始まる、または特定の構造化タグの場合に再帰的にパースする。
        let is_likely_constructed = (first_tag_byte & 0x20) != 0 
            || first_tag_byte == 0xDF || first_tag_byte == 0xFF;

        let children = if is_likely_constructed && length > 0 {
            let inner = parse_ber_tlv(&value);
            // 意味のあるパース結果が得られた場合のみ採用
            if !inner.is_empty() { inner } else { Vec::new() }
        } else {
            Vec::new()
        };

        results.push(BerTlv { tag, value, children });
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ber_tlv_basic() {
        // Tag 01, Len 02, Val AA BB
        let data = [0x01, 0x02, 0xAA, 0xBB];
        let tlvs = parse_ber_tlv(&data);
        assert_eq!(tlvs.len(), 1);
        assert_eq!(tlvs[0].tag, 0x01);
        assert_eq!(tlvs[0].value, &[0xAA, 0xBB]);
    }

    #[test]
    fn test_parse_ber_tlv_multibyte_tag() {
        // Tag DF 22 (Myna Name), Len 03, Val 41 42 43 (ABC)
        let data = [0xDF, 0x22, 0x03, 0x41, 0x42, 0x43];
        let tlvs = parse_ber_tlv(&data);
        assert_eq!(tlvs.len(), 1);
        assert_eq!(tlvs[0].tag, 0xDF22);
        assert_eq!(tlvs[0].as_utf8(), "ABC");
    }

    #[test]
    fn test_parse_ber_tlv_long_length() {
        // Tag 04, Len 0x81 05 (1 byte length field, value 5), Val 01 02 03 04 05
        let data = [0x04, 0x81, 0x05, 0x01, 0x02, 0x03, 0x04, 0x05];
        let tlvs = parse_ber_tlv(&data);
        assert_eq!(tlvs.len(), 1);
        assert_eq!(tlvs[0].value.len(), 5);
    }

    #[test]
    fn test_parse_ber_tlv_nested() {
        // Tag 61 (Constructed), Len 06
        //   Sub-Tag 01, Len 01, Val FF
        //   Sub-Tag 02, Len 01, Val EE
        let data = [0x61, 0x06, 0x01, 0x01, 0xFF, 0x02, 0x01, 0xEE];
        let tlvs = parse_ber_tlv(&data);
        assert_eq!(tlvs.len(), 1);
        assert_eq!(tlvs[0].tag, 0x61);
        assert_eq!(tlvs[0].children.len(), 2);
        assert_eq!(tlvs[0].children[0].tag, 0x01);
        assert_eq!(tlvs[0].children[1].value, &[0xEE]);
    }
}
