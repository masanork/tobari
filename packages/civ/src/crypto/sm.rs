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
            Self::Aes128 { ssc, .. } => *ssc += 1,
            Self::Aes256 { ssc, .. } => *ssc += 1,
        }
    }

    pub fn get_ssc(&self) -> u128 {
        match self {
            Self::Aes128 { ssc, .. } => *ssc,
            Self::Aes256 { ssc, .. } => *ssc,
        }
    }

    pub fn is_null_session(&self) -> bool {
        match self {
            Self::Aes128 { k_enc, k_mac, .. } => *k_enc == [0u8; 16] && *k_mac == [0u8; 16],
            Self::Aes256 { .. } => false,
        }
    }

    fn get_iv(&self) -> Result<Vec<u8>> {
        let ssc = self.get_ssc();
        match self {
            Self::Aes128 { k_enc, .. } => {
                let mut iv = [0u8; 16];
                let mut encryptor = Aes128CbcEnc::new(k_enc.into(), &[0u8; 16].into());
                let ssc_bytes = ssc.to_be_bytes();
                encryptor.encrypt_block_b2b_mut((&ssc_bytes).into(), (&mut iv).into());
                Ok(iv.to_vec())
            },
            Self::Aes256 { k_enc, .. } => {
                let mut iv = [0u8; 16];
                let mut encryptor = Aes256CbcEnc::new(k_enc.into(), &[0u8; 16].into());
                let ssc_bytes = ssc.to_be_bytes();
                encryptor.encrypt_block_b2b_mut((&ssc_bytes).into(), (&mut iv).into());
                Ok(iv.to_vec())
            }
        }
    }

    fn encrypt_data(&self, iv: &[u8], data: &[u8]) -> Result<Vec<u8>> {
        match self {
            Self::Aes128 { k_enc, .. } => {
                let mut buffer = data.to_vec();
                let encryptor = Aes128CbcEnc::new(k_enc.into(), iv.into());
                encryptor.encrypt_padded_mut::<NoPadding>(&mut buffer, data.len())
                    .map_err(|e| CivError::CryptoError(format!("AES-128 Encryption failed: {}", e)))?;
                Ok(buffer)
            },
            Self::Aes256 { k_enc, .. } => {
                let mut buffer = data.to_vec();
                let encryptor = Aes256CbcEnc::new(k_enc.into(), iv.into());
                encryptor.encrypt_padded_mut::<NoPadding>(&mut buffer, data.len())
                    .map_err(|e| CivError::CryptoError(format!("AES-256 Encryption failed: {}", e)))?;
                Ok(buffer)
            }
        }
    }

    fn decrypt_data(&self, iv: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>> {
        match self {
            Self::Aes128 { k_enc, .. } => {
                let mut buffer = ciphertext.to_vec();
                let decryptor = Aes128CbcDec::new(k_enc.into(), iv.into());
                decryptor.decrypt_padded_mut::<NoPadding>(&mut buffer)
                    .map_err(|e| CivError::CryptoError(format!("AES-128 Decryption failed: {}", e)))?;
                Ok(buffer)
            },
            Self::Aes256 { k_enc, .. } => {
                let mut buffer = ciphertext.to_vec();
                let decryptor = Aes256CbcDec::new(k_enc.into(), iv.into());
                decryptor.decrypt_padded_mut::<NoPadding>(&mut buffer)
                    .map_err(|e| CivError::CryptoError(format!("AES-256 Decryption failed: {}", e)))?;
                Ok(buffer)
            }
        }
    }

    fn compute_mac(&self, data: &[u8]) -> Result<Vec<u8>> {
        match self {
            Self::Aes128 { k_mac, .. } => {
                let mut mac = <Aes128Cmac as KeyInit>::new(k_mac.into());
                mac.update(data);
                let result = mac.finalize().into_bytes();
                Ok(result[0..8].to_vec()) // ISO 9797-1 MAC is 8 bytes
            },
            Self::Aes256 { k_mac, .. } => {
                let mut mac = <Aes256Cmac as KeyInit>::new(k_mac.into());
                mac.update(data);
                let result = mac.finalize().into_bytes();
                Ok(result[0..8].to_vec())
            }
        }
    }
}

impl SecureMessagingSession for AesSecureMessaging {
    fn wrap_command(&mut self, apdu: &ApduCommand) -> Result<Vec<u8>> {
        self.increment_ssc();
        
        let mut wrapped_data = Vec::new();
        
        // DO87: Encrypted Data
        if !apdu.data.is_empty() {
            wrapped_data.push(0x87);
            let mut payload = vec![0x01]; // Padding indicator
            if self.is_null_session() {
                payload.extend_from_slice(&apdu.data);
            } else {
                let iv = self.get_iv()?;
                let padded = pad_iso9797_m2(&apdu.data);
                let ciphertext = self.encrypt_data(&iv, &padded)?;
                payload.extend_from_slice(&ciphertext);
            }
            wrapped_data.extend_from_slice(&encode_length(payload.len()));
            wrapped_data.extend_from_slice(&payload);
        }

        // DO97: Expected Response Length (Le)
        if let Some(le) = apdu.le {
            wrapped_data.push(0x97);
            let le_val = if le == 256 { vec![0x00] } else { vec![le as u8] };
            wrapped_data.extend_from_slice(&encode_length(le_val.len()));
            wrapped_data.extend_from_slice(&le_val);
        }

        // DO8E: MAC
        let mut mac_input = Vec::new();
        let ssc = self.get_ssc();
        mac_input.extend_from_slice(&ssc.to_be_bytes());
        mac_input.push(apdu.cla | 0x0C); // Header with SM bits
        mac_input.push(apdu.ins);
        mac_input.push(apdu.p1);
        mac_input.push(apdu.p2);
        mac_input.extend_from_slice(&wrapped_data);
        
        let mac_input_padded = pad_iso9797_m2(&mac_input);
        let mac = if self.is_null_session() {
            vec![0u8; 8]
        } else {
            self.compute_mac(&mac_input_padded)?
        };

        wrapped_data.push(0x8E);
        wrapped_data.push(mac.len() as u8);
        wrapped_data.extend_from_slice(&mac);

        let mut res = vec![apdu.cla | 0x0C, apdu.ins, apdu.p1, apdu.p2];
        res.extend_from_slice(&encode_length(wrapped_data.len()));
        res.extend_from_slice(&wrapped_data);
        
        Ok(res)
    }

    fn unwrap_response(&mut self, data: &[u8]) -> Result<(Vec<u8>, u8, u8)> {
        self.increment_ssc();
        
        if self.is_null_session() {
             if data.len() < 2 {
                 return Err(CivError::Communication("Response too short".to_string()));
             }
             let sw1 = data[data.len()-2];
             let sw2 = data[data.len()-1];
             let payload = data[0..data.len()-2].to_vec();
             return Ok((payload, sw1, sw2));
        }

        let tlvs = parse_tlv(data)?;
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

        let do99 = do99.ok_or_else(|| CivError::SecureMessagingError("Missing DO99 in SM response".to_string()))?;
        if do99.len() != 2 {
            return Err(CivError::SecureMessagingError("Invalid DO99 length".to_string()));
        }

        if !self.is_null_session() {
            let do8e = do8e.ok_or_else(|| CivError::SecureMessagingError("Missing DO8E (MAC) in SM response".to_string()))?;
            let mut mac_input = Vec::new();
            let ssc = self.get_ssc();
            mac_input.extend_from_slice(&ssc.to_be_bytes());
            if let Some(ref val) = do87 {
                mac_input.push(0x87);
                mac_input.extend_from_slice(&encode_length(val.len()));
                mac_input.extend_from_slice(val);
            }
            mac_input.push(0x99);
            mac_input.push(0x02);
            mac_input.extend_from_slice(&do99);
            
            let mac_input_padded = pad_iso9797_m2(&mac_input);
            let calculated_mac = self.compute_mac(&mac_input_padded)?;
            if calculated_mac != do8e.as_slice() {
                return Err(CivError::SecureMessagingError("SM Response MAC Mismatch".to_string()));
            }
        }

        let mut out_data = Vec::new();
        if let Some(enc_data) = do87 {
            if enc_data.is_empty() || enc_data[0] != 0x01 {
                return Err(CivError::SecureMessagingError("Invalid DO87 format".to_string()));
            }
            let ciphertext = &enc_data[1..];
            
            if self.is_null_session() {
                out_data = ciphertext.to_vec();
            } else {
                let iv = self.get_iv()?;
                let plaintext_padded = self.decrypt_data(&iv, ciphertext)?;
                out_data = unpad_iso9797_m2(&plaintext_padded)?;
            }
        }

        Ok((out_data, do99[0], do99[1]))
    }
}

impl AesSecureMessaging {
    /// Wrap Response (Card Side)
    pub fn wrap_response_from_card(&mut self, res_data: &[u8], sw1: u8, sw2: u8) -> Result<Vec<u8>> {
        self.increment_ssc();
        
        let mut wrapped = Vec::new();
        if !res_data.is_empty() {
            wrapped.push(0x87);
            let mut payload = vec![0x01]; // Padding indicator
            if self.is_null_session() {
                payload.extend_from_slice(res_data);
            } else {
                let iv = self.get_iv()?;
                let padded = pad_iso9797_m2(res_data);
                let ciphertext = self.encrypt_data(&iv, &padded)?;
                payload.extend_from_slice(&ciphertext);
            }
            wrapped.extend_from_slice(&encode_length(payload.len()));
            wrapped.extend_from_slice(&payload);
        }

        // DO99
        wrapped.push(0x99);
        wrapped.push(0x02);
        wrapped.push(sw1);
        wrapped.push(sw2);

        // DO8E (MAC)
        let mut mac_input = Vec::new();
        let ssc = self.get_ssc();
        mac_input.extend_from_slice(&ssc.to_be_bytes());
        mac_input.extend_from_slice(&wrapped);
        let mac = if self.is_null_session() {
            vec![0u8; 8]
        } else {
            let mac_input_padded = pad_iso9797_m2(&mac_input);
            self.compute_mac(&mac_input_padded)?
        };

        wrapped.push(0x8E);
        wrapped.push(mac.len() as u8);
        wrapped.extend_from_slice(&mac);

        Ok(wrapped)
    }

    /// Unwrap Command APDU (Card Side)
    pub fn unwrap_command_from_reader(&mut self, cmd: &ApduCommand) -> Result<ApduCommand> {
        if (cmd.cla & 0x0C) == 0 {
            return Ok(cmd.clone());
        }
        
        self.increment_ssc();
        
        let tlvs = parse_tlv(&cmd.data)?;
        let mut do87 = None;
        let mut do97 = None;
        let mut do8e = None;

        for (tag, value) in tlvs {
            match tag {
                0x87 => do87 = Some(value),
                0x97 => do97 = Some(value),
                0x8E => do8e = Some(value),
                _ => {}
            }
        }
        
        if !self.is_null_session() {
            let do8e = do8e.ok_or_else(|| CivError::SecureMessagingError("Missing DO8E (MAC)".to_string()))?;
            let mut mac_input = Vec::new();
            let ssc = self.get_ssc();
            mac_input.extend_from_slice(&ssc.to_be_bytes());
            // SM MAC uses the CLA with secure messaging bits set.
            mac_input.push(cmd.cla);
            mac_input.push(cmd.ins);
            mac_input.push(cmd.p1);
            mac_input.push(cmd.p2);

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
        }

        let mut plain_data = Vec::new();
        if let Some(enc_data) = do87 {
            if enc_data.is_empty() || enc_data[0] != 0x01 {
                 return Err(CivError::SecureMessagingError("Invalid DO87 format".to_string()));
            }
            let ciphertext = &enc_data[1..];
            
            if self.is_null_session() {
                plain_data = ciphertext.to_vec();
            } else {
                let iv = self.get_iv()?;
                let plaintext_padded = self.decrypt_data(&iv, ciphertext)?;
                plain_data = unpad_iso9797_m2(&plaintext_padded)?;
            }
        }
        
        let plain_le = if let Some(le_val) = do97 {
            if le_val.is_empty() { None }
            else if le_val.len() == 1 && le_val[0] == 0x00 { Some(256) }
            else if le_val.len() == 1 { Some(le_val[0] as usize) }
            else { Some(0) }
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apdu::ApduCommand;

    #[test]
    fn test_sm_command_roundtrip() {
        let k_enc = [0x10u8; 16];
        let k_mac = [0x20u8; 16];
        let mut reader_sm = AesSecureMessaging::new(&k_enc, &k_mac, 0).unwrap();
        let mut card_sm = AesSecureMessaging::new(&k_enc, &k_mac, 0).unwrap();

        let apdu = ApduCommand::new(0x00, 0xB0, 0x00, 0x10)
            .with_data(&[0x01, 0x02, 0x03])
            .with_le(0x10);
        let wrapped = reader_sm.wrap_command(&apdu).unwrap();
        let wrapped_cmd = ApduCommand::from_bytes(&wrapped).unwrap();
        let plain = card_sm.unwrap_command_from_reader(&wrapped_cmd).unwrap();

        assert_eq!(plain.to_bytes(), apdu.to_bytes());
    }

    #[test]
    fn test_sm_response_roundtrip() {
        let k_enc = [0x10u8; 16];
        let k_mac = [0x20u8; 16];
        let mut reader_sm = AesSecureMessaging::new(&k_enc, &k_mac, 0).unwrap();
        let mut card_sm = AesSecureMessaging::new(&k_enc, &k_mac, 0).unwrap();

        // Keep SSC in sync with a single command roundtrip.
        let apdu = ApduCommand::new(0x00, 0xB0, 0x00, 0x00).with_le(0x10);
        let wrapped = reader_sm.wrap_command(&apdu).unwrap();
        let wrapped_cmd = ApduCommand::from_bytes(&wrapped).unwrap();
        let _ = card_sm.unwrap_command_from_reader(&wrapped_cmd).unwrap();

        let payload = vec![0xAA, 0xBB];
        let wrapped_resp = card_sm.wrap_response_from_card(&payload, 0x90, 0x00).unwrap();
        let (data, sw1, sw2) = reader_sm.unwrap_response(&wrapped_resp).unwrap();

        assert_eq!(data, payload);
        assert_eq!((sw1, sw2), (0x90, 0x00));
    }

    #[test]
    fn test_sm_command_mac_mismatch() {
        let k_enc = [0x10u8; 16];
        let k_mac = [0x20u8; 16];
        let k_mac_bad = [0x21u8; 16];
        let mut reader_sm = AesSecureMessaging::new(&k_enc, &k_mac, 0).unwrap();
        let mut card_sm = AesSecureMessaging::new(&k_enc, &k_mac_bad, 0).unwrap();

        let apdu = ApduCommand::new(0x00, 0xB0, 0x00, 0x10).with_le(0x10);
        let wrapped = reader_sm.wrap_command(&apdu).unwrap();
        let wrapped_cmd = ApduCommand::from_bytes(&wrapped).unwrap();
        let err = card_sm.unwrap_command_from_reader(&wrapped_cmd).unwrap_err();

        assert!(matches!(err, CivError::SecureMessagingError(_)));
    }

    #[test]
    fn test_sm_command_missing_mac() {
        let k_enc = [0x10u8; 16];
        let k_mac = [0x20u8; 16];
        let mut card_sm = AesSecureMessaging::new(&k_enc, &k_mac, 0).unwrap();

        let data = vec![0x87, 0x03, 0x01, 0xAA, 0xBB];
        let cmd = ApduCommand::new(0x0C, 0xB0, 0x00, 0x00).with_data(&data);
        let err = card_sm.unwrap_command_from_reader(&cmd).unwrap_err();

        assert!(matches!(err, CivError::SecureMessagingError(_)));
    }
}

// Internal Helper Functions
fn pad_iso9797_m2(data: &[u8]) -> Vec<u8> {
    let mut padded = data.to_vec();
    padded.push(0x80);
    while !padded.len().is_multiple_of(16) {
        padded.push(0x00);
    }
    padded
}

fn unpad_iso9797_m2(data: &[u8]) -> Result<Vec<u8>> {
    if let Some(pos) = data.iter().rposition(|&x| x == 0x80) {
        Ok(data[0..pos].to_vec())
    } else {
        Err(CivError::CryptoError("Invalid ISO 9797-1 Method 2 padding".to_string()))
    }
}

fn encode_length(len: usize) -> Vec<u8> {
    if len <= 0x7F {
        vec![len as u8]
    } else if len <= 0xFF {
        vec![0x81, len as u8]
    } else {
        vec![0x82, (len >> 8) as u8, (len & 0xFF) as u8]
    }
}

fn parse_tlv(data: &[u8]) -> Result<Vec<(u8, Vec<u8>)>> {
    let mut res = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let tag = data[i];
        i += 1;
        if i >= data.len() { break; }
        let len_byte = data[i];
        i += 1;
        let len = if len_byte <= 0x7F {
            len_byte as usize
        } else if len_byte == 0x81 {
            if i >= data.len() { return Err(CivError::InvalidData("Incomplete TLV".to_string())); }
            let l = data[i] as usize;
            i += 1;
            l
        } else if len_byte == 0x82 {
            if i + 1 >= data.len() { return Err(CivError::InvalidData("Incomplete TLV".to_string())); }
            let l = ((data[i] as usize) << 8) | (data[i+1] as usize);
            i += 2;
            l
        } else {
            return Err(CivError::InvalidData("Unsupported TLV length".to_string()));
        };
        if i + len > data.len() {
            return Err(CivError::InvalidData("TLV length exceeds data".to_string()));
        }
        res.push((tag, data[i..i+len].to_vec()));
        i += len;
    }
    Ok(res)
}
