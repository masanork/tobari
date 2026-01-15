use civ::{PcscReader, CardReader};
use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    println!("--- PaSoRi / JPDL Debug Tool ---");
    let mut reader = PcscReader::new()?;
    let name = reader.connect()?;
    println!("Connected to: {}", name);

    // 1. SELECT MF
    println!("Step 1: SELECT MF...");
    reader.transmit(&[0x00, 0xA4, 0x00, 0x00]).await?;

    // 2. SELECT JPDL AP
    println!("Step 2: SELECT JPDL AP...");
    let select_jpdl = [0x00, 0xA4, 0x04, 0x0C, 0x10, 
        0xA0, 0x00, 0x00, 0x02, 0x31, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    let res = reader.transmit(&select_jpdl).await?;
    println!("Res: {:02X?}", res);

    // 3. SELECT EF01 (Common Data)
    println!("Step 3: SELECT EF01...");
    let res = reader.transmit(&[0x00, 0xA4, 0x02, 0x0C, 0x02, 0x00, 0x01]).await?;
    println!("Res: {:02X?}", res);

    // 4. READ BINARY (EF01) first 16 bytes
    let res = reader.transmit(&[0x00, 0xB0, 0x00, 0x00, 0x10]).await?;
    println!("EF01 Header: {:02X?}", res);

    // 5. SELECT MF (Reset)
    reader.transmit(&[0x00, 0xA4, 0x00, 0x00]).await?;

    // 6. SELECT DF2 (Photo)
    println!("Step 6: SELECT DF2...");
    let select_photo = [0x00, 0xA4, 0x04, 0x0C, 0x10, 
        0xA0, 0x00, 0x00, 0x02, 0x31, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    let res = reader.transmit(&select_photo).await?;
    println!("Res: {:02X?}", res);

    // 7. SELECT EF01 in DF2
    println!("Step 7: SELECT EF01 in DF2...");
    let res = reader.transmit(&[0x00, 0xA4, 0x02, 0x0C, 0x02, 0x00, 0x01]).await?;
    println!("Res: {:02X?}", res);

    // 8. READ BINARY (EF01) first 16 bytes
    let res = reader.transmit(&[0x00, 0xB0, 0x00, 0x00, 0x10]).await?;
    println!("Photo EF Header: {:02X?}", res);

    println!("Debug finished.");
    Ok(())
}