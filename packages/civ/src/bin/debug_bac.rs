use civ::apdu::{ApduCommand, CLA_ISO, INS_GET_CHALLENGE, INS_EXTERNAL_AUTHENTICATE, INS_SELECT_FILE};
use civ::crypto::bac;
use civ::PcscReader;
use civ::CardReader;
use std::error::Error;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let mrz = "TK3987783677030122102148";
    println!("Debug BAC for MRZ: {}", mrz);

    let mut reader = PcscReader::new()?;
    reader.connect()?;

    // 1. Select ICAO (Requesting FCI with Le=00)
    let aid = [0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01];
    println!("Sending SELECT ICAO (with Le=00)...");
    let sel_cmd = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
        .with_data(&aid)
        .with_le(0x00);
    let res = reader.transmit(&sel_cmd.to_bytes()).await?;
    println!("SELECT Res: {:02X?}", res);
    check_sw(&res, "SELECT")?;

    // 2. GET CHALLENGE
    println!("Sending GET CHALLENGE (Le=08)...");
    let gc_cmd = ApduCommand::new(CLA_ISO, INS_GET_CHALLENGE, 0x00, 0x00).with_le(0x08);
    let mut res_gc = reader.transmit(&gc_cmd.to_bytes()).await?;
    println!("GET CHALLENGE Res: {:02X?}", res_gc);
    
    if is_error(&res_gc) {
        println!("GET CHALLENGE failed. Retrying with Le=00 (Max)...");
        let gc_cmd_max = ApduCommand::new(CLA_ISO, INS_GET_CHALLENGE, 0x00, 0x00).with_le(0x00);
        res_gc = reader.transmit(&gc_cmd_max.to_bytes()).await?;
        println!("GET CHALLENGE (Max) Res: {:02X?}", res_gc);
    }
    
    check_sw(&res_gc, "GET CHALLENGE")?;
    let rnd_ic = &res_gc[0..8];
    let rnd_ic_arr: [u8; 8] = rnd_ic.try_into()?;

    // 3. Derive Keys
    let k_seed = bac::derive_key_seed(mrz);
    let (k_enc, k_mac) = bac::derive_session_keys(&k_seed);
    println!("Keys derived.");

    // 4. Build Auth Data
    let (auth_data, _ssc) = bac::build_mutual_auth_data(&k_enc, &k_mac, &rnd_ic_arr).unwrap();
    println!("Auth Data Len: {}", auth_data.len()); // Should be 40

    // 5. EXTERNAL AUTHENTICATE
    println!("Sending EXTERNAL AUTHENTICATE (Lc={})...", auth_data.len());
    let ext_auth = ApduCommand::new(CLA_ISO, INS_EXTERNAL_AUTHENTICATE, 0x00, 0x00).with_data(&auth_data);
    let res_auth = reader.transmit(&ext_auth.to_bytes()).await?;
    println!("EXTERNAL AUTHENTICATE Res: {:02X?}", res_auth);
    check_sw(&res_auth, "EXTERNAL AUTHENTICATE")?;

    println!("BAC Successful!");

    Ok(())
}

fn is_error(res: &[u8]) -> bool {
    if res.len() < 2 { return true; }
    let sw1 = res[res.len()-2];
    let sw2 = res[res.len()-1];
    !(sw1 == 0x90 && sw2 == 0x00)
}

fn check_sw(res: &[u8], context: &str) -> Result<(), String> {
    if res.len() < 2 { return Err(format!("{}: Too short", context)); }
    let sw1 = res[res.len()-2];
    let sw2 = res[res.len()-1];
    if sw1 == 0x90 && sw2 == 0x00 {
        Ok(())
    } else {
        Err(format!("{}: Failed SW: {:02X} {:02X}", context, sw1, sw2))
    }
}