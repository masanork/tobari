use crate::apdu::ApduCommand;
use crate::crypto::pace::derive_session_keys_sha256;
use crate::crypto::sm::AesSecureMessaging;
use crate::errors::{CivError, Result};
use crate::reader::CardReader;
use crate::passport::utils::{check_sw, encode_len};
use p256::{ecdh::EphemeralSecret, elliptic_curve::sec1::ToEncodedPoint, PublicKey};
use rand_core::OsRng;

pub async fn perform_chip_authentication<R: CardReader>(
    reader: &mut R,
    ca_oid: &[u8],
    picc_pk_bytes: &[u8],
) -> Result<AesSecureMessaging> {
    let secret = EphemeralSecret::random(&mut OsRng);
    let public_key = PublicKey::from(&secret);
    let pk_bytes = public_key.to_encoded_point(false).as_bytes().to_vec();

    let mut mse_data = vec![0x80];
    mse_data.extend_from_slice(&encode_len(ca_oid.len()));
    mse_data.extend_from_slice(ca_oid);

    let mse_cmd = ApduCommand::new(0x00, 0x22, 0x41, 0xA6).with_data(&mse_data);
    let res_mse = reader.transmit(&mse_cmd.to_bytes()).await?;
    check_sw(&res_mse)?;

    let mut cmd_data = vec![0x7C];
    let mut inner = vec![0x80];
    inner.extend_from_slice(&encode_len(pk_bytes.len()));
    inner.extend_from_slice(&pk_bytes);
    cmd_data.extend_from_slice(&encode_len(inner.len()));
    cmd_data.extend_from_slice(&inner);

    let gen_auth = ApduCommand::new(0x00, 0x86, 0x00, 0x00)
        .with_data(&cmd_data)
        .with_le(0x00);
    let res_auth = reader.transmit(&gen_auth.to_bytes()).await?;
    check_sw(&res_auth)?;

    let picc_pk = PublicKey::from_sec1_bytes(picc_pk_bytes)
        .map_err(|e| CivError::CryptoError(format!("Invalid PICC Public Key: {}", e)))?;
    let shared_secret = secret.diffie_hellman(&picc_pk);
    let (k_enc, k_mac) =
        derive_session_keys_sha256(shared_secret.raw_secret_bytes().as_slice(), 16);

    AesSecureMessaging::new(&k_enc, &k_mac, 0)
        .map_err(|e| CivError::SecureMessagingError(e.to_string()))
}
