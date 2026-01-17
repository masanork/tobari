use civ::native_reader::PcscReader;
use civ::reader::CardReader;
use civ::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE, INS_GET_CHALLENGE, INS_EXTERNAL_AUTHENTICATE};
use civ::crypto::bac;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut reader = PcscReader::new()?;
    let mrz = std::env::args().nth(1).expect("MRZ required");

    let sel_cmd = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
        .with_data(&[0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01]);
    let _ = reader.transmit(&sel_cmd.to_bytes()).await?;

    let gc_cmd = ApduCommand::new(CLA_ISO, INS_GET_CHALLENGE, 0x00, 0x00).with_le(0x08);
    let res_gc = reader.transmit(&gc_cmd.to_bytes()).await?;
    let rnd_ic = &res_gc[0..8];

    let k_seed = bac::derive_key_seed(&mrz);
    let (k_enc, k_mac) = bac::derive_session_keys(&k_seed);
    let (auth_data, _, _, _) = bac::build_mutual_auth_data(&k_enc, &k_mac, rnd_ic.try_into()?)?;

    let ext_auth = ApduCommand::new(CLA_ISO, INS_EXTERNAL_AUTHENTICATE, 0x00, 0x00)
        .with_data(&auth_data).with_le(0x28);
    let res_auth = reader.transmit(&ext_auth.to_bytes()).await?;
    println!("Auth Res: {:02X?}", res_auth);

    Ok(())
}