use crate::apdu::*;
use crate::reader::CardReader;
use anyhow::Result;
use async_trait::async_trait;

#[derive(Debug, Clone, Default)]
pub struct DemoReader {
    current_df: Vec<u8>,
    current_ef: Vec<u8>,
    virtual_file_content: Vec<u8>,
}

impl DemoReader {
    pub fn new() -> Self {
        Self::default()
    }

    fn build_tlv(tag: u16, value: &[u8]) -> Vec<u8> {
        let mut tlv = Vec::new();
        if tag > 0xFF {
            tlv.push((tag >> 8) as u8);
            tlv.push((tag & 0xFF) as u8);
        } else {
            tlv.push(tag as u8);
        }

        if value.len() < 0x80 {
            tlv.push(value.len() as u8);
        } else if value.len() < 0x100 {
            tlv.push(0x81);
            tlv.push(value.len() as u8);
        } else {
            tlv.push(0x82);
            tlv.push((value.len() >> 8) as u8);
            tlv.push((value.len() & 0xFF) as u8);
        }
        tlv.extend_from_slice(value);
        tlv
    }

    fn update_virtual_file(&mut self) {
        // Reset
        self.virtual_file_content.clear();

        // Match based on current_df and current_ef
        if self.current_df == file_ids::DF_INPUT_SUPPORT {
            if self.current_ef == file_ids::EF_MYNUMBER {
                let mut data = vec![0x01, 12];
                data.extend_from_slice(b"123456789012");
                self.virtual_file_content = data;
            } else if self.current_ef == file_ids::EF_ATTRIBUTES {
                let mut data = Vec::new();
                data.extend(Self::build_tlv(0xDF22, "斎藤 太朗".as_bytes()));
                data.extend(Self::build_tlv(0xDF23, "東京都港区虎ノ門2-2-1".as_bytes()));
                data.extend(Self::build_tlv(0xDF24, "19890101".as_bytes()));
                data.extend(Self::build_tlv(0xDF25, "男".as_bytes()));
                self.virtual_file_content = data;
            }
        } else if self.current_df == file_ids::DF_SURFACE {
            if self.current_ef == file_ids::EF_FACE_PHOTO {
                let dummy = vec![0xDD; 2000]; // 2KB dummy
                self.virtual_file_content = Self::build_tlv(0xDF27, &dummy);
            }
        } else if self.current_df == file_ids::DF_JPKI {
            if self.current_ef == [0x00, 0x0A] {
                // Auth Cert
                self.virtual_file_content = vec![
                    0x30, 0x0A, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x55, 0x04, 0x03,
                ];
            } else if self.current_ef == [0x00, 0x01] {
                // Sign Cert
                self.virtual_file_content = vec![
                    0x30, 0x0A, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x55, 0x04, 0x03,
                ];
            }
        }
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl CardReader for DemoReader {
    async fn transmit(&mut self, apdu: &[u8]) -> Result<Vec<u8>> {
        if apdu.len() < 4 {
            return Ok(vec![0x6F, 0x00]);
        }
        let ins = apdu[1];
        let p1 = apdu[2];
        let p2 = apdu[3];

        let mut sw1 = 0x90;
        let mut sw2 = 0x00;
        let mut data = Vec::new();

        match ins {
            INS_SELECT_FILE => {
                if apdu.len() > 5 {
                    let lc = apdu[4] as usize;
                    if apdu.len() >= 5 + lc {
                        let file_id = apdu[5..5 + lc].to_vec();
                        if p1 == 0x04 {
                            // Select DF
                            self.current_df = file_id;
                            self.current_ef.clear(); // Clear EF when DF changes
                        } else if p1 == 0x02 {
                            // Select EF
                            self.current_ef = file_id;
                            self.update_virtual_file();
                        }
                    }
                }
            }
            INS_VERIFY => {
                if p2 == 0x80 {
                    // Status check
                } else if apdu.len() > 5 {
                    let lc = apdu[4] as usize;
                    let pin = &apdu[5..5 + lc];
                    if pin != b"1234" {
                        sw1 = 0x63;
                        sw2 = 0xC2; // Wrong PIN
                    }
                }
            }
            INS_READ_BINARY => {
                let offset = ((p1 as usize) << 8) | (p2 as usize);
                if offset < self.virtual_file_content.len() {
                    let end = std::cmp::min(offset + 256, self.virtual_file_content.len());
                    data = self.virtual_file_content[offset..end].to_vec();
                } else {
                    sw1 = 0x6B;
                    sw2 = 0x00; // End of file
                }
            }
            INS_COMPUTE_DIGITAL_SIGNATURE => {
                data = vec![0xEE; 256];
            }
            _ => {
                sw1 = 0x6D;
            }
        }

        data.push(sw1);
        data.push(sw2);
        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_demo_reader_jpki_flow() {
        let mut reader = DemoReader::new();

        // Select Input Support DF
        let sel_df = vec![
            0x00,
            0xA4,
            0x04,
            0x0C,
            file_ids::DF_INPUT_SUPPORT.len() as u8,
        ];
        let mut sel_df_full = sel_df;
        sel_df_full.extend_from_slice(&file_ids::DF_INPUT_SUPPORT);
        let res = reader.transmit(&sel_df_full).await.unwrap();
        assert_eq!(&res[res.len() - 2..], &[0x90, 0x00]);

        // Select MyNumber EF
        let sel_ef = vec![0x00, 0xA4, 0x02, 0x0C, 0x02, 0x00, 0x01];
        let res = reader.transmit(&sel_ef).await.unwrap();
        assert_eq!(&res[res.len() - 2..], &[0x90, 0x00]);

        // Read Binary
        let read = vec![0x00, 0xB0, 0x00, 0x00, 0x00];
        let res = reader.transmit(&read).await.unwrap();
        assert!(res.len() > 2);
        assert_eq!(&res[res.len() - 2..], &[0x90, 0x00]);
    }

    #[tokio::test]
    async fn test_demo_reader_invalid_ins() {
        let mut reader = DemoReader::new();
        let res = reader.transmit(&[0x00, 0xFF, 0x00, 0x00]).await.unwrap();
        assert_eq!(res[res.len() - 2], 0x6D);
    }
}
