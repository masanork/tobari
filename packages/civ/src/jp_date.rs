use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Era {
    Unknown = 0,
    Meiji = 1,
    Taisho = 2,
    Showa = 3,
    Heisei = 4,
    Reiwa = 5,
}

impl Era {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => Era::Meiji,
            2 => Era::Taisho,
            3 => Era::Showa,
            4 => Era::Heisei,
            5 => Era::Reiwa,
            _ => Era::Unknown,
        }
    }

    pub fn to_kanji(&self) -> &'static str {
        match self {
            Era::Meiji => "明治",
            Era::Taisho => "大正",
            Era::Showa => "昭和",
            Era::Heisei => "平成",
            Era::Reiwa => "令和",
            Era::Unknown => "",
        }
    }

    pub fn start_year(&self) -> u16 {
        match self {
            Era::Meiji => 1868,
            Era::Taisho => 1912,
            Era::Showa => 1926,
            Era::Heisei => 1989,
            Era::Reiwa => 2019,
            Era::Unknown => 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Season {
    Spring,
    Summer,
    Autumn,
    Winter,
}

impl Season {
    pub fn to_kanji(&self) -> &'static str {
        match self {
            Season::Spring => "春",
            Season::Summer => "夏",
            Season::Autumn => "秋",
            Season::Winter => "冬",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MonthPart {
    Early,
    Mid,
    Late,
}

impl MonthPart {
    pub fn to_kanji(&self) -> &'static str {
        match self {
            MonthPart::Early => "上旬",
            MonthPart::Mid => "中旬",
            MonthPart::Late => "下旬",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum JpMonth {
    Month(u8),
    Season(Season),
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum JpDay {
    Day(u8),
    Part(MonthPart),
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JapanDate {
    pub era: Era,
    pub year: u16, // Western year
    pub month: JpMonth,
    pub day: JpDay,
}

impl JapanDate {
    pub fn new(e: u8, yyyy: u16, mm: &str, dd: &str) -> Self {
        let era = Era::from_code(e);
        
        let month = match mm {
            "A1" => JpMonth::Season(Season::Spring),
            "A2" => JpMonth::Season(Season::Summer),
            "A3" => JpMonth::Season(Season::Autumn),
            "A4" => JpMonth::Season(Season::Winter),
            "00" => JpMonth::Unknown,
            _ => {
                if let Ok(m) = mm.parse::<u8>() {
                    JpMonth::Month(m)
                } else {
                    JpMonth::Unknown
                }
            }
        };

        let day = match dd {
            "A1" => JpDay::Part(MonthPart::Early),
            "A2" => JpDay::Part(MonthPart::Mid),
            "A3" => JpDay::Part(MonthPart::Late),
            "00" => JpDay::Unknown,
            _ => {
                if let Ok(d) = dd.parse::<u8>() {
                    JpDay::Day(d)
                } else {
                    JpDay::Unknown
                }
            }
        };

        Self {
            era,
            year: yyyy,
            month,
            day,
        }
    }

    /// Parses a 9-character string "EYYYYMMDD"
    pub fn from_str(s: &str) -> Option<Self> {
        if s.len() != 9 {
            return None;
        }
        let e = s[0..1].parse::<u8>().ok()?;
        let yyyy = s[1..5].parse::<u16>().ok()?;
        let mm = &s[5..7];
        let dd = &s[7..9];
        Some(Self::new(e, yyyy, mm, dd))
    }
}

impl fmt::Display for JapanDate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.era == Era::Unknown && self.year == 0 {
            return write!(f, "不明");
        }

        let era_name = self.era.to_kanji();
        
        // Calculate Era Year
        let era_year_val = if self.year >= self.era.start_year() && self.era.start_year() > 0 {
            self.year - self.era.start_year() + 1
        } else {
            0
        };

        let era_year_str = if era_year_val == 1 {
            "元".to_string()
        } else if era_year_val == 0 {
            if self.year > 0 {
                format!("{}", self.year)
            } else {
                "".to_string()
            }
        } else {
            format!("{}", era_year_val)
        };
        
        if self.era != Era::Unknown {
            write!(f, "{}{}年", era_name, era_year_str)?;
        } else if self.year > 0 {
            write!(f, "西暦{}年", self.year)?;
        }

        match &self.month {
            JpMonth::Month(m) => write!(f, "{}月", m)?,
            JpMonth::Season(s) => write!(f, "{}", s.to_kanji())?,
            JpMonth::Unknown => write!(f, "月不明")?,
        }

        match &self.day {
            JpDay::Day(d) => write!(f, "{}日", d)?,
            JpDay::Part(p) => write!(f, "{}", p.to_kanji())?,
            JpDay::Unknown => write!(f, "日不明")?,
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reiwa_date() {
        let date = JapanDate::new(5, 2020, "01", "01");
        assert_eq!(date.to_string(), "令和2年1月1日");
    }

    #[test]
    fn test_reiwa_gannen() {
        let date = JapanDate::new(5, 2019, "05", "01");
        assert_eq!(date.to_string(), "令和元年5月1日");
    }

    #[test]
    fn test_special_codes() {
        let date = JapanDate::new(5, 2023, "A1", "00");
        assert_eq!(date.to_string(), "令和5年春日不明");
    }

    #[test]
    fn test_unknown_date() {
        let date = JapanDate::new(0, 0, "00", "00");
        assert_eq!(date.to_string(), "不明");
    }
}
