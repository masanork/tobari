use clap::{Parser, Subcommand};
use std::fs;
use std::path::PathBuf;
use serde_json::json;

#[derive(Parser)]
#[command(name = "myna")]
#[command(about = "Dummy myna command for testing")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Text command
    Text {
        /// Type of text data to read
        #[arg(value_enum)]
        data_type: DataType,

        /// PIN
        #[arg(short, long)]
        pin: Option<String>,

        /// Output format
        #[arg(short, long, default_value = "text")]
        format: String,
    },
    /// Visual command
    Visual {
        /// Type of visual data
        #[arg(value_enum)]
        data_type: VisualType,

        /// PIN
        #[arg(short, long)]
        pin: Option<String>,

        /// Output file
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// JPKI command
    Jpki {
        #[command(subcommand)]
        command: JpkiCommands,
    },
}

#[derive(clap::ValueEnum, Clone)]
enum DataType {
    Mynumber,
    Attr,
}

#[derive(clap::ValueEnum, Clone)]
enum VisualType {
    Photo,
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Text { data_type, format, .. } => {
            match data_type {
                DataType::Mynumber => {
                    // Dummy My Number
                    println!("123456789012");
                }
                DataType::Attr => {
                    // Dummy Basic 4 Info
                    if format == "json" {
                        let info = json!({
                            "header": {
                                "date": "20260115",
                                "expires": "20310115"
                            },
                            "name": "斎藤 太朗", // Simplifed from 䶒藤󠄃 太朗󠄅 (IVS/Surrogate pairs removed for MyNA compat)
                            "address": "東京都港区虎ノ門2-2-1", // Similar to Juminhyo demo
                            "birth": "19890101",
                            "sex": "男",
                            "name_image": "", // Base64 encoded image if needed
                            "address_image": ""
                        });
                        println!("{}", info.to_string());
                    } else {
                        // Text format fallback
                        println!("氏名: 斎藤 太朗");
                        println!("住所: 東京都港区虎ノ門2-2-1");
                        println!("生年月日: 19890101");
                        println!("性別: 男");
                    }
                }
            }
        }
        Commands::Visual { data_type, output, .. } => {
            match data_type {
                VisualType::Photo => {
                    // Dummy Photo (create an empty file or copy a dummy asset)
                    if let Some(path) = output {
                        // Write a minimal valid JP2 (JPEG 2000) header or just some bytes
                        // For now, just dummy text bytes, pretending to be an image
                        // In reality, this should be a valid JP2 header for browsers/viewers that parse it strictly
                        let dummy_data = b"DUMMY_JP2_DATA"; 
                        if let Err(e) = fs::write(path, dummy_data) {
                            eprintln!("Error writing photo: {}", e);
                            std::process::exit(1);
                        }
                    }
                }
            }
        }
        Commands::Jpki { command: JpkiCommands::Cms { command: CmsCommands::Sign { input, output, pin, .. } } } => {
             // Handle PIN check if needed (dummy allows 1234)
             if let Some(p) = pin {
                 if p != "1234" && p.len() < 4 {
                     eprintln!("Warning: Using simple PIN for dummy sign");
                 }
             }
             
             // RSA-SHA256 Signing
             use rsa::RsaPrivateKey;
             use rsa::pkcs1v15::SigningKey;
             use rsa::sha2::Sha256;
             use rsa::signature::{Signer, SignatureEncoding};
             
             // 1. Read input data (omitted error handling for brevity in diff, but kept in applied)
             let data = match fs::read(input) {
                 Ok(d) => d,
                 Err(e) => {
                     eprintln!("Error reading input file: {}", e);
                     std::process::exit(1);
                 }
             };

             // 2. Hash is handled by SigningKey automatically

             // 3. Generate key (2048 bit for JPKI spec compliance)
             let mut rng = rand::thread_rng();
             let bit_size = 2048;
             
             let priv_key = RsaPrivateKey::new(&mut rng, bit_size).expect("failed to generate a key");
             
             // 4. Sign
             // Use SigningKey which encapsulates the private key and handles everything
             let signing_key = SigningKey::<Sha256>::new(priv_key);
             let signature = signing_key.sign(&data);

             // 5. Write signature
             if let Err(e) = fs::write(output, signature.to_bytes()) {
                 eprintln!("Error writing signature: {}", e);
                 std::process::exit(1);
             }
        }
    }
}

#[derive(Subcommand)]
enum JpkiCommands {
    /// CMS commands
    Cms {
        #[command(subcommand)]
        command: CmsCommands,
    }
}

#[derive(Subcommand)]
enum CmsCommands {
    /// Sign data
    Sign {
        /// Input file
        #[arg(short, long)]
        input: PathBuf,

        /// Output file
        #[arg(short, long)]
        output: PathBuf,

        /// PIN
        #[arg(short, long)]
        pin: Option<String>,

        /// Message digest algorithm
        #[arg(short, long)]
        message_digest: Option<String>,

        /// Output format
        #[arg(short, long)]
        format: Option<String>,

        /// Detached signature
        #[arg(long)]
        detached: bool,
    }
}
