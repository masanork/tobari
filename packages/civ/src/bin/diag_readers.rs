use pcsc::{Context, Scope};

fn main() {
    println!("--- PC/SC Reader Diagnosis ---");
    let ctx = match Context::establish(Scope::User) {
        Ok(ctx) => ctx,
        Err(e) => {
            println!("Failed to establish PC/SC context: {}", e);
            return;
        }
    };

    let mut readers_buf = [0; 2048];
    match ctx.list_readers(&mut readers_buf) {
        Ok(readers) => {
            let mut count = 0;
            for reader in readers {
                println!("Found reader: {:?}", reader);
                count += 1;
            }
            if count == 0 {
                println!("No readers found. (Is the driver installed?)");
            }
        }
        Err(e) => {
            println!("Failed to list readers: {}", e);
        }
    }
}
