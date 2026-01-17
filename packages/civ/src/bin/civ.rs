use civ::jpdl::DriversLicenseController;
use civ::jpdlmnc::MynaMenkyoController;
use civ::jpki::JpkiController;
use civ::models::{CitizenIdentity, IdentityController};
use civ::native_reader::PcscReader;
use civ::passport::PassportController;
use civ::reader::CardReader;
use clap::{Parser, Subcommand};
use std::sync::{Arc, Mutex};
use async_trait::async_trait;

#[cfg(feature = "mock")]
use civ::mock::MockSmartCard;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[arg(long)]
    demo: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Id {
        #[arg(long, rename_all = "lower")]
        #[arg(value_name = "TYPE")]
        r#type: String,

        #[arg(long)]
        pin: Option<String>,

        #[arg(long)]
        mrz: Option<String>,

        #[arg(long)]
        verify: bool,
    },
}

#[cfg(feature = "mock")]
struct MockReaderAdapter {
    mock: Arc<Mutex<MockSmartCard>>,
}

#[cfg(feature = "mock")]
#[async_trait]
impl CardReader for MockReaderAdapter {
    async fn transmit(&mut self, apdu: &[u8]) -> civ::errors::Result<Vec<u8>> {
        let mut mock = self.mock.lock().unwrap();
        Ok(mock.handle_apdu(apdu))
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Id {
            r#type,
            pin,
            mrz,
            verify,
        } => {
            #[cfg(feature = "mock")]
            if cli.demo {
                let mock = Arc::new(Mutex::new(MockSmartCard::new()));
                let reader = MockReaderAdapter { mock };
                process_command(reader, &r#type, pin, mrz, verify).await?;
                return Ok(());
            }

            #[cfg(not(feature = "mock"))]
            if cli.demo {
                eprintln!("Error: --demo flag requires the 'mock' feature to be enabled during compilation.");
                std::process::exit(1);
            }

            let reader = PcscReader::new()?;
            process_command(reader, &r#type, pin, mrz, verify).await?;
        }
    }
    Ok(())
}

async fn process_command<R: CardReader + Send + 'static>(
    reader: R,
    card_type: &str,
    pin: Option<String>,
    mrz: Option<String>,
    verify: bool,
) -> anyhow::Result<()> {
    let mut identity: CitizenIdentity;

    match card_type {
        "jpki" => {
            let mut controller = JpkiController::new(reader);
            if let Some(p) = pin {
                controller.provide_pin("auth", &p).await?;
            }
            if verify {
                controller.verify().await?;
            }
            identity = controller.read_identity().await?;
            identity.card_type = "MyNumberCard".to_string(); // Normalized name for output
        }
        "passport" => {
            let mut controller = PassportController::new(reader);
            if let Some(m) = mrz {
                controller.provide_pin("mrz", &m).await?;
            }
            if verify {
                controller.verify().await?;
            }
            identity = controller.read_identity().await?;
            identity.card_type = "Passport".to_string();
        }
        "mynamenkyo" => {
            let mut controller = MynaMenkyoController::new(reader);
            if let Some(p) = pin {
                controller.provide_pin("pin1", &p).await?;
            }
            if verify {
                controller.verify().await?;
            }
            identity = controller.read_identity().await?;
            identity.card_type = "MyNaMenkyo".to_string();
        }
        "license" => {
            let mut controller = DriversLicenseController::new(reader);
            if let Some(p) = pin {
                controller.provide_pin("pin1", &p).await?;
            }
            identity = controller.read_identity().await?;
            identity.card_type = "DriversLicense".to_string();
        }
        _ => {
            eprintln!("Unknown card type: {}", card_type);
            std::process::exit(1);
        }
    }

    // Output formatted for E2E tests
    println!("Card Type: {}", identity.card_type);
    println!("Name:      {}", identity.full_name);
    if !identity.birth_date.is_empty() {
        println!("DOB:       {}", identity.birth_date);
    }
    if !identity.identity_number.is_empty() {
        println!("ID Number: {}", identity.identity_number);
    }
    println!(
        "Verified:  {}",
        if identity.verified { "YES" } else { "NO" }
    );

    Ok(())
}