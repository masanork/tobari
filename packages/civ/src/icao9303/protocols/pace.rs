use crate::apdu::ApduCommand;
use crate::crypto::pace::{PaceMappingType, PaceP256};
use crate::crypto::sm::AesSecureMessaging;
use crate::errors::{CivError, Result};
use crate::reader::CardReader;
use crate::icao9303::utils::{check_sw, encode_len, parse_pace_response};

pub async fn perform_pace<R: CardReader>(reader: &mut R, mrz_or_can: &str) -> Result<AesSecureMessaging> {
    let select = ApduCommand::new(0x00, 0xA4, 0x04, 0x0C).with_data(&[
        0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01,
    ]);
    let res_sel = reader.transmit(&select.to_bytes()).await?;
    check_sw(&res_sel)?;

    let oid_pace_gm_aes = vec![
        0x04, 0x00, 0x7F, 0x00, 0x07, 0x02, 0x02, 0x04, 0x02, 0x02,
    ];
    let mut mse_val = vec![0x80, oid_pace_gm_aes.len() as u8];
    mse_val.extend_from_slice(&oid_pace_gm_aes);
    mse_val.extend_from_slice(&[0x83, 0x01, 0x01]);

    let mse_set = ApduCommand::new(0x00, 0x22, 0xC1, 0xA4).with_data(&mse_val);
    let res = reader.transmit(&mse_set.to_bytes()).await?;
    check_sw(&res)?;

    let mut pace = PaceP256::new(mrz_or_can, PaceMappingType::GenericMapping, 16);
    let gen_auth_1 = ApduCommand::new(0x10, 0x86, 0x00, 0x00)
        .with_data(&[0x7C, 0x00])
        .with_le(0x00);
    let res_nonce = reader.transmit(&gen_auth_1.to_bytes()).await?;
    check_sw(&res_nonce)?;
    let z = parse_pace_response(&res_nonce, 0x80)?;
    pace.set_encrypted_nonce(&z);

    let my_pk = pace
        .perform_mapping_and_generate_key()
        .map_err(|e| CivError::CryptoError(e.to_string()))?;
    let mut cmd_data_2 = vec![0x7C];
    let mut inner_2 = vec![0x81];
    inner_2.extend_from_slice(&encode_len(my_pk.len()));
    inner_2.extend_from_slice(&my_pk);
    cmd_data_2.extend_from_slice(&encode_len(inner_2.len()));
    cmd_data_2.extend_from_slice(&inner_2);

    let gen_auth_2 = ApduCommand::new(0x10, 0x86, 0x00, 0x00)
        .with_data(&cmd_data_2)
        .with_le(0x00);
    let res_map = reader.transmit(&gen_auth_2.to_bytes()).await?;
    check_sw(&res_map)?;
    let peer_pk = parse_pace_response(&res_map, 0x82)?;
    pace.compute_shared_secret(&peer_pk)
        .map_err(|e| CivError::CryptoError(e.to_string()))?;

    let t_pcd = pace.perform_token_exchange(&[])?;
    let mut cmd_data_3 = vec![0x7C];
    let mut inner_3 = vec![0x85];
    inner_3.extend_from_slice(&encode_len(t_pcd.len()));
    inner_3.extend_from_slice(&t_pcd);
    cmd_data_3.extend_from_slice(&encode_len(inner_3.len()));
    cmd_data_3.extend_from_slice(&inner_3);

    let gen_auth_3 = ApduCommand::new(0x10, 0x86, 0x00, 0x00)
        .with_data(&cmd_data_3)
        .with_le(0x00);
    let res_auth = reader.transmit(&gen_auth_3.to_bytes()).await?;
    check_sw(&res_auth)?;

    let t_picc = parse_pace_response(&res_auth, 0x86)?;
    pace.perform_token_exchange(&t_picc)
        .map_err(|e| CivError::AuthenticationFailed(e.to_string()))?;

    let session = pace
        .finalize_session()
        .map_err(|e| CivError::AuthenticationFailed(e.to_string()))?;
    
    AesSecureMessaging::new(&session.k_enc, &session.k_mac, session.ssc)
        .map_err(|e| CivError::SecureMessagingError(e.to_string()))
}
