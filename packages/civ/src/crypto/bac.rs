use anyhow::{anyhow, Result};
use sha1::{Sha1, Digest};
use des::{Des, TdesEde3};
use cipher::{BlockEncrypt, BlockDecrypt, KeyInit};
use cipher::generic_array::GenericArray;
// For BAC, we typically use 2-key 3DES (K1=K3), but the crate TdesEde3 supports 3-key.
// We construct the 24-byte key by repeating the first 8 bytes if necessary or following the 16-byte key Kseed breakdown.
// Actually BAC uses 2-key TDES (16 bytes: K A, K B). 
// TDES operation: E(K_A, D(K_B, E(K_A, data)))

pub struct BacSession {
    k_enc: [u8; 16], // 2-key 3DES keys
    k_mac: [u8; 16],
    ssc: u64, // Send Sequence Counter
}

impl BacSession {
    pub fn new(k_enc: [u8; 16], k_mac: [u8; 16], ssc: u64) -> Self {
        Self { k_enc, k_mac, ssc }
    }

    pub fn wrap_command(&mut self, apdu: &crate::apdu::ApduCommand) -> Result<Vec<u8>> {
        let cla_sm = apdu.cla | 0x0C;
        self.ssc = self.ssc.wrapping_add(1);
        let ssc_bytes = self.ssc.to_be_bytes();

        let mut command_data = Vec::new();
        if !apdu.data.is_empty() {
            let encrypted = encrypt_3des_cbc_padded(&self.k_enc, &apdu.data)?;
            let mut do87 = Vec::new();
            do87.push(0x87);
            let mut value = Vec::with_capacity(1 + encrypted.len());
            value.push(0x01);
            value.extend_from_slice(&encrypted);
            do87.extend_from_slice(&encode_length(value.len()));
            do87.extend_from_slice(&value);
            command_data.extend_from_slice(&do87);
        }

        if let Some(le) = apdu.le {
            let do97 = [0x97, 0x01, le];
            command_data.extend_from_slice(&do97);
        }

        let mac_input = build_mac_input(&ssc_bytes, cla_sm, apdu.ins, apdu.p1, apdu.p2, &command_data);
        let mac = retail_mac(&self.k_mac, &mac_input)?;
        let mut do8e = Vec::new();
        do8e.push(0x8E);
        do8e.extend_from_slice(&[0x08]);
        do8e.extend_from_slice(&mac);
        command_data.extend_from_slice(&do8e);

        let wrapped = crate::apdu::ApduCommand::new(cla_sm, apdu.ins, apdu.p1, apdu.p2)
            .with_data(&command_data);
        Ok(wrapped.to_bytes())
    }

    pub fn unwrap_response(&mut self, response: &[u8]) -> Result<(Vec<u8>, u8, u8)> {
        if response.len() < 2 {
            return Err(anyhow!("Secure messaging response too short"));
        }
        let (raw_data, sw_bytes) = response.split_at(response.len() - 2);
        let sw1 = sw_bytes[0];
        let sw2 = sw_bytes[1];
        if sw1 != 0x90 || sw2 != 0x00 {
            return Err(anyhow!("Secure messaging transport error: SW={:02X}{:02X}", sw1, sw2));
        }

        let tlvs = parse_tlv(raw_data)?;
        // let mut count = 0;
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

        let do99 = do99.ok_or_else(|| anyhow!("Missing DO99 in SM response"))?;
        if do99.len() != 2 {
            return Err(anyhow!("Invalid DO99 length"));
        }
        let response_sw1 = do99[0];
        let response_sw2 = do99[1];

        let do8e = do8e.ok_or_else(|| anyhow!("Missing DO8E in SM response"))?;
        if do8e.len() != 8 {
            return Err(anyhow!("Invalid DO8E length"));
        }

        self.ssc = self.ssc.wrapping_add(1);
        let ssc_bytes = self.ssc.to_be_bytes();
        let mut mac_payload = Vec::new();
        if let Some(ref value) = do87 {
            let mut do87_encoded = Vec::new();
            do87_encoded.push(0x87);
            do87_encoded.extend_from_slice(&encode_length(value.len()));
            do87_encoded.extend_from_slice(value);
            mac_payload.extend_from_slice(&do87_encoded);
        }
        let mut do99_encoded = Vec::new();
        do99_encoded.push(0x99);
        do99_encoded.extend_from_slice(&encode_length(do99.len()));
        do99_encoded.extend_from_slice(&do99);
        mac_payload.extend_from_slice(&do99_encoded);

        let mac_input = build_mac_input_response(&ssc_bytes, &mac_payload);
        let expected_mac = retail_mac(&self.k_mac, &mac_input)?;
        if expected_mac.as_slice() != do8e.as_slice() {
            return Err(anyhow!("Secure messaging MAC mismatch"));
        }

        let decrypted = if let Some(value) = do87 {
            if value.is_empty() || value[0] != 0x01 {
                return Err(anyhow!("Invalid DO87 format"));
            }
            decrypt_3des_cbc_padded(&self.k_enc, &value[1..])?
        } else {
            Vec::new()
        };

        Ok((decrypted, response_sw1, response_sw2))
    }
}

pub fn derive_key_seed(mrz: &str) -> [u8; 16] {
    // MRZ Information for BAC:
    // Document Number (9 chars) + Check Digit
    // Date of Birth (6 chars) + Check Digit
    // Date of Expiry (6 chars) + Check Digit
    // Total: 9+1 + 6+1 + 6+1 = 24 chars (usually)
    // NOTE: The mrz string passed here MUST be the concatenated string of these fields.
    
    // Hash(MRZ_Info)
    let mut hasher = Sha1::new();
    hasher.update(mrz.as_bytes());
    let hash = hasher.finalize();
    
    // Take first 16 bytes as K_seed
    let mut k_seed = [0u8; 16];
    k_seed.copy_from_slice(&hash[0..16]);
    k_seed
}

pub fn derive_session_keys(k_seed: &[u8; 16]) -> ([u8; 16], [u8; 16]) {
    // Derive K_enc and K_mac from K_seed
    // D = K_seed || c
    // c = 00 00 00 01 for K_enc
    // c = 00 00 00 02 for K_mac
    
    let k_enc = derive_des_key(k_seed, 1);
    let k_mac = derive_des_key(k_seed, 2);
    
    (k_enc, k_mac)
}

fn derive_des_key(k_seed: &[u8; 16], counter: u32) -> [u8; 16] {
    let mut d = Vec::with_capacity(20);
    d.extend_from_slice(k_seed);
    d.extend_from_slice(&counter.to_be_bytes());

    let mut hasher = Sha1::new();
    hasher.update(&d);
    let hash = hasher.finalize();

    // Key Ka = H[0..8], Key Kb = H[8..16]
    // Adjust parity for DES keys?
    // In ICAO 9303, typically we use the raw bytes, parity is ignored by many crypto impls, 
    // but strict implementations force odd parity.
    // We'll define parity adjustment helper.
    
    let mut key = [0u8; 16];
    key.copy_from_slice(&hash[0..16]);
    
    adjust_parity(&mut key);
    key
}

fn adjust_parity(key: &mut [u8]) {
    for byte in key.iter_mut() {
        let mut count = 0;
        for i in 0..7 {
            if (*byte >> i) & 1 == 1 {
                count += 1;
            }
        }
        // If even bits set, last bit (0) should be 1 to make it odd
        // If odd bits set, last bit (0) should be 0 to make it odd
        // Wait, DES parity bit is the LSB.
        // Actually, popcnt of the whole byte usually implies parity.
        // Let's rely on standard practice: set LSB to produce odd parity.
        
        let mask = 0xFE;
        let mut b = *byte & mask; // clear LSB
        let ones = b.count_ones();
        if ones % 2 == 0 {
            b |= 1; // set LSB to 1
        }
        *byte = b;
    }
}

fn build_mac_input(ssc: &[u8; 8], cla: u8, ins: u8, p1: u8, p2: u8, tlvs: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 4 + tlvs.len());
    data.extend_from_slice(ssc);
    data.extend_from_slice(&[cla, ins, p1, p2]);
    data.extend_from_slice(tlvs);
    pad_iso9797(&data, 8)
}

fn build_mac_input_response(ssc: &[u8; 8], tlvs: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + tlvs.len());
    data.extend_from_slice(ssc);
    data.extend_from_slice(tlvs);
    pad_iso9797(&data, 8)
}

fn pad_iso9797(data: &[u8], block_size: usize) -> Vec<u8> {
    let mut out = data.to_vec();
    out.push(0x80);
    while out.len() % block_size != 0 {
        out.push(0x00);
    }
    out
}

fn unpad_iso9797(mut data: Vec<u8>) -> Result<Vec<u8>> {
    while let Some(last) = data.pop() {
        if last == 0x80 {
            return Ok(data);
        }
        if last != 0x00 {
            return Err(anyhow!("Invalid ISO9797 padding"));
        }
    }
    Err(anyhow!("Invalid ISO9797 padding"))
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

fn expand_3des_key(k_2key: &[u8; 16]) -> [u8; 24] {
    let mut key = [0u8; 24];
    key[0..8].copy_from_slice(&k_2key[0..8]);
    key[8..16].copy_from_slice(&k_2key[8..16]);
    key[16..24].copy_from_slice(&k_2key[0..8]);
    key
}

fn encrypt_3des_cbc_raw(k_enc: &[u8; 16], data: &[u8]) -> Result<Vec<u8>> {
    if data.len() % 8 != 0 {
        return Err(anyhow!("Plaintext is not block aligned"));
    }
    let key = expand_3des_key(k_enc);
    let cipher = TdesEde3::new_from_slice(&key).map_err(|_| anyhow!("Invalid 3DES key"))?;
    let mut iv = [0u8; 8];
    let mut out = Vec::with_capacity(data.len());
    for chunk in data.chunks(8) {
        let mut block = [0u8; 8];
        for i in 0..8 {
            block[i] = chunk[i] ^ iv[i];
        }
        let mut block_ga = GenericArray::from_mut_slice(&mut block);
        cipher.encrypt_block(&mut block_ga);
        out.extend_from_slice(&block);
        iv.copy_from_slice(&block);
    }
    Ok(out)
}

fn encrypt_3des_cbc_padded(k_enc: &[u8; 16], data: &[u8]) -> Result<Vec<u8>> {
    let padded = pad_iso9797(data, 8);
    encrypt_3des_cbc_raw(k_enc, &padded)
}

fn decrypt_3des_cbc_padded(k_enc: &[u8; 16], data: &[u8]) -> Result<Vec<u8>> {
    if data.len() % 8 != 0 {
        return Err(anyhow!("Encrypted data is not block aligned"));
    }
    let key = expand_3des_key(k_enc);
    let cipher = TdesEde3::new_from_slice(&key).map_err(|_| anyhow!("Invalid 3DES key"))?;
    let mut iv = [0u8; 8];
    let mut out = Vec::with_capacity(data.len());
    for chunk in data.chunks(8) {
        let mut block = [0u8; 8];
        block.copy_from_slice(chunk);
        let mut block_ga = GenericArray::from_mut_slice(&mut block);
        cipher.decrypt_block(&mut block_ga);
        for i in 0..8 {
            block[i] ^= iv[i];
        }
        out.extend_from_slice(&block);
        iv.copy_from_slice(chunk);
    }
    unpad_iso9797(out)
}

fn retail_mac(k_mac: &[u8; 16], data: &[u8]) -> Result<[u8; 8]> {
    let des1 = Des::new_from_slice(&k_mac[0..8]).map_err(|_| anyhow!("Invalid DES key"))?;
    let des2 = Des::new_from_slice(&k_mac[8..16]).map_err(|_| anyhow!("Invalid DES key"))?;
    let mut iv = [0u8; 8];
    for chunk in data.chunks(8) {
        let mut block = [0u8; 8];
        for i in 0..8 {
            block[i] = chunk[i] ^ iv[i];
        }
        let mut block_ga = GenericArray::from_mut_slice(&mut block);
        des1.encrypt_block(&mut block_ga);
        iv.copy_from_slice(&block);
    }
    let mut mac_block = iv;
    let mut block_ga = GenericArray::from_mut_slice(&mut mac_block);
    des2.decrypt_block(&mut block_ga);
    let mut block_ga = GenericArray::from_mut_slice(&mut mac_block);
    des1.encrypt_block(&mut block_ga);
    Ok(mac_block)
}

pub fn build_mutual_auth_data(k_enc: &[u8; 16], k_mac: &[u8; 16], rnd_ic: &[u8; 8]) -> Result<(Vec<u8>, u64)> {
    use rand_core::{OsRng, RngCore};

    let mut rnd_ifd = [0u8; 8];
    let mut k_ifd = [0u8; 16];
    OsRng.fill_bytes(&mut rnd_ifd);
    OsRng.fill_bytes(&mut k_ifd);

    let mut s = Vec::with_capacity(32);
    s.extend_from_slice(&rnd_ifd);
    s.extend_from_slice(rnd_ic);
    s.extend_from_slice(&k_ifd);

    let encrypted = encrypt_3des_cbc_raw(k_enc, &s)?;
    let mac = retail_mac(k_mac, &pad_iso9797(&encrypted, 8))?;
    let mut data = Vec::with_capacity(encrypted.len() + mac.len());
    data.extend_from_slice(&encrypted);
    data.extend_from_slice(&mac);

    let mut ssc_bytes = [0u8; 8];
    ssc_bytes[0..4].copy_from_slice(&rnd_ic[4..8]);
    ssc_bytes[4..8].copy_from_slice(&rnd_ifd[4..8]);
    let ssc = u64::from_be_bytes(ssc_bytes);

    Ok((data, ssc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apdu::ApduCommand;

    #[test]
    fn test_bac_sm_wrap() {
        let k_enc = [0x01u8; 16];
        let k_mac = [0x02u8; 16];
        let ssc = 0;
        let mut sm = BacSession::new(k_enc, k_mac, ssc);

        let cmd = ApduCommand::new(0x00, 0xA4, 0x02, 0x0C).with_data(&[0x01, 0x02]);
        
        let wrapped = sm.wrap_command(&cmd).unwrap();
        
        // Wrapped command should be CLA=0C (00 | 0C)
        assert_eq!(wrapped[0], 0x0C);
        
        // Should contain DO87 (Encrypted) and DO8E (MAC)
        // 87 ... 8E ...
        assert!(wrapped.windows(2).any(|w| w == [0x87, 0x09] || w[0] == 0x87)); // 01 + 8 bytes enc
        assert!(wrapped.windows(2).any(|w| w == [0x8E, 0x08]));
    }
}
