use crate::apdu::{ApduCommand, CLA_ISO, INS_INTERNAL_AUTHENTICATE};
use crate::errors::Result;
use crate::reader::CardReader;
use crate::passport::utils::check_sw;

pub async fn perform_active_authentication<R: CardReader>(
    reader: &mut R,
    challenge: &[u8],
) -> Result<Vec<u8>> {
    let apdu = ApduCommand::new(CLA_ISO, INS_INTERNAL_AUTHENTICATE, 0x00, 0x00)
        .with_data(challenge)
        .with_le(0x00);
    let res = reader.transmit(&apdu.to_bytes()).await?;
    check_sw(&res)?;
    Ok(res[0..res.len() - 2].to_vec())
}
