#[cfg(not(target_arch = "wasm32"))]
use clap::{Parser, Subcommand};
#[cfg(not(target_arch = "wasm32"))]
use civ::{JpkiController, DriversLicenseController, PassportController, ResidenceCardController, PivController, PcscReader};
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
    /// Driver's License Operations
    #[command(name = "dl")]
    DriverLicense {
        /// Type: info, common
        #[arg(short, long, default_value = "info")]
        command: String,
        /// PIN1 (4 digits)
        #[arg(short, long, env = "DL_PIN1")]
        pin1: Option<String>,
    },
    /// Passport Operations
    #[command(name = "ep")]
    Passport {
        /// MRZ String (OCR result)
        #[arg(short, long, env = "EP_MRZ")]
        mrz: String,
    },
    /// Residence Card Operations
    #[command(name = "rc")]
    ResidenceCard {
        /// Card Number or MRZ (OCR result)
        #[arg(short, long, env = "RC_NUMBER")]
        number: String,
        /// Optional PIN (if not using Number-based access)
        #[arg(short, long)]
        pin: Option<String>,
    },
    /// US PIV (Personal Identity Verification)
    #[command(name = "piv")]
    Piv,
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
    /// Sign data (using Auth or Sign key)
    #[command(name = "sign")]
    Sign {
        /// Data to sign (string)
        #[arg(short, long)]
        data: String,
        /// Type: auth (4 digits) or sign (6-16 alphanum)
        #[arg(short, long, default_value = "auth")]
        type_: String,
        /// PIN (Optional, will prompt if missing)
        #[arg(short, long, env = "JPKI_PIN")]
        pin: Option<String>,
    },
    /// Read My Number (Individual Number)
    #[command(name = "num")]
    Mynumber {
        /// PIN (4 digits for Card Surface Input Support)
        #[arg(short, long, env = "JPKI_PIN")]
        pin: Option<String>,
    },
    /// Read Card Attributes (Basic 4 Info + Photo)
    #[command(name = "attr")]
    Card {
        /// PIN (4 digits for Card Surface Input Support)
        #[arg(short, long, env = "JPKI_PIN")]
        pin: Option<String>,
        /// Save photo to this file (if available)
        #[arg(short, long)]
        photo: Option<String>,
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
    let reader_name = reader.connect()?;
    println!("Connected to reader: {}", reader_name);

    match cli.command {
        Commands::Jpki { command } => {
            let mut controller = JpkiController::new(reader);
            match command {
                JpkiCommands::Retries => {
                    println!("--- JPKI PIN Retry Counts ---");
                    match controller.get_auth_pin_retries().await {
                        Ok(c) => println!("Auth PIN (4-digit): {}", if c == 255 { "Verified/Unlimited".into() } else { format!("{}", c) }),
                        Err(e) => println!("Auth PIN: Error ({})", e),
                    }
                    match controller.get_sign_pin_retries().await {
                        Ok(c) => println!("Sign PIN (6-16 alphanum): {}", if c == 255 { "Verified/Unlimited".into() } else { format!("{}", c) }),
                        Err(e) => println!("Sign PIN: Error ({})", e),
                    }
                    match controller.get_input_support_pin_retries().await {
                        Ok(c) => println!("Input Support PIN (4-digit): {}", if c == 255 { "Verified/Unlimited".into() } else { format!("{}", c) }),
                        Err(e) => println!("Input Support PIN: Error ({})", e),
                    }
                }
                JpkiCommands::Cert { type_, output } => {
                    let cert_data = if type_ == "sign" {
                        println!("Reading Signature certificate...");
                        controller.read_sign_cert().await?
                    } else {
                        println!("Reading Auth certificate...");
                        controller.read_auth_cert().await?
                    };
                    
                    if let Some(path) = output {
                        fs::write(&path, &cert_data)?;
                        println!("Certificate saved to {}", path);
                    } else {
                        println!("Certificate (Hex): {}", hex::encode(&cert_data));
                    }
                }
                JpkiCommands::Sign { data, type_, pin } => {
                    let prompt = if type_ == "sign" { "Enter Sign Password (6-16 chars): " } else { "Enter Auth PIN (4 digits): " };
                    let pin = get_pin(pin, prompt)?;
                    
                    let sig = if type_ == "sign" {
                        println!("Computing Digital Signature...");
                        controller.compute_digital_signature(&pin, data.as_bytes()).await?
                    } else {
                        println!("Computing Auth Signature...");
                        controller.compute_auth_signature(&pin, data.as_bytes()).await?
                    };
                    println!("Signature (Hex): {}", hex::encode(sig));
                }
                JpkiCommands::Mynumber { pin } => {
                    let pin = get_pin(pin, "Enter Input Support PIN (4 digits): ")?;
                    let my_number = controller.read_mynumber(&pin).await?;
                    println!("Individual Number (My Number): {}", my_number);
                }
                JpkiCommands::Card { pin, photo } => {
                    let pin = get_pin(pin, "Enter Input Support PIN (4 digits): ")?;
                    println!("Reading attributes...");
                    let info = controller.read_attributes(&pin, None, None).await?;
                    println!("{}", info);
                    
                    if let Some(photo_path) = photo {
                        if let Some(b64) = info.face_photo {
                            let bytes = base64::engine::general_purpose::STANDARD.decode(b64)?;
                            fs::write(&photo_path, bytes)?;
                            println!("Photo saved to {}", photo_path);
                        } else {
                            println!("Photo data not found or access denied.");
                        }
                    }
                }
            }
        }
        Commands::DriverLicense { command, pin1 } => {
            let mut controller = DriversLicenseController::new(reader);
            controller.select_dl_ap().await?;
            if command == "common" {
                let p = get_pin(pin1, "Enter DL PIN1 (4 digits): ")?;
                controller.verify_pin1(&p).await?;
                let info = controller.read_common_data().await?;
                println!("{}", info);
            } 
        }
        Commands::Passport { mrz } => {
            let mut controller = PassportController::new(reader);
            controller.select_ep_ap().await?;
            controller.perform_bac(&mrz).await?;
            println!("DG1 (MRZ): {}", hex::encode(controller.read_dg1().await?));
        }
        Commands::ResidenceCard { number, pin } => {
            let mut controller = ResidenceCardController::new(reader);
            controller.select_rc_ap().await?;
            if let Some(p) = pin {
                 println!("PIN verification not implemented for RC in this CLI yet.");
            } else {
                 controller.verify_card_number(&number).await?;
                 println!("{}", controller.read_info().await?);
            }
        }
        Commands::Piv => {
            let mut controller = PivController::new(reader);
            controller.select_piv_ap().await?;
            println!("CHUID: {}", hex::encode(controller.read_chuid().await?));
        }
    }

    Ok(())
}

#[cfg(target_arch = "wasm32")]
fn main() {
    panic!("This CLI is not supported on WASM targets");
}