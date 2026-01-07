#[cfg(not(target_arch = "wasm32"))]
use clap::{Parser, Subcommand};
#[cfg(not(target_arch = "wasm32"))]
use civ::{JpkiController, PcscReader, CardReader};
#[cfg(not(target_arch = "wasm32"))]
use civ::demo_reader::DemoReader;
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
    /// Use demo/mock reader instead of real card reader
    #[arg(long, global = true)]
    demo: bool,

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
        /// Data to sign (string)
        #[arg(short, long, group = "input")]
        data: Option<String>,
        /// Input file path
        #[arg(short, long, group = "input")]
        input: Option<String>,
        /// Output file path (optional, default stdout hex)
        #[arg(short, long)]
        output: Option<String>,
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
        /// Output JSON
        #[arg(long)]
        json: bool,
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
        /// Output JSON
        #[arg(long)]
        json: bool,
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
async fn run_jpki<R: CardReader>(mut controller: JpkiController<R>, command: JpkiCommands) -> anyhow::Result<()> {
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
        JpkiCommands::Sign { data, input, output, type_, pin } => {
            let prompt = if type_ == "sign" { "Sign Pass: " } else { "Auth PIN: " };
            let p = get_pin(pin, prompt)?;
            
            let data_bytes = if let Some(d) = data {
                d.as_bytes().to_vec()
            } else if let Some(path) = input {
                fs::read(path)?
            } else {
                return Err(anyhow::anyhow!("Either --data or --input context is required"));
            };

            let sig = if type_ == "sign" { 
                controller.compute_digital_signature(&p, &data_bytes).await? 
            } else { 
                controller.compute_auth_signature(&p, &data_bytes).await? 
            };
            
            if let Some(out_path) = output {
                fs::write(out_path, &sig)?;
            } else {
                println!("Signature: {}", hex::encode(sig));
            }
        }
        JpkiCommands::Mynumber { pin, json } => {
            let p = get_pin(pin, "PIN: ")?;
            let num = controller.read_mynumber(&p).await?;
            if json {
                println!("{}", serde_json::json!({ "mynumber": num }));
            } else {
                println!("MyNumber: {}", num);
            }
        }
        JpkiCommands::Card { pin, photo, json } => {
            let p = get_pin(pin, "Enter Input Support PIN (4 digits): ")?;
            let mut info = controller.read_attributes(&p).await?;
            
            // Try to get photo if requested or if json output (to serialize it)
            // Wait, getting photo requires My Number (Surface PIN).
            // BasicInfo has `face_photo` field.
            if photo.is_some() || json {
                // We need My Number to get photo
                 match controller.read_mynumber(&p).await {
                    Ok(num) => {
                         // Check retries first? JpkiController.read_face_photo checks PIN.
                         // But we should be careful about retries.
                         match controller.get_surface_pin_retries().await {
                             Ok(retries) => {
                                 if retries > 3 || retries == 255 {
                                     // println!("Retrieving photo..."); // Quiet for JSON?
                                     // For JSON we want to suppress logs?
                                     // But error logs are important.
                                     match controller.read_face_photo(&num).await {
                                         Ok(data) => {
                                             info.face_photo = Some(base64::engine::general_purpose::STANDARD.encode(data));
                                         }
                                         Err(e) => {
                                             if !json { eprintln!("Warning: Photo extraction failed: {}", e); }
                                         }
                                     }
                                 } else {
                                     if !json { eprintln!("Warning: Surface PIN constrained. Skipping photo."); }
                                 }
                             }
                             Err(_) => {}
                         }
                    }
                    Err(_) => {
                        // Ignore if we can't get my number
                    }
                 }
            }

            if json {
                println!("{}", serde_json::to_string_pretty(&info)?);
            } else {
                println!("\n{}", info);
            }

            if let (Some(path), Some(b64)) = (photo, info.face_photo) {
                fs::write(path, base64::engine::general_purpose::STANDARD.decode(b64)?)?;
            }
        }
    }
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Jpki { command } => {
            if cli.demo {
                let reader = DemoReader::new();
                let controller = JpkiController::new(reader);
                run_jpki(controller, command).await?;
            } else {
                let mut reader = PcscReader::new()?;
                let _ = reader.connect()?;
                let controller = JpkiController::new(reader);
                run_jpki(controller, command).await?;
            }
        }
    }
    Ok(())
}

#[cfg(target_arch = "wasm32")]
fn main() {}
