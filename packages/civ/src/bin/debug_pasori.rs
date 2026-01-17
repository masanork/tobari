use civ::native_reader::PcscReader;
use civ::reader::CardReader;
use civ::apdu::{ApduCommand, CLA_ISO, INS_SELECT_FILE};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut reader = PcscReader::new()?;
    println!("Reader connected.");

    let apdu = ApduCommand::new(CLA_ISO, INS_SELECT_FILE, 0x04, 0x0C)
        .with_data(&[0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01]);
    
    let res = reader.transmit(&apdu.to_bytes()).await?;
    println!("Response: {:02X?}", res);

    Ok(())
}
