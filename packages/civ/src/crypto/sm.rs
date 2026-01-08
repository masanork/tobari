use crate::apdu::ApduCommand;
use crate::errors::{Result, CivError};
use aes::cipher::{BlockEncryptMut, BlockDecryptMut, KeyIvInit, block_padding::NoPadding};
use cbc::{Encryptor, Decryptor};
use aes::{Aes128, Aes256};
use cmac::{Cmac, Mac};
use aes::cipher::KeyInit;

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
            Err(CivError::InvalidData("Invalid AES Key Length: must be 16 (128-bit) or 32 (256-bit)".to_string()))
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
                use aes::cipher::BlockEncrypt;
                let cipher = Aes128::new_from_slice(k_enc).map_err(|e| CivError::CryptoError(format!("AES Key Error: {}", e)))?;
                cipher.encrypt_block(&mut block);
            },
            Self::Aes256 { k_enc, .. } => {
                use aes::cipher::BlockEncrypt;
                let cipher = Aes256::new_from_slice(k_enc).map_err(|e| CivError::CryptoError(format!("AES Key Error: {}", e)))?;
                cipher.encrypt_block(&mut block);
            }
        }
        Ok(block.into())
    }

    fn compute_mac(&self, data: &[u8]) -> Result<[u8; 8]> {
        let ssc_bytes = self.get_ssc().to_be_bytes();
        
        let result = match self {
            Self::Aes128 { k_mac, .. } => {
                let mut mac = <Aes128Cmac as KeyInit>::new_from_slice(k_mac).map_err(|e| CivError::CryptoError(format!("MAC Init error: {}", e)))?;
                mac.update(&ssc_bytes);
                mac.update(data);
                mac.finalize().into_bytes()
            },
            Self::Aes256 { k_mac, .. } => {
                let mut mac = <Aes256Cmac as KeyInit>::new_from_slice(k_mac).map_err(|e| CivError::CryptoError(format!("MAC Init error: {}", e)))?;
                mac.update(&ssc_bytes);
                mac.update(data);
                mac.finalize().into_bytes()
            }
        };

        let mut out = [0u8; 8];
        out.copy_from_slice(&result[0..8]);
        Ok(out)
    }
    
    fn encrypt_data(&self, iv: &[u8; 16], data: &[u8]) -> Result<Vec<u8>> {
        let mut buf = data.to_vec();
        let len = buf.len();
        match self {
            Self::Aes128 { k_enc, .. } => {
                let encryptor = Aes128CbcEnc::new(k_enc.into(), iv.into());
                encryptor.encrypt_padded_mut::<NoPadding>(&mut buf, len)
                    .map_err(|e| CivError::CryptoError(format!("Encrypt Error: {:?}", e)))?;
            },
            Self::Aes256 { k_enc, .. } => {
                let encryptor = Aes256CbcEnc::new(k_enc.into(), iv.into());
                encryptor.encrypt_padded_mut::<NoPadding>(&mut buf, len)
                    .map_err(|e| CivError::CryptoError(format!("Encrypt Error: {:?}", e)))?;
            }
        }
        Ok(buf)
    }
    
    fn decrypt_data(&self, iv: &[u8; 16], ciphertext: &[u8]) -> Result<Vec<u8>> {
        let mut buf = ciphertext.to_vec();
        match self {
            Self::Aes128 { k_enc, .. } => {
                let decryptor = Aes128CbcDec::new(k_enc.into(), iv.into());
                decryptor.decrypt_padded_mut::<NoPadding>(&mut buf)
                    .map_err(|e| CivError::CryptoError(format!("Decrypt Error: {:?}", e)))?;
            },
            Self::Aes256 { k_enc, .. } => {
                let decryptor = Aes256CbcDec::new(k_enc.into(), iv.into());
                decryptor.decrypt_padded_mut::<NoPadding>(&mut buf)
                    .map_err(|e| CivError::CryptoError(format!("Decrypt Error: {:?}", e)))?;
            }
        }
        Ok(buf)
    }
}

impl SecureMessagingSession for AesSecureMessaging {
    fn wrap_command(&mut self, apdu: &ApduCommand) -> Result<Vec<u8>> {
        self.increment_ssc();
        let cla_sm = apdu.cla | 0x0C;

        let mut command_data = Vec::new();
        
        if !apdu.data.is_empty() {
            let iv = self.get_iv()?;
            let padded = pad_iso9797_m2(&apdu.data);
            
            let ciphertext = self.encrypt_data(&iv, &padded)?;
            
            let mut do87 = Vec::new();
            do87.push(0x87);
            
            let mut value = Vec::with_capacity(1 + ciphertext.len());
            value.push(0x01); 
            value.extend_from_slice(&ciphertext);
            
            do87.extend_from_slice(&encode_length(value.len()));
            do87.extend_from_slice(&value);
            command_data.extend_from_slice(&do87);
        }

        // DO97: Le
        if let Some(le) = apdu.le {
            let le_val = if le == 256 || le == 0 { 0x00 } else { le as u8 };
            let mut do97 = Vec::new();
            do97.push(0x97);
            do97.extend_from_slice(&encode_length(1));
            do97.push(le_val);
            command_data.extend_from_slice(&do97);
        }

        let header_padded = pad_header(cla_sm, apdu.ins, apdu.p1, apdu.p2);
        let mut mac_input = Vec::new();
        mac_input.extend_from_slice(&header_padded);
        mac_input.extend_from_slice(&command_data);
        
        let mac_input_padded = pad_iso9797_m2(&mac_input);
        let mac = self.compute_mac(&mac_input_padded)?;
        
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
            return Err(CivError::Communication("SM response too short".to_string()));
        }
        let (raw_data, sw_bytes) = response.split_at(response.len() - 2);
        let sw1 = sw_bytes[0];
        let sw2 = sw_bytes[1];
        if sw1 != 0x90 || sw2 != 0x00 {
             return Err(CivError::SecureMessagingError(format!("SM Transport Error: {:02X}{:02X}", sw1, sw2)));
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

        let do99 = do99.ok_or_else(|| CivError::SecureMessagingError("Missing DO99".to_string()))?;
        let do8e = do8e.ok_or_else(|| CivError::SecureMessagingError("Missing DO8E".to_string()))?;

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

        let mac_input_padded = pad_iso9797_m2(&mac_input);
        let calculated_mac = self.compute_mac(&mac_input_padded)?;
        if calculated_mac != do8e.as_slice() {
            return Err(CivError::SecureMessagingError("SM MAC Mismatch".to_string()));
        }

        // Decrypt Data
        let mut data = Vec::new();
        if let Some(enc_data) = do87 {
            if enc_data.is_empty() || enc_data[0] != 0x01 {
                return Err(CivError::SecureMessagingError("Invalid DO87 format".to_string()));
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

impl AesSecureMessaging {
    /// Unwrap Command APDU (Card Side)
    pub fn unwrap_command_from_reader(&mut self, cmd: &ApduCommand) -> Result<ApduCommand> {
        if (cmd.cla & 0x0C) == 0 {
            return Ok(cmd.clone()); // Not SM
        }
        
        self.increment_ssc();
        
        let tlvs = parse_tlv(&cmd.data)?;
        let mut do87 = None;
        let mut do97 = None; // Le
        let mut do8e = None; // MAC

        for (tag, value) in tlvs {
            match tag {
                0x87 => do87 = Some(value),
                0x97 => do97 = Some(value),
                0x8E => do8e = Some(value),
                _ => {}
            }
        }
        
        let do8e = do8e.ok_or_else(|| CivError::SecureMessagingError("Missing DO8E (MAC)".to_string()))?;

        // Verify MAC
        let header_padded = pad_header(cmd.cla, cmd.ins, cmd.p1, cmd.p2);
        let mut mac_input = Vec::new();
        mac_input.extend_from_slice(&header_padded);

        if let Some(ref val) = do87 {
            mac_input.push(0x87);
            mac_input.extend_from_slice(&encode_length(val.len()));
            mac_input.extend_from_slice(val);
        }
        if let Some(ref val) = do97 {
            mac_input.push(0x97);
            mac_input.extend_from_slice(&encode_length(val.len()));
            mac_input.extend_from_slice(val);
        }
        
        let mac_input_padded = pad_iso9797_m2(&mac_input);
        let calculated_mac = self.compute_mac(&mac_input_padded)?;
        
        if calculated_mac != do8e.as_slice() {
            return Err(CivError::SecureMessagingError("SM Command MAC Mismatch".to_string()));
        }

        // Decrypt Body
        let mut plain_data = Vec::new();
        if let Some(enc_data) = do87 {
            if enc_data.is_empty() || enc_data[0] != 0x01 {
                 return Err(CivError::SecureMessagingError("Invalid DO87 format".to_string()));
            }
            let ciphertext = &enc_data[1..];
            let iv = self.get_iv()?;
            let plaintext_padded = self.decrypt_data(&iv, ciphertext)?;
            plain_data = unpad_iso9797_m2(&plaintext_padded)?;
        }
        
        // Extract Le
        let plain_le = if let Some(le_val) = do97 {
            if le_val.is_empty() { None }
            else if le_val.len() == 1 && le_val[0] == 0x00 { Some(256) }
            else if le_val.len() == 1 { Some(le_val[0] as usize) }
            else { Some(0) } // Extended Le unsupported
        } else {
            None
        };

        let new_cmd = ApduCommand::new(cmd.cla & !0x0C, cmd.ins, cmd.p1, cmd.p2)
            .with_data(&plain_data);
        let new_cmd = if let Some(le) = plain_le {
            new_cmd.with_le(le)
        } else {
            new_cmd
        };
        
        Ok(new_cmd)
    }

    /// Wrap Response APDU (Card Side)
    pub fn wrap_response_from_card(&mut self, data: &[u8], sw1: u8, sw2: u8) -> Result<Vec<u8>> {
        self.increment_ssc();
        
        let mut resp_data = Vec::new();
        
        // DO87
        if !data.is_empty() {
            let iv = self.get_iv()?;
            let padded = pad_iso9797_m2(data);
            let ciphertext = self.encrypt_data(&iv, &padded)?;
            
            resp_data.push(0x87);
            let mut val = vec![0x01];
            val.extend_from_slice(&ciphertext);
            resp_data.extend_from_slice(&encode_length(val.len()));
            resp_data.extend_from_slice(&val);
        }
        
        // DO99
        let do99_val = vec![sw1, sw2];
        resp_data.push(0x99);
        resp_data.extend_from_slice(&encode_length(do99_val.len()));
        resp_data.extend_from_slice(&do99_val);
        
        // MAC
        let mut mac_input = Vec::new();
        mac_input.extend_from_slice(&resp_data);
        
        let mac_input_padded = pad_iso9797_m2(&mac_input);
        let mac = self.compute_mac(&mac_input_padded)?;
        
        // DO8E
        resp_data.push(0x8E);
        resp_data.extend_from_slice(&encode_length(mac.len()));
        resp_data.extend_from_slice(&mac);
        
        resp_data.extend_from_slice(&[0x90, 0x00]);
        
        Ok(resp_data)
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
            return Err(CivError::SecureMessagingError("Invalid Padding".to_string()));
        }
    }
    Err(CivError::SecureMessagingError("Padding marker not found".to_string()))
}

fn pad_header(cla: u8, ins: u8, p1: u8, p2: u8) -> Vec<u8> {
    let h = vec![cla, ins, p1, p2];
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
        return Err(CivError::InvalidData("TLV length out of bounds".to_string()));
    }
    let first = data[offset];
    if first & 0x80 == 0 {
        Ok((first as usize, 1))
    } else {
        let count = (first & 0x7F) as usize;
        if count == 0 || count > 2 {
            return Err(CivError::InvalidData("Unsupported TLV length encoding".to_string()));
        }
        if offset + 1 + count > data.len() {
            return Err(CivError::InvalidData("TLV length exceeds buffer".to_string()));
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
            return Err(CivError::InvalidData("TLV length exceeds buffer".to_string()));
        }
        let value = data[offset..offset + len].to_vec();
        offset += len;
        items.push((tag, value));
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apdu::ApduCommand;

    #[test]
    fn test_aes128_sm_wrap() {
        let k_enc = [0x01u8; 16];
        let k_mac = [0x02u8; 16];
        let ssc = 0;
        let mut sm = AesSecureMessaging::new(&k_enc, &k_mac, ssc).unwrap();

        let cmd = ApduCommand::new(0x00, 0xA4, 0x02, 0x0C).with_data(&[0x01, 0x02]);
        
        let wrapped = sm.wrap_command(&cmd).unwrap();
        assert_eq!(wrapped[0], 0x0C);
        assert!(wrapped.windows(2).any(|w| w == [0x87, 0x11] || w[0] == 0x87));
        assert!(wrapped.windows(2).any(|w| w == [0x8E, 0x08]));
    }

    #[test]
    fn test_aes256_sm_wrap() {
        let k_enc = [0x01u8; 32];
        let k_mac = [0x02u8; 32];
        let ssc = 10;
        let mut sm = AesSecureMessaging::new(&k_enc, &k_mac, ssc).unwrap();

        let cmd = ApduCommand::new(0x00, 0xB0, 0x00, 0x00).with_le(0x10);
        
        let wrapped = sm.wrap_command(&cmd).unwrap();
        assert_eq!(wrapped[0], 0x0C);
        assert!(wrapped.windows(2).any(|w| w == [0x97, 0x01])); 
        assert!(wrapped.windows(2).any(|w| w == [0x8E, 0x08]));
    }

    #[test]
    fn test_aes128_sm_unwrap() {
        use aes::cipher::{BlockEncryptMut, KeyIvInit};
        type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;

        let k_enc = [0x01u8; 16];
        let k_mac = [0x02u8; 16];
        let ssc = 0;
        let mut sm = AesSecureMessaging::new(&k_enc, &k_mac, ssc).unwrap();

        let next_ssc = 1u128;
        let plaintext = vec![0xAA, 0xBB, 0xCC];
        let mut padded = plaintext.clone();
        padded.push(0x80);
        while padded.len() % 16 != 0 { padded.push(0x00); }
        
        let mut iv = [0u8; 16];
        let mut ssc_bytes = [0u8; 16];
        ssc_bytes.copy_from_slice(&next_ssc.to_be_bytes());
        let iv_encryptor = Aes128CbcEnc::new(&k_enc.into(), &[0u8; 16].into());
        iv_encryptor.encrypt_padded_mut::<NoPadding>(&mut ssc_bytes, 16).unwrap();
        iv.copy_from_slice(&ssc_bytes);

        let encryptor = Aes128CbcEnc::new(&k_enc.into(), &iv.into());
        let mut ciphertext = padded.clone();
        encryptor.encrypt_padded_mut::<NoPadding>(&mut ciphertext, padded.len()).unwrap();

        let mut do87 = vec![0x87, (ciphertext.len() + 1) as u8, 0x01];
        do87.extend_from_slice(&ciphertext);

        let do99 = vec![0x99, 0x02, 0x90, 0x00];

        let mut mac_input = Vec::new();
        mac_input.push(0x87);
        mac_input.extend_from_slice(&encode_length(ciphertext.len() + 1));
        mac_input.push(0x01);
        mac_input.extend_from_slice(&ciphertext);
        
        mac_input.push(0x99);
        mac_input.extend_from_slice(&encode_length(2));
        mac_input.extend_from_slice(&[0x90, 0x00]);

        let mac_input_padded = pad_iso9797_m2(&mac_input);

        let mut mac_obj = <Aes128Cmac as KeyInit>::new_from_slice(&k_mac).unwrap();
        mac_obj.update(&next_ssc.to_be_bytes()); 
        mac_obj.update(&mac_input_padded);
        let mac_val = &mac_obj.finalize().into_bytes()[0..8];
        
        let do8e = vec![0x8E, 0x08];
        let mut full_resp = do87;
        full_resp.extend_from_slice(&do99);
        full_resp.extend_from_slice(&do8e);
        full_resp.extend_from_slice(mac_val);
        full_resp.extend_from_slice(&[0x90, 0x00]); 

        let (res_data, sw1, sw2) = sm.unwrap_response(&full_resp).unwrap();
        assert_eq!(res_data, plaintext);
        assert_eq!(sw1, 0x90);
        assert_eq!(sw2, 0x00);
    }
}