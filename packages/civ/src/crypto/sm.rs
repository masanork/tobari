use anyhow::{Result, anyhow};
use crate::apdu::ApduCommand;
use aes::cipher::{BlockEncrypt, KeyInit, block_padding::NoPadding};
use cbc::{Encryptor, Decryptor};
use aes::{Aes128, Aes256};
use cmac::{Cmac, Mac};

// Type Aliases
type Aes128CbcEnc = Encryptor<Aes128>;
type Aes128CbcDec = Decryptor<Aes128>;
type Aes128Cmac = Cmac<Aes128>;

type Aes256CbcEnc = Encryptor<Aes256>;
type Aes256CbcDec = Decryptor<Aes256>;
type Aes256Cmac = Cmac<Aes256>;

pub trait SecureMessagingSession {
    fn wrap_command(&mut self, apdu: &ApduCommand) -> Result<Vec<u8>>;
    fn unwrap_response(&mut self, data: &[u8]) -> Result<(Vec<u8>, u8, u8)>;
}

pub enum AesSecureMessaging {
    Aes128 {
        k_enc: [u8; 16],
        k_mac: [u8; 16],
        ssc: u128,
    },
    Aes256 {
        k_enc: [u8; 32],
        k_mac: [u8; 32],
        ssc: u128,
    },
}

impl AesSecureMessaging {
    pub fn new(k_enc: &[u8], k_mac: &[u8], ssc: u128) -> Result<Self> {
        if k_enc.len() == 16 && k_mac.len() == 16 {
            let mut ke = [0u8; 16]; ke.copy_from_slice(k_enc);
            let mut km = [0u8; 16]; km.copy_from_slice(k_mac);
            Ok(Self::Aes128 { k_enc: ke, k_mac: km, ssc })
        } else if k_enc.len() == 32 && k_mac.len() == 32 {
            let mut ke = [0u8; 32]; ke.copy_from_slice(k_enc);
            let mut km = [0u8; 32]; km.copy_from_slice(k_mac);
            Ok(Self::Aes256 { k_enc: ke, k_mac: km, ssc })
        } else {
            Err(anyhow!("Invalid AES Key Length: must be 16 (128-bit) or 32 (256-bit)"))
        }
    }

    fn increment_ssc(&mut self) {
        match self {
            Self::Aes128 { ssc, .. } => *ssc = ssc.wrapping_add(1),
            Self::Aes256 { ssc, .. } => *ssc = ssc.wrapping_add(1),
        }
    }
    
    fn get_ssc(&self) -> u128 {
        match self {
            Self::Aes128 { ssc, .. } => *ssc,
            Self::Aes256 { ssc, .. } => *ssc,
        }
    }

    fn get_iv(&self) -> Result<[u8; 16]> {
        // IV for AES encryption is E(K_enc, SSC)
        let ssc_bytes = self.get_ssc().to_be_bytes();
        let mut block = ssc_bytes.into();

        match self {
            Self::Aes128 { k_enc, .. } => {
                let cipher = Aes128::new_from_slice(k_enc).map_err(|e| anyhow!("AES Key Error: {}", e))?;
                cipher.encrypt_block(&mut block);
            },
            Self::Aes256 { k_enc, .. } => {
                let cipher = Aes256::new_from_slice(k_enc).map_err(|e| anyhow!("AES Key Error: {}", e))?;
                cipher.encrypt_block(&mut block);
            }
        }
        Ok(block.into())
    }

    fn compute_mac(&self, data: &[u8]) -> Result<[u8; 8]> {
        let ssc_bytes = self.get_ssc().to_be_bytes();
        
        let result = match self {
            Self::Aes128 { k_mac, .. } => {
                let mut mac = Aes128Cmac::new_from_slice(k_mac).map_err(|e| anyhow!("MAC Init error: {}", e))?;
                mac.update(&ssc_bytes);
                mac.update(data);
                mac.finalize().into_bytes()
            },
            Self::Aes256 { k_mac, .. } => {
                let mut mac = Aes256Cmac::new_from_slice(k_mac).map_err(|e| anyhow!("MAC Init error: {}", e))?;
                mac.update(&ssc_bytes);
                mac.update(data);
                mac.finalize().into_bytes()
            }
        };

        // Truncate to 8 bytes
        let mut out = [0u8; 8];
        out.copy_from_slice(&result[0..8]);
        Ok(out)
    }
    
    fn encrypt_data(&self, iv: &[u8; 16], data: &[u8]) -> Result<Vec<u8>> {
        match self {
            Self::Aes128 { k_enc, .. } => {
                let encryptor = Aes128CbcEnc::new_from_slice(k_enc, iv.into())
                    .map_err(|e| anyhow!("CBC Init Error: {}", e))?;
                Ok(encryptor.encrypt_padded_vec_mut::<NoPadding>(data))
            },
            Self::Aes256 { k_enc, .. } => {
                let encryptor = Aes256CbcEnc::new_from_slice(k_enc, iv.into())
                    .map_err(|e| anyhow!("CBC Init Error: {}", e))?;
                Ok(encryptor.encrypt_padded_vec_mut::<NoPadding>(data))
            }
        }
    }
    
    fn decrypt_data(&self, iv: &[u8; 16], ciphertext: &[u8]) -> Result<Vec<u8>> {
        match self {
            Self::Aes128 { k_enc, .. } => {
                let decryptor = Aes128CbcDec::new_from_slice(k_enc, iv.into())
                    .map_err(|e| anyhow!("Decrypt Init Error: {}", e))?;
                decryptor.decrypt_padded_vec_mut::<NoPadding>(ciphertext)
                    .map_err(|e| anyhow!("Decrypt Error: {}", e))
            },
            Self::Aes256 { k_enc, .. } => {
                let decryptor = Aes256CbcDec::new_from_slice(k_enc, iv.into())
                    .map_err(|e| anyhow!("Decrypt Init Error: {}", e))?;
                decryptor.decrypt_padded_vec_mut::<NoPadding>(ciphertext)
                    .map_err(|e| anyhow!("Decrypt Error: {}", e))
            }
        }
    }
}

impl SecureMessagingSession for AesSecureMessaging {
    fn wrap_command(&mut self, apdu: &ApduCommand) -> Result<Vec<u8>> {
        self.increment_ssc();
        let cla_sm = apdu.cla | 0x0C; // Secure Messaging Indication

        let mut command_data = Vec::new();
        
        // Encrypt Data (DO 87)
        if !apdu.data.is_empty() {
            let iv = self.get_iv()?;
            let padded = pad_iso9797_m2(&apdu.data);
            
            let ciphertext = self.encrypt_data(&iv, &padded)?;
            
            let mut do87 = Vec::new();
            do87.push(0x87);
            
            // Value: 01 (Type) || Ciphertext
            let mut value = Vec::with_capacity(1 + ciphertext.len());
            value.push(0x01); // 01 marker
            value.extend_from_slice(&ciphertext);
            
            do87.extend_from_slice(&encode_length(value.len()));
            do87.extend_from_slice(&value);
            command_data.extend_from_slice(&do87);
        }

        // Le (DO 97)
        if let Some(le) = apdu.le {
            let mut do97 = Vec::new();
            do97.push(0x97);
            do97.extend_from_slice(&encode_length(1));
            do97.push(le);
            command_data.extend_from_slice(&do97);
        }

        // Compute MAC (DO 8E)
        let header_padded = pad_header(cla_sm, apdu.ins, apdu.p1, apdu.p2);
        let mut mac_input = Vec::new();
        mac_input.extend_from_slice(&header_padded);
        mac_input.extend_from_slice(&command_data);
        
        let mac = self.compute_mac(&mac_input)?;
        
        let mut do8e = Vec::new();
        do8e.push(0x8E);
        do8e.extend_from_slice(&encode_length(8));
        do8e.extend_from_slice(&mac);
        command_data.extend_from_slice(&do8e);

        let wrapped = ApduCommand::new(cla_sm, apdu.ins, apdu.p1, apdu.p2)
            .with_data(&command_data)
            .with_le(0x00);

        Ok(wrapped.to_bytes())
    }

    fn unwrap_response(&mut self, response: &[u8]) -> Result<(Vec<u8>, u8, u8)> {
        if response.len() < 2 {
            return Err(anyhow!("SM response too short"));
        }
        let (raw_data, sw_bytes) = response.split_at(response.len() - 2);
        let sw1 = sw_bytes[0];
        let sw2 = sw_bytes[1];
        if sw1 != 0x90 || sw2 != 0x00 {
             return Err(anyhow!("SM Transport Error: {:02X}{:02X}", sw1, sw2));
        }

        self.increment_ssc();

        let tlvs = parse_tlv(raw_data)?;
        let mut do87 = None;
        let mut do99 = None;
        let mut do8e = None;

        for (tag, value) in tlvs {
            match tag {
                0x87 => do87 = Some(value),
                0x99 => do99 = Some(value),
                0x8E => do8e = Some(value),
                _ => {}
            }
        }

        let do99 = do99.ok_or_else(|| anyhow!("Missing DO99"))?;
        let do8e = do8e.ok_or_else(|| anyhow!("Missing DO8E"))?;

        // Verify MAC
        let mut mac_input = Vec::new();
        if let Some(ref val) = do87 {
            mac_input.push(0x87);
            mac_input.extend_from_slice(&encode_length(val.len()));
            mac_input.extend_from_slice(val);
        }
        
        mac_input.push(0x99);
        mac_input.extend_from_slice(&encode_length(do99.len()));
        mac_input.extend_from_slice(&do99);

        let calculated_mac = self.compute_mac(&mac_input)?;
        if calculated_mac != do8e.as_slice() {
            return Err(anyhow!("SM MAC Mismatch"));
        }

        // Decrypt Data
        let mut data = Vec::new();
        if let Some(enc_data) = do87 {
            if enc_data.is_empty() || enc_data[0] != 0x01 {
                return Err(anyhow!("Invalid DO87 format"));
            }
            let ciphertext = &enc_data[1..];
            let iv = self.get_iv()?;
            
            let plaintext_padded = self.decrypt_data(&iv, ciphertext)?;
            data = unpad_iso9797_m2(&plaintext_padded)?;
        }

        let res_sw1 = do99[0];
        let res_sw2 = do99[1];

        Ok((data, res_sw1, res_sw2))
    }
}

// Helpers

fn pad_iso9797_m2(data: &[u8]) -> Vec<u8> {
    let mut out = data.to_vec();
    out.push(0x80);
    while out.len() % 16 != 0 {
        out.push(0x00);
    }
    out
}

fn unpad_iso9797_m2(data: &[u8]) -> Result<Vec<u8>> {
    let mut d = data.to_vec();
    while let Some(byte) = d.pop() {
        if byte == 0x80 {
            return Ok(d);
        }
        if byte != 0x00 {
            return Err(anyhow!("Invalid Padding"));
        }
    }
    Err(anyhow!("Padding marker not found"))
}

fn pad_header(cla: u8, ins: u8, p1: u8, p2: u8) -> Vec<u8> {
    let mut h = vec![cla, ins, p1, p2];
    pad_iso9797_m2(&h)
}

fn encode_length(len: usize) -> Vec<u8> {
    if len <= 0x7F {
        vec![len as u8]
    } else if len <= 0xFF {
        vec![0x81, len as u8]
    } else {
        vec![0x82, ((len >> 8) & 0xFF) as u8, (len & 0xFF) as u8]
    }
}

fn parse_length(data: &[u8], offset: usize) -> Result<(usize, usize)> {
    if offset >= data.len() {
        return Err(anyhow!("TLV length out of bounds"));
    }
    let first = data[offset];
    if first & 0x80 == 0 {
        Ok((first as usize, 1))
    } else {
        let count = (first & 0x7F) as usize;
        if count == 0 || count > 2 {
            return Err(anyhow!("Unsupported TLV length encoding"));
        }
        if offset + 1 + count > data.len() {
            return Err(anyhow!("TLV length exceeds buffer"));
        }
        let mut len = 0usize;
        for i in 0..count {
            len = (len << 8) | data[offset + 1 + i] as usize;
        }
        Ok((len, 1 + count))
    }
}

fn parse_tlv(data: &[u8]) -> Result<Vec<(u8, Vec<u8>)>> {
    let mut items = Vec::new();
    let mut offset = 0usize;
    while offset < data.len() {
        let tag = data[offset];
        offset += 1;
        let (len, len_len) = parse_length(data, offset)?;
        offset += len_len;
        if offset + len > data.len() {
            return Err(anyhow!("TLV length exceeds buffer"));
        }
        let value = data[offset..offset + len].to_vec();
        offset += len;
        items.push((tag, value));
    }
    Ok(items)
}
