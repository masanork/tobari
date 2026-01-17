use crate::apdu::{ApduCommand, CLA_ISO, INS_EXTERNAL_AUTHENTICATE, INS_GET_CHALLENGE};
use crate::crypto::bac::{self, BacSession};
use crate::errors::{CivError, Result};
use crate::reader::CardReader;

pub async fn perform_bac<R: CardReader>(reader: &mut R, mrz: &str) -> Result<BacSession> {
    let select = ApduCommand::new(0x00, 0xA4, 0x04, 0x0C).with_data(&[
        0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01,
    ]);
    let res_sel = reader.transmit(&select.to_bytes()).await?;
    check_sw(&res_sel)?;

    let k_seed = bac::derive_key_seed(mrz);
    let (k_enc, k_mac) = bac::derive_session_keys(&k_seed);

    let get_challenge =
        ApduCommand::new(CLA_ISO, INS_GET_CHALLENGE, 0x00, 0x00).with_le(0x08);
    let rnd_ic_response = reader.transmit(&get_challenge.to_bytes()).await?;
    check_sw(&rnd_ic_response)?;
    let rnd_ic = &rnd_ic_response[0..8];

    let rnd_ic: [u8; 8] = rnd_ic
        .try_into()
        .map_err(|_| CivError::Communication("Invalid RND.ICC".to_string()))?;
    let (auth_data, ssc, rnd_ifd, k_ifd) = bac::build_mutual_auth_data(&k_enc, &k_mac, &rnd_ic)
        .map_err(|e| CivError::AuthenticationFailed(e.to_string()))?;
    
    let external_auth = ApduCommand::new(CLA_ISO, INS_EXTERNAL_AUTHENTICATE, 0x00, 0x00)
        .with_data(&auth_data)
        .with_le(0x28);
    let response = reader.transmit(&external_auth.to_bytes()).await?;
    check_sw(&response)?;
    
    let response_data = response[0..response.len() - 2].to_vec();
    if response_data.len() < 40 {
        return Err(CivError::AuthenticationFailed(
            "Mutual auth response too short".to_string(),
        ));
    }
    let enc_res = &response_data[0..32];
    let s_res =
        bac::decrypt_mutual_auth_response(&k_enc, enc_res).map_err(|e| {
            CivError::AuthenticationFailed(e.to_string())
        })?;
    let rnd_ic_res = &s_res[0..8];
    let rnd_ifd_res = &s_res[8..16];
    let k_ic = &s_res[16..32];

    if rnd_ic_res != rnd_ic {
        return Err(CivError::AuthenticationFailed(
            "Mutual auth RND.IC mismatch".to_string(),
        ));
    }
    if rnd_ifd_res != rnd_ifd {
        return Err(CivError::AuthenticationFailed(
            "Mutual auth RND.IFD mismatch".to_string(),
        ));
    }

    let mut k_seed = [0u8; 16];
    for i in 0..16 {
        k_seed[i] = k_ifd[i] ^ k_ic[i];
    }
    let (ks_enc, ks_mac) = bac::derive_session_keys(&k_seed);

    Ok(BacSession::new(ks_enc, ks_mac, ssc))
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
