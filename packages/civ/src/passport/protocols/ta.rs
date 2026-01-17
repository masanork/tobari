use crate::apdu::ApduCommand;
use crate::errors::{CivError, Result};
use crate::reader::CardReader;
use crate::passport::utils::check_sw;
use p256::ecdsa::{Signature, SigningKey};
use signature::Signer;

pub async fn perform_terminal_authentication<R: CardReader>(
    reader: &mut R,
    cert_chain: &[Vec<u8>],
    terminal_priv_key: &[u8],
) -> Result<()> {
    for cert in cert_chain {
        let mse_cmd = ApduCommand::new(0x00, 0x22, 0x81, 0xB6).with_data(cert);
        let res = reader.transmit(&mse_cmd.to_bytes()).await?;
        check_sw(&res)?;
    }
    let get_challenge = ApduCommand::new(0x00, 0x84, 0x00, 0x00).with_le(0x08);
    let res_challenge = reader.transmit(&get_challenge.to_bytes()).await?;
    check_sw(&res_challenge)?;
    let challenge = &res_challenge[0..8];

    let signing_key = SigningKey::from_slice(terminal_priv_key)
        .map_err(|e| CivError::CryptoError(format!("Invalid key: {}", e)))?;
    let signature: Signature = signing_key.sign(challenge);
    let sig_bytes = signature.to_bytes().to_vec();

    let ext_auth = ApduCommand::new(0x00, 0x82, 0x00, 0x00).with_data(&sig_bytes);
    let res_auth = reader.transmit(&ext_auth.to_bytes()).await?;
    check_sw(&res_auth)?;
    Ok(())
}
