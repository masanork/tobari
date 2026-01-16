use anyhow::{anyhow, Result};
use cipher::{BlockDecrypt, BlockEncrypt, KeyInit};
use des::{Des, TdesEde3};
use generic_array::GenericArray;
use sha1::{Digest, Sha1};

pub struct BacSession {
    k_enc: [u8; 16], // 2-key 3DES keys
    k_mac: [u8; 16],
    ssc: u64, // Send Sequence Counter
}

impl BacSession {
    pub fn new(k_enc: [u8; 16], k_mac: [u8; 16], ssc: u64) -> Self {
        Self { k_enc, k_mac, ssc }
    }

    pub fn is_null_session(&self) -> bool {
        self.k_enc == [0u8; 16] && self.k_mac == [0u8; 16]
    }

    pub fn wrap_command(&mut self, apdu: &crate::apdu::ApduCommand) -> Result<Vec<u8>> {
        let cla_sm = apdu.cla | 0x0C;
        self.ssc = self.ssc.wrapping_add(1);
        let ssc_bytes = self.ssc.to_be_bytes();

        if self.is_null_session() {
            return Ok(apdu.to_bytes());
        }

        let mut command_data = Vec::new();
        if !apdu.data.is_empty() {
            let encrypted = encrypt_3des_cbc_padded(&self.k_enc, &apdu.data)?;
            let mut value = Vec::with_capacity(1 + encrypted.len());
            value.push(0x01);
            value.extend_from_slice(&encrypted);
            let do87 = [vec![0x87], encode_length(value.len()), value].concat();
            command_data.extend_from_slice(&do87);
        }

        if let Some(le) = apdu.le {
            let le_val = if le == 256 || le == 0 { 0x00 } else { le as u8 };
            let do97 = vec![0x97, 0x01, le_val];
            command_data.extend_from_slice(&do97);
        }

        let mac_input = build_mac_input(
            &ssc_bytes,
            cla_sm,
            apdu.ins,
            apdu.p1,
            apdu.p2,
            &command_data,
        );
        let mac = retail_mac(&self.k_mac, &mac_input)?;
        let mut do8e = Vec::new();
        do8e.push(0x8E);
        do8e.extend_from_slice(&[0x08]);
        do8e.extend_from_slice(&mac);
        command_data.extend_from_slice(&do8e);

        let wrapped = crate::apdu::ApduCommand::new(cla_sm, apdu.ins, apdu.p1, apdu.p2)
            .with_data(&command_data);
        let mut bytes = wrapped.to_bytes();
        bytes.push(0x00); // Le' always present for MRTD SM
        Ok(bytes)
    }

    pub fn unwrap_response(&mut self, response: &[u8]) -> Result<(Vec<u8>, u8, u8)> {
        if response.len() < 2 {
            return Err(anyhow!("Secure messaging response too short"));
        }

        if self.is_null_session() {
            let sw1 = response[response.len() - 2];
            let sw2 = response[response.len() - 1];
            let data = if response.len() > 2 {
                response[0..response.len() - 2].to_vec()
            } else {
                Vec::new()
            };
            return Ok((data, sw1, sw2));
        }

        let (raw_data, sw_bytes) = response.split_at(response.len() - 2);
        let sw1 = sw_bytes[0];
        let sw2 = sw_bytes[1];
        if sw1 != 0x90 || sw2 != 0x00 {
            return Err(anyhow!(
                "Secure messaging transport error: SW={:02X}{:02X}",
                sw1,
                sw2
            ));
        }

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

    pub fn wrap_response_from_card(
        &mut self,
        res_data: &[u8],
        sw1: u8,
        sw2: u8,
    ) -> Result<Vec<u8>> {
        self.ssc = self.ssc.wrapping_add(1);
        let ssc_bytes = self.ssc.to_be_bytes();

        if self.is_null_session() {
            let mut out = res_data.to_vec();
            out.push(sw1);
            out.push(sw2);
            return Ok(out);
        }

        let mut wrapped = Vec::new();
        if !res_data.is_empty() {
            let encrypted = encrypt_3des_cbc_padded(&self.k_enc, res_data)?;
            wrapped.push(0x87);
            let mut value = vec![0x01];
            value.extend_from_slice(&encrypted);
            wrapped.extend_from_slice(&encode_length(value.len()));
            wrapped.extend_from_slice(&value);
        }

        wrapped.push(0x99);
        wrapped.push(0x02);
        wrapped.push(sw1);
        wrapped.push(sw2);

        let mac_input = build_mac_input_response(&ssc_bytes, &wrapped);
        let mac = retail_mac(&self.k_mac, &mac_input)?;
        wrapped.push(0x8E);
        wrapped.push(0x08);
        wrapped.extend_from_slice(&mac);

        Ok(wrapped)
    }

    pub fn unwrap_command(
        &mut self,
        cmd: &crate::apdu::ApduCommand,
    ) -> Result<crate::apdu::ApduCommand> {
        if (cmd.cla & 0x0C) == 0 {
            return Ok(cmd.clone());
        }

        self.ssc = self.ssc.wrapping_add(1);
        let ssc_bytes = self.ssc.to_be_bytes();

        if self.is_null_session() {
            return Ok(crate::apdu::ApduCommand {
                cla: cmd.cla & !0x0C,
                ins: cmd.ins,
                p1: cmd.p1,
                p2: cmd.p2,
                data: cmd.data.clone(),
                le: cmd.le,
            });
        }

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

        let do8e = do8e.ok_or_else(|| anyhow!("Missing DO8E (MAC) in SM command"))?;

        let mut mac_input = Vec::new();
        mac_input.extend_from_slice(&ssc_bytes);
        mac_input.extend_from_slice(&[cmd.cla | 0x0C, cmd.ins, cmd.p1, cmd.p2]);
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

        let mac_input_padded = pad_iso9797(&mac_input, 8);
        let expected_mac = retail_mac(&self.k_mac, &mac_input_padded)?;
        if expected_mac.as_slice() != do8e.as_slice() {
            return Err(anyhow!("SM Command MAC Mismatch"));
        }

        let mut plain_data = Vec::new();
        if let Some(value) = do87 {
            if value.is_empty() || value[0] != 0x01 {
                return Err(anyhow!("Invalid DO87 format"));
            }
            plain_data = decrypt_3des_cbc_padded(&self.k_enc, &value[1..])?;
        }

        let plain_le = if let Some(le_val) = do97 {
            if le_val.len() == 1 {
                Some(le_val[0] as usize)
            } else {
                None
            }
        } else {
            None
        };

        let mut new_cmd = crate::apdu::ApduCommand::new(cmd.cla & !0x0C, cmd.ins, cmd.p1, cmd.p2)
            .with_data(&plain_data);
        if let Some(le) = plain_le {
            new_cmd = new_cmd.with_le(le);
        }
        Ok(new_cmd)
    }
}

pub fn derive_key_seed(mrz: &str) -> [u8; 16] {
    let mut hasher = Sha1::new();
    hasher.update(mrz.as_bytes());
    let hash = hasher.finalize();
    let mut k_seed = [0u8; 16];
    k_seed.copy_from_slice(&hash[0..16]);
    k_seed
}

pub fn derive_session_keys(k_seed: &[u8; 16]) -> ([u8; 16], [u8; 16]) {
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
    let mut key = [0u8; 16];
    key.copy_from_slice(&hash[0..16]);
    adjust_parity(&mut key);
    key
}

fn adjust_parity(key: &mut [u8]) {
    for byte in key.iter_mut() {
        let mask = 0xFE;
        let mut b = *byte & mask;
        let ones = b.count_ones();
        if ones % 2 == 0 {
            b |= 1;
        }
        *byte = b;
    }
}

fn build_mac_input(ssc: &[u8; 8], cla: u8, ins: u8, p1: u8, p2: u8, tlvs: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 8 + tlvs.len());
    data.extend_from_slice(ssc);
    data.extend_from_slice(&[cla, ins, p1, p2]);
    // ICAO 9303: command header padded to 8 bytes with 0x80 00 00 00
    data.extend_from_slice(&[0x80, 0x00, 0x00, 0x00]);
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
    while !out.len().is_multiple_of(block_size) {
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
    if !data.len().is_multiple_of(8) {
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
        let mut block_ga = *GenericArray::from_slice(&block);
        cipher.encrypt_block(&mut block_ga);
        block.copy_from_slice(&block_ga);
        out.extend_from_slice(&block);
        iv.copy_from_slice(&block);
    }
    Ok(out)
}

fn encrypt_3des_cbc_padded(k_enc: &[u8; 16], data: &[u8]) -> Result<Vec<u8>> {
    let padded = pad_iso9797(data, 8);
    encrypt_3des_cbc_raw(k_enc, &padded)
}

fn decrypt_3des_cbc_raw(k_enc: &[u8; 16], data: &[u8]) -> Result<Vec<u8>> {
    if !data.len().is_multiple_of(8) {
        return Err(anyhow!("Encrypted data is not block aligned"));
    }
    let key = expand_3des_key(k_enc);
    let cipher = TdesEde3::new_from_slice(&key).map_err(|_| anyhow!("Invalid 3DES key"))?;
    let mut iv = [0u8; 8];
    let mut out = Vec::with_capacity(data.len());
    for chunk in data.chunks(8) {
        let mut block = [0u8; 8];
        block.copy_from_slice(chunk);
        let mut block_ga = *GenericArray::from_slice(&block);
        cipher.decrypt_block(&mut block_ga);
        block.copy_from_slice(&block_ga);
        for i in 0..8 {
            block[i] ^= iv[i];
        }
        out.extend_from_slice(&block);
        iv.copy_from_slice(chunk);
    }
    Ok(out)
}

fn decrypt_3des_cbc_padded(k_enc: &[u8; 16], data: &[u8]) -> Result<Vec<u8>> {
    let decrypted = decrypt_3des_cbc_raw(k_enc, data)?;
    unpad_iso9797(decrypted)
}

fn retail_mac(k_mac: &[u8; 16], data: &[u8]) -> Result<[u8; 8]> {
    let des1 =
        <Des as KeyInit>::new_from_slice(&k_mac[0..8]).map_err(|_| anyhow!("Invalid DES key 1"))?;
    let des2 = <Des as KeyInit>::new_from_slice(&k_mac[8..16])
        .map_err(|_| anyhow!("Invalid DES key 2"))?;
    let mut iv = [0u8; 8];
    for chunk in data.chunks(8) {
        let mut block = [0u8; 8];
        if chunk.len() < 8 {
            let mut padded = [0u8; 8];
            padded[..chunk.len()].copy_from_slice(chunk);
            for i in 0..8 {
                block[i] = padded[i] ^ iv[i];
            }
        } else {
            for i in 0..8 {
                block[i] = chunk[i] ^ iv[i];
            }
        }
        let mut block_ga = *GenericArray::from_slice(&block);
        des1.encrypt_block(&mut block_ga);
        block.copy_from_slice(&block_ga);
        iv.copy_from_slice(&block);
    }
    let mut mac_block = iv;
    let mut block_ga = *GenericArray::from_slice(&mac_block);
    des2.decrypt_block(&mut block_ga);
    mac_block.copy_from_slice(&block_ga);

    let mut block_ga = *GenericArray::from_slice(&mac_block);
    des1.encrypt_block(&mut block_ga);
    mac_block.copy_from_slice(&block_ga);

    Ok(mac_block)
}

pub fn build_mutual_auth_data(
    k_enc: &[u8; 16],
    k_mac: &[u8; 16],
    rnd_ic: &[u8; 8],
) -> Result<(Vec<u8>, u64, [u8; 8], [u8; 16])> {
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
    Ok((data, ssc, rnd_ifd, k_ifd))
}

pub fn decrypt_mutual_auth_response(k_enc: &[u8; 16], encrypted: &[u8]) -> Result<[u8; 32]> {
    let decrypted = decrypt_3des_cbc_raw(k_enc, encrypted)?;
    if decrypted.len() != 32 {
        return Err(anyhow!("Invalid mutual auth response length"));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&decrypted);
    Ok(out)
}

pub fn mock_mutual_auth_response(
    k_enc: &[u8; 16],
    k_mac: &[u8; 16],
    cmd_data: &[u8],
    rnd_icc: &[u8; 8],
) -> Result<(Vec<u8>, u64)> {
    if cmd_data.len() < 8 {
        return Err(anyhow!("Command too short"));
    }
    let encrypted_part = &cmd_data[0..cmd_data.len() - 8];
    // Decrypt RAW because mutual auth data is not padded if 32 bytes
    let decrypted = decrypt_3des_cbc_raw(k_enc, encrypted_part)?;
    if decrypted.len() != 32 {
        return Err(anyhow!("Invalid auth payload length"));
    }

    let rnd_ifd = &decrypted[0..8];
    // rnd_icc_recv = &decrypted[8..16] should match our rnd_icc
    // k_ifd = &decrypted[16..32]

    use rand_core::{OsRng, RngCore};
    let mut k_icc = [0u8; 16];
    OsRng.fill_bytes(&mut k_icc);

    let mut s = Vec::with_capacity(32);
    s.extend_from_slice(rnd_icc);
    s.extend_from_slice(rnd_ifd);
    s.extend_from_slice(&k_icc);

    let encrypted_resp = encrypt_3des_cbc_raw(k_enc, &s)?;
    let mac = retail_mac(k_mac, &pad_iso9797(&encrypted_resp, 8))?;

    let mut data = Vec::with_capacity(encrypted_resp.len() + mac.len());
    data.extend_from_slice(&encrypted_resp);
    data.extend_from_slice(&mac);

    let mut ssc_bytes = [0u8; 8];
    ssc_bytes[0..4].copy_from_slice(&rnd_icc[4..8]);
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
        let mut sm = BacSession::new(k_enc, k_mac, 0);
        let cmd = ApduCommand::new(0x00, 0xA4, 0x02, 0x0C).with_data(&[0x01, 0x02]);
        let wrapped = sm.wrap_command(&cmd).unwrap();
        assert_eq!(wrapped[0], 0x0C);
    }

    #[test]
    fn test_bac_sm_unwrap() {
        let k_enc = [0x01u8; 16];
        let k_mac = [0x02u8; 16];
        let mut sm = BacSession::new(k_enc, k_mac, 0);
        let plaintext = vec![0x11, 0x22, 0x33];
        let encrypted = encrypt_3des_cbc_padded(&k_enc, &plaintext).unwrap();
        let mut do87 = vec![0x87, (encrypted.len() + 1) as u8, 0x01];
        do87.extend_from_slice(&encrypted);
        let do99 = vec![0x99, 0x02, 0x90, 0x00];
        let mut mac_input = 1u64.to_be_bytes().to_vec();
        mac_input.extend_from_slice(&do87);
        mac_input.extend_from_slice(&do99);
        let mac = retail_mac(&k_mac, &pad_iso9797(&mac_input, 8)).unwrap();
        let mut full_resp = do87;
        full_resp.extend_from_slice(&do99);
        full_resp.extend_from_slice(&[0x8E, 0x08]);
        full_resp.extend_from_slice(&mac);
        full_resp.extend_from_slice(&[0x90, 0x00]);
        let (res_data, sw1, sw2) = sm.unwrap_response(&full_resp).unwrap();
        assert_eq!(res_data, plaintext);
        assert_eq!(sw1, 0x90);
        assert_eq!(sw2, 0x00);
    }
}
