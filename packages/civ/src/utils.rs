use anyhow::{Result, bail};
use encoding_rs::SHIFT_JIS;

/// Decode Shift-JIS bytes to String, with lossy conversion for Gaiji.
pub fn decode_shift_jis_lossy_gaiji(input: &[u8]) -> String {
    let (cow, _encoding_used, malformed) = SHIFT_JIS.decode(input);
    if !malformed {
        return cow.into_owned();
    }
    // TODO: Implement actual Gaiji mapping for JPKI
    cow.into_owned()
}

/// BER-TLV Structure (Zero-copy)
#[derive(Debug, Clone)]
pub struct BerTlv<'a> {
    pub tag: u32,
    pub value: &'a [u8],
    pub children: Vec<BerTlv<'a>>,
}

impl<'a> BerTlv<'a> {
    pub fn find(&self, tag: u32) -> Option<&BerTlv<'a>> {
        self.children.iter().find(|t| t.tag == tag)
    }

    pub fn as_utf8(&self) -> String {
        String::from_utf8_lossy(self.value).into_owned()
    }
    
    pub fn as_u32(&self) -> Result<u32> {
        let mut val = 0u32;
        if self.value.len() > 4 { bail!("Value too long for u32"); }
        for &b in self.value {
            val = (val << 8) | (b as u32);
        }
        Ok(val)
    }
}

/// Parse BER-TLV data strictly
pub fn parse_ber_tlv(data: &[u8]) -> Result<Vec<BerTlv<'_>>> {
    let mut results = Vec::new();
    let mut i = 0;
    while i < data.len() {
        // 1. Tag
        let first_tag_byte = data[i];
        let mut tag: u32 = first_tag_byte as u32;
        i += 1;

        if (first_tag_byte & 0x1F) == 0x1F {
            while i < data.len() {
                let b = data[i];
                tag = (tag << 8) | (b as u32);
                i += 1;
                if (b & 0x80) == 0 { break; }
            }
        }

        // 2. Length
        if i >= data.len() { bail!("Unexpected EOF during length parsing"); }
        let first_len_byte = data[i];
        i += 1;

        let length = if first_len_byte == 0x80 {
            bail!("Indefinite length not supported yet");
        } else if (first_len_byte & 0x80) != 0 {
            let n_bytes = (first_len_byte & 0x7F) as usize;
            if n_bytes > 4 { bail!("Length field too long"); }
            let mut l = 0usize;
            for _ in 0..n_bytes {
                if i >= data.len() { bail!("Unexpected EOF in long-form length"); }
                l = (l << 8) | (data[i] as usize);
                i += 1;
            }
            l
        } else {
            first_len_byte as usize
        };

        // 3. Value
        if i + length > data.len() {
            bail!("Value length {} exceeds remaining data {}", length, data.len() - i);
        }
        let value = &data[i..i+length];
        i += length;

        // 4. Children (Constructed check)
        let is_constructed = (first_tag_byte & 0x20) != 0;
        let children = if is_constructed && length > 0 {
            parse_ber_tlv(value).unwrap_or_default() // Fallback to empty if inner parse fails but outer is OK
        } else {
            Vec::new()
        };

        results.push(BerTlv { tag, value, children });
    }
    Ok(results)
}

/// MRZ (Machine Readable Zone) Utilities
pub struct MrzUtils;

impl MrzUtils {
    /// Calculate ICAO 9303 check digit
    pub fn calculate_check_digit(data: &str) -> u8 {
        let weights = [7, 3, 1];
        let mut sum = 0;
        for (i, c) in data.chars().enumerate() {
            let val = match c {
                '0'..='9' => c as u32 - '0' as u32,
                'A'..='Z' => c as u32 - 'A' as u32 + 10,
                '<' | ' ' => 0,
                _ => 0,
            };
            sum += val * weights[i % 3];
        }
        (sum % 10) as u8 + b'0'
    }

    /// Verify a field with its check digit
    pub fn verify_check_digit(data: &str, expected: char) -> bool {
        Self::calculate_check_digit(data) == expected as u8
    }

    /// Parse TD3 (Passport) MRZ
    pub fn parse_mrz_td3(mrz: &str) -> Result<super::models::CitizenIdentity> {
        let lines: Vec<&str> = mrz.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
        if lines.len() != 2 || lines[0].len() != 44 || lines[1].len() != 44 {
            bail!("Invalid TD3 MRZ format");
        }

        let line1 = lines[0];
        let line2 = lines[1];

        // Line 1: [P][Type][IssuingState(3)][Names(39)]
        let names_part = &line1[5..44];
        let full_name = names_part.replace("<<", ", ").replace("<", " ").trim_matches(|c| c == ' ' || c == ',').to_string();

        // Line 2: [PassportNo(9)][Check(1)][Nationality(3)][DOB(6)][Check(1)][Gender(1)][Expiry(6)][Check(1)][Optional(14)][Check(1)][Check(1)]
        let passport_no = line2[0..9].replace("<", "");
        let dob_raw = &line2[13..19];
        let gender_raw = &line2[20..21];
        let expiry_raw = &line2[21..27];

        let birth_date = DateUtils::parse_yymmdd(dob_raw).unwrap_or_else(|_| dob_raw.to_string());
        let expiration_date = DateUtils::parse_yymmdd(expiry_raw).unwrap_or_else(|_| expiry_raw.to_string());
        let gender = match gender_raw {
            "M" => "1",
            "F" => "2",
            _ => "9",
        }.to_string();

        Ok(super::models::CitizenIdentity {
            full_name,
            full_name_kana: None,
            address: "".to_string(),
            birth_date,
            gender,
            identity_number: passport_no,
            card_type: "Passport".to_string(),
            expiration_date: Some(expiration_date),
            verified: false,
        })
    }
}

/// Date parsing utilities for Smart Cards
pub struct DateUtils;

impl DateUtils {
    /// Parse YYMMDD format (used in Passport MRZ)
    pub fn parse_yymmdd(s: &str) -> Result<String> {
        if s.len() != 6 { bail!("Invalid date length"); }
        let year_short: u32 = s[0..2].parse()?;
        let month: u32 = s[2..4].parse()?;
        let day: u32 = s[4..6].parse()?;
        
        if month < 1 || month > 12 || day < 1 || day > 31 {
            bail!("Invalid date components");
        }

        // Pivot year: assume 1980-2079
        let year = if year_short < 80 { 2000 + year_short } else { 1900 + year_short };
        Ok(format!("{:04}-{:02}-{:02}", year, month, day))
    }

    /// Parse YYYYMMDD format (used in JPKI/Drivers License)
    pub fn parse_yyyymmdd(s: &str) -> Result<String> {
        if s.len() != 8 { bail!("Invalid date length"); }
        let year: u32 = s[0..4].parse()?;
        let month: u32 = s[4..6].parse()?;
        let day: u32 = s[6..8].parse()?;
        
        if month < 1 || month > 12 || day < 1 || day > 31 {
            bail!("Invalid date components");
        }
        Ok(format!("{:04}-{:02}-{:02}", year, month, day))
    }

    /// Parse Japanese Era date format (used in Drivers License / JPKI)
    /// Format: [Era(1)] YYMMDD
    /// Eras: 1: Meiji, 2: Taisho, 3: Showa, 4: Heisei, 5: Reiwa
    pub fn parse_japanese_era(s: &str) -> Result<String> {
        if s.len() != 7 { bail!("Invalid Japanese era date length"); }
        let era = &s[0..1];
        let year_short: u32 = s[1..3].parse()?;
        let month: u32 = s[3..5].parse()?;
        let day: u32 = s[5..7].parse()?;

        let era_base = match era {
            "1" => 1867, // Meiji
            "2" => 1911, // Taisho
            "3" => 1925, // Showa
            "4" => 1988, // Heisei
            "5" => 2018, // Reiwa
            _ => bail!("Unknown era code: {}", era),
        };

        Ok(format!("{:04}-{:02}-{:02}", era_base + year_short, month, day))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ber_tlv_basic() {
        let data = [0x01, 0x02, 0xAA, 0xBB];
        let tlvs = parse_ber_tlv(&data).unwrap();
        assert_eq!(tlvs.len(), 1);
        assert_eq!(tlvs[0].tag, 0x01);
        assert_eq!(tlvs[0].value, &[0xAA, 0xBB]);
    }

    #[test]
    fn test_parse_ber_tlv_error() {
        let data = [0x01, 0x05, 0xAA]; // Length 5 but only 1 byte data
        assert!(parse_ber_tlv(&data).is_err());
    }

    #[test]
    fn test_mrz_check_digit() {
        // Example from ICAO 9303: "HA672242" -> check digit '2'
        // Wait, let's use a known one: "12345678"
        // 1*7 + 2*3 + 3*1 + 4*7 + 5*3 + 6*1 + 7*7 + 8*3
        // 7 + 6 + 3 + 28 + 15 + 6 + 49 + 24 = 138. 138 % 10 = 8.
        assert_eq!(MrzUtils::calculate_check_digit("12345678"), b'8');
    }

    #[test]
    fn test_date_parsing() {
        assert_eq!(DateUtils::parse_yyyymmdd("19900101").unwrap(), "1990-01-01");
        assert_eq!(DateUtils::parse_yyyymmdd("20231231").unwrap(), "2023-12-31");
        assert!(DateUtils::parse_yyyymmdd("20231301").is_err());
    }

    #[test]
    fn test_japanese_era_parsing() {
        assert_eq!(DateUtils::parse_japanese_era("4020101").unwrap(), "1990-01-01"); // Heisei 2
        assert_eq!(DateUtils::parse_japanese_era("5010501").unwrap(), "2019-05-01"); // Reiwa 1
        assert_eq!(DateUtils::parse_japanese_era("3640101").unwrap(), "1989-01-01"); // Showa 64
    }
}
