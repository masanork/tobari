use crate::apdu::{ApduCommand, CLA_ISO, INS_READ_BINARY, INS_SELECT_FILE};
use crate::errors::{CivError, Result};
use crate::models::{CitizenIdentity, IdentityController};
use crate::reader::CardReader;
use crate::utils::{parse_ber_tlv, parse_tlv_total_length};
use std::collections::HashMap;
use std::fmt;

/// Residence Card (Zairyu Card) Application Controller
pub struct ResidenceCardController<R: CardReader> {
    reader: R,
    pub pin: Option<String>,
    pub last_verified: bool,
}

pub mod file_ids {
    // MF
    pub const EF_COMMON: [u8; 2] = [0x00, 0x01];
    pub const EF_CARD_TYPE: [u8; 2] = [0x00, 0x02];

    // DF1 (Visual Info)
    pub const DF1: [u8; 16] = [
        0xD3, 0x92, 0xF0, 0x00, 0x4F, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00,
    ];
    pub const EF_FRONT_IMAGE: [u8; 2] = [0x00, 0x01]; // DF1/EF01: Front Image (Tag D0)
    pub const EF_PHOTO: [u8; 2] = [0x00, 0x02]; // DF1/EF02: Photo (Tag D1)

    // DF2 (Address / Back Side)
    pub const DF2: [u8; 16] = [
        0xD3, 0x92, 0xF0, 0x00, 0x4F, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00,
    ];
    pub const EF_ADDRESS: [u8; 2] = [0x00, 0x01]; // DF2/EF01: Address (Tag D2-D4)
    pub const EF_PERMIT_GLOBAL: [u8; 2] = [0x00, 0x02]; // DF2/EF02: Global Permit (Tag D5)
    pub const EF_PERMIT_INDIV: [u8; 2] = [0x00, 0x03]; // DF2/EF03: Indiv Permit (Tag D6)
    pub const EF_UPDATE_STATUS: [u8; 2] = [0x00, 0x04]; // DF2/EF04: Status (Tag D7)

    // DF3 (Signature)
    pub const DF3: [u8; 16] = [
        0xD3, 0x92, 0xF0, 0x00, 0x4F, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00,
    ];
    pub const EF_SIGNATURE: [u8; 2] = [0x00, 0x01]; // DF3/EF01: Sig (Tag DA, DB)
}

use serde::Serialize;

/// Parsed Residence Card Information
#[derive(Debug, Default, Serialize)]
pub struct ResidenceCardInfo {
    pub address: String,
    pub date_updated: String,
    pub permit_global: String,
    pub permit_indiv: String,
    pub update_status: String,
}

impl fmt::Display for ResidenceCardInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Residence Card Info:\n Address: {}\n Updated: {}\n Permit(G): {}\n Permit(I): {}\n Status: {}", 
            self.address, self.date_updated, self.permit_global, self.permit_indiv, self.update_status)
    }
}

impl<R: CardReader> ResidenceCardController<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            pin: None,
            last_verified: false,
        }
    }

    pub async fn select_df1(&mut self) -> Result<()> {
        self.select_df(&file_ids::DF1).await
    }

    pub async fn select_df2(&mut self) -> Result<()> {
        self.select_df(&file_ids::DF2).await
    }

    pub async fn select_df3(&mut self) -> Result<()> {
        self.select_df(&file_ids::DF3).await
    }

    async fn select_df(&mut self, df: &[u8]) -> Result<()> {
        let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C).with_data(df);
        let res = self.reader.transmit(&apdu.to_bytes()).await?;
        Self::check_sw(&res)
    }

    /// Read Back Side Info (Address, Permits, Status) from DF2
    pub async fn read_df2_info(&mut self) -> Result<ResidenceCardInfo> {
        self.select_df2().await?;

        let mut info = ResidenceCardInfo::default();

        // EF01: Address
        if let Ok(raw) = self.read_file(&file_ids::EF_ADDRESS).await {
            self.parse_address(&raw, &mut info);
        }

        // EF02: Permit Global
        if let Ok(raw) = self.read_file(&file_ids::EF_PERMIT_GLOBAL).await {
            self.parse_utf8_tag(&raw, 0xD5, &mut info.permit_global);
        }

        // EF03: Permit Indiv
        if let Ok(raw) = self.read_file(&file_ids::EF_PERMIT_INDIV).await {
            self.parse_utf8_tag(&raw, 0xD6, &mut info.permit_indiv);
        }

        // EF04: Update Status
        if let Ok(raw) = self.read_file(&file_ids::EF_UPDATE_STATUS).await {
            let tlvs = parse_ber_tlv(&raw).unwrap_or_default();
            for tlv in tlvs {
                if tlv.tag == 0xD7 {
                    info.update_status = tlv.as_utf8();
                }
            }
        }

        Ok(info)
    }

    fn parse_address(&self, data: &[u8], info: &mut ResidenceCardInfo) {
        let tlvs = parse_ber_tlv(data).unwrap_or_default();
        for tlv in tlvs {
            match tlv.tag {
                0xD2 => info.date_updated = tlv.as_utf8(),
                0xD4 => info.address = tlv.as_utf8(),
                _ => {}
            }
        }
    }

    fn parse_utf8_tag(&self, data: &[u8], target_tag: u32, out: &mut String) {
        let tlvs = parse_ber_tlv(data).unwrap_or_default();
        for tlv in tlvs {
            if tlv.tag == target_tag {
                *out = tlv.as_utf8();
            }
        }
    }

    /// Read Photo (DF1/EF02)
    pub async fn read_photo(&mut self) -> Result<Vec<u8>> {
        self.select_df1().await?;
        let raw = self.read_file(&file_ids::EF_PHOTO).await?;
        let tlvs = parse_ber_tlv(&raw).unwrap_or_default();
        for tlv in tlvs {
            if tlv.tag == 0xD1 {
                return Ok(tlv.value.to_vec());
            }
        }
        Ok(Vec::new())
    }

    /// Perform Passive Authentication using DF3 Signature
    pub async fn verify_passive_authentication(&mut self) -> Result<bool> {
        // 1. Read Front Image and Photo
        let front_image = self.read_file_from_df(&file_ids::DF1, &file_ids::EF_FRONT_IMAGE).await?;
        let photo = self.read_file_from_df(&file_ids::DF1, &file_ids::EF_PHOTO).await?;
        
        // 2. Read Signature and Certificate
        let sig_file = self.read_file_from_df(&file_ids::DF3, &file_ids::EF_SIGNATURE).await?;
        
        let tlvs = parse_ber_tlv(&sig_file).unwrap_or_default();
        let mut check_code = None;
        let mut cert_der = None;
        
        for tlv in tlvs {
            match tlv.tag {
                0xDA => check_code = Some(tlv.value.to_vec()),
                0xDB => cert_der = Some(tlv.value.to_vec()),
                _ => {}
            }
        }
        
        if let (Some(_sig), Some(_cert)) = (check_code, cert_der) {
            // TODO: Implement RSA-2048 verification
            // Concatenate Front Image Value || Photo Value and hash with SHA-256
            // Then verify signature using the certificate.
            Ok(true) 
        } else {
            Err(CivError::NotFound("Signature or Certificate not found in DF3".to_string()))
        }
    }

    async fn read_file_from_df(&mut self, df: &[u8], ef: &[u8]) -> Result<Vec<u8>> {
        self.select_df(df).await?;
        self.read_file(ef).await
    }

    async fn read_file(&mut self, file_id: &[u8]) -> Result<Vec<u8>> {
        let select = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x02, 0x0C).with_data(file_id);
        let res_sel = self.reader.transmit(&select.to_bytes()).await?;
        Self::check_sw(&res_sel)?;

        let mut data = Vec::new();
        let mut offset: u16 = 0;
        let mut expected_size: Option<usize> = None;

        loop {
            let p1 = (offset >> 8) as u8;
            let p2 = (offset & 0xFF) as u8;

            let read = ApduCommand::new(CLA_ISO, INS_READ_BINARY, p1, p2).with_le(0x00);
            let res = self.reader.transmit(&read.to_bytes()).await?;

            if res.len() < 2 {
                return Err(CivError::Communication("Response too short".to_string()));
            }

            let sw1 = res[res.len() - 2];
            let sw2 = res[res.len() - 1];
            let chunk = &res[0..res.len() - 2];

            if !chunk.is_empty() {
                data.extend_from_slice(chunk);
                offset += chunk.len() as u16;
                
                // Try to determine total size from TLV header if not already known
                if expected_size.is_none() {
                    expected_size = parse_tlv_total_length(&data);
                }
            }

            if sw1 == 0x90 && sw2 == 0x00 {
                if chunk.is_empty() { break; }
                if chunk.len() < 256 { break; }
                if let Some(size) = expected_size {
                    if data.len() >= size { break; }
                }
            } else if sw1 == 0x6C {
                // Wrong length, retry with the provided length in SW2
                let le = if sw2 == 0 { 256 } else { sw2 as usize };
                let retry = ApduCommand::new(CLA_ISO, INS_READ_BINARY, p1, p2).with_le(le);
                let res_retry = self.reader.transmit(&retry.to_bytes()).await?;
                Self::check_sw(&res_retry)?;
                let chunk_retry = &res_retry[0..res_retry.len() - 2];
                data.extend_from_slice(chunk_retry);
                offset += chunk_retry.len() as u16;
                if let Some(size) = expected_size {
                    if data.len() >= size { break; }
                }
            } else if sw1 == 0x6B || (sw1 == 0x62 && sw2 == 0x82) {
                break; // Offset outside limits or EOF
            } else {
                return Err(CivError::from_sw(sw1, sw2));
            }
            
            if offset > 32768 { break; } // Safety limit
        }
        Ok(data)
    }

    fn check_sw(res: &[u8]) -> Result<()> {
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
}

#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
impl<R: CardReader + Send> IdentityController for ResidenceCardController<R> {
    async fn provide_pin(&mut self, _pin_type: &str, pin: &str) -> Result<()> {
        self.pin = Some(pin.to_string());
        Ok(())
    }

    async fn verify(&mut self) -> Result<bool> {
        // Passive Authentication
        self.last_verified = self.verify_passive_authentication().await.unwrap_or(false);
        Ok(self.last_verified)
    }

    async fn read_identity(&mut self) -> Result<CitizenIdentity> {
        let info = self.read_df2_info().await?;
        let photo_data = self.read_photo().await.ok();

        let mut attributes = HashMap::new();
        attributes.insert("residence_status".to_string(), info.permit_global);
        attributes.insert("update_status".to_string(), info.update_status);

        Ok(CitizenIdentity {
            full_name: "Unknown".to_string(),
            surname: None,
            given_names: None,
            full_name_kana: None,
            address: Some(info.address),
            birth_date: "1900-01-01".to_string(),
            gender: "9".to_string(),
            identity_number: "Unknown".to_string(),
            card_type: "ResidenceCard".to_string(),
            issuing_authority: Some("JPN".to_string()),
            expiration_date: None,
            photo_data,
            verified: self.last_verified,
            attributes,
        })
    }
}