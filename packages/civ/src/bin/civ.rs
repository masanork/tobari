#[cfg(not(target_arch = "wasm32"))]
use clap::{Parser, Subcommand};
#[cfg(not(target_arch = "wasm32"))]
use civ::{JpkiController, PcscReader};
#[cfg(not(target_arch = "wasm32"))]
use std::fs;
#[cfg(not(target_arch = "wasm32"))]
use base64::Engine;
#[cfg(not(target_arch = "wasm32"))]
use rpassword::read_password;

#[cfg(not(target_arch = "wasm32"))]
#[derive(Parser)]
#[command(name = "civ")]
#[command(about = "CIV (Citizen Identity Verification) CLI Tool", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Subcommand)]
enum Commands {
    /// JPKI (My Number Card) Operations
    #[command(name = "jpki")]
    Jpki {
        #[command(subcommand)]
        command: JpkiCommands,
    },
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Subcommand)]
enum JpkiCommands {
    /// Show PIN retry counts
    #[command(name = "retries")]
    Retries,
    /// Read certificate
    #[command(name = "cert")]
    Cert {
        /// Type: auth or sign
        #[arg(short, long, default_value = "auth")]
        type_: String,
        /// Output file
        #[arg(short, long)]
        output: Option<String>,
    },
    /// Sign data
    #[command(name = "sign")]
    Sign {
        /// Data to sign
        #[arg(short, long)]
        data: String,
        /// Type: auth or sign
        #[arg(short, long, default_value = "auth")]
        type_: String,
        /// PIN
        #[arg(short, long, env = "JPKI_PIN")]
        pin: Option<String>,
    },
    /// Read My Number
    #[command(name = "num")]
    Mynumber {
        /// PIN (4 digits)
        #[arg(short, long, env = "JPKI_PIN")]
        pin: Option<String>,
    },
    /// Read Attributes and Photo
    #[command(name = "attr")]
    Card {
        /// PIN (4 digits)
        #[arg(short, long, env = "JPKI_PIN")]
        pin: Option<String>,
        /// Save photo
        #[arg(long)]
        photo: Option<String>,
        /// Expiration Date (YYYYMMDD)
        #[arg(long)]
        exp: Option<String>,
        /// Security Code (4 digits)
        #[arg(long)]
        sc: Option<String>,
    },
}

#[cfg(not(target_arch = "wasm32"))]
fn get_pin(provided: Option<String>, prompt: &str) -> anyhow::Result<String> {
    if let Some(p) = provided {
        Ok(p)
    } else {
        print!("{}", prompt);
        use std::io::Write;
        std::io::stdout().flush()?;
        let pin = read_password()?;
        Ok(pin.trim().to_string())
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let mut reader = PcscReader::new()?;
    let _ = reader.connect()?;

    match cli.command {
        Commands::Jpki { command } => {
            let mut controller = JpkiController::new(reader);
            match command {
                JpkiCommands::Retries => {
                    println!("--- PIN Retry Counts ---");
                    let _ = controller.get_auth_pin_retries().await.map(|c| println!("Auth PIN: {}", c));
                    let _ = controller.get_sign_pin_retries().await.map(|c| println!("Sign PIN: {}", c));
                    let _ = controller.get_input_support_pin_retries().await.map(|c| println!("Input Support: {}", c));
                    let _ = controller.get_surface_pin_retries().await.map(|c| println!("Surface PIN (12-digit): {}", c));
                }
                JpkiCommands::Cert { type_, output } => {
                    let data = if type_ == "sign" { controller.read_sign_cert().await? } else { controller.read_auth_cert().await? };
                    if let Some(p) = output { fs::write(p, &data)?; } else { println!("Hex: {}", hex::encode(data)); }
                }
                JpkiCommands::Sign { data, type_, pin } => {
                    let prompt = if type_ == "sign" { "Sign Pass: " } else { "Auth PIN: " };
                    let p = get_pin(pin, prompt)?;
                    let sig = if type_ == "sign" { controller.compute_digital_signature(&p, data.as_bytes()).await? } else { controller.compute_auth_signature(&p, data.as_bytes()).await? };
                    println!("Signature: {}", hex::encode(sig));
                }
                JpkiCommands::Mynumber { pin } => {
                    let p = get_pin(pin, "PIN: ")?;
                    println!("MyNumber: {}", controller.read_mynumber(&p).await?);
                }
                JpkiCommands::Card { pin, photo, exp: _, sc: _ } => {
                    let p = get_pin(pin, "Enter Input Support PIN (4 digits): ")?;
                    let my_number = match controller.read_mynumber(&p).await {
                        Ok(num) => Some(num),
                        Err(e) => {
                            if photo.is_some() { println!("Warning: Failed to retrieve My Number (needed for photo): {}", e); }
                            None
                        }
                    };
                    let mut info = controller.read_attributes(&p).await?;
                    
                    if photo.is_some() {
                        let mut photo_data = None;
                        if let Some(ref num) = my_number {
                            match controller.get_surface_pin_retries().await {
                                Ok(retries) => {
                                    if retries > 3 || retries == 255 {
                                        println!("Attempting photo extraction via Surface PIN (My Number)...");
                                        match controller.read_face_photo(num).await {
                                            Ok(data) => photo_data = Some(data),
                                            Err(e) => println!("Error: Photo extraction failed: {}", e),
                                        }
                                    } else {
                                        println!("Warning: Surface PIN has only {} retries left. Skipping photo extraction for safety.", retries);
                                    }
                                }
                                Err(e) => println!("Error: Failed to check Surface PIN status: {}", e),
                            }
                        } else {
                            println!("Skipping photo extraction: My Number not available.");
                        }
                        
                        if let Some(data) = photo_data {
                            println!("Photo retrieved successfully!");
                            info.face_photo = Some(base64::engine::general_purpose::STANDARD.encode(data));
                        }
                    }
                    println!("\n{}", info);
                    if let (Some(path), Some(b64)) = (photo, info.face_photo) {
                        fs::write(path, base64::engine::general_purpose::STANDARD.decode(b64)?)?;
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(target_arch = "wasm32")]
fn main() {}
