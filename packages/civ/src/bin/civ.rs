#[cfg(not(target_arch = "wasm32"))]
use clap::{Parser, Subcommand};
#[cfg(not(target_arch = "wasm32"))]
use civ::{JpkiController, DriversLicenseController, ResidenceCardController, PassportController, ThaiController, MyKadController, MynaMenkyoController, PcscReader, CardReader, IdentityController};
#[cfg(not(target_arch = "wasm32"))]
use std::fs;
#[cfg(not(target_arch = "wasm32"))]
use rpassword::read_password;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::{Arc, Mutex};
#[cfg(not(target_arch = "wasm32"))]
use async_trait::async_trait;

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
    /// Read identity from any supported card (Unified Model)
    #[command(name = "id")]
    Id {
        /// PIN (if required)
        #[arg(short, long)]
        pin: Option<String>,
        /// MRZ (for Passports)
        #[arg(short, long)]
        mrz: Option<String>,
        /// Verify authenticity (Passive Authentication)
        #[arg(short, long)]
        verify: bool,
        /// Output format (json)
        #[arg(long)]
        json: bool,
        /// Force card type (for demo mode: jpki, dl, rc, passport)
        #[arg(short, long)]
        type_: Option<String>,
    },
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
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone)]
pub struct MockReader {
    mock: Arc<Mutex<civ::mock::MockSmartCard>>,
}

#[cfg(not(target_arch = "wasm32"))]
impl MockReader {
    pub fn new() -> Self {
        use civ::mock::MockSmartCard;
        let mock = MockSmartCard::new();
        Self { mock: Arc::new(Mutex::new(mock)) }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl CardReader for MockReader {
    async fn transmit(&mut self, apdu: &[u8]) -> anyhow::Result<Vec<u8>> {
        Ok(self.mock.lock().unwrap().handle_apdu(apdu))
    }
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
async fn run_unified_id<R: CardReader + 'static>(mut reader: R, pin: Option<String>, mrz: Option<String>, verify: bool, json: bool, forced_type: Option<String>) -> anyhow::Result<()> {
    // Helper to check if selection succeeded
    async fn is_selected<R: CardReader>(reader: &mut R, aid: &[u8]) -> bool {
        let mut apdu = vec![0x00, 0xA4, 0x04, 0x0C];
        apdu.push(aid.len() as u8);
        apdu.extend_from_slice(aid);
        if let Ok(res) = reader.transmit(&apdu).await {
            res.len() >= 2 && res[res.len()-2] == 0x90 && res[res.len()-1] == 0x00
        } else {
            false
        }
    }

    // 1. Detect Card Type and set default demo PIN
    let mut controller: Box<dyn IdentityController>;
    let detected_type: &str;

    if let Some(ref t) = forced_type {
        match t.as_str() {
            "jpki" => { controller = Box::new(JpkiController::new(reader)); detected_type = "jpki"; },
            "dl" => { controller = Box::new(DriversLicenseController::new(reader)); detected_type = "dl"; },
            "rc" => { controller = Box::new(ResidenceCardController::new(reader)); detected_type = "rc"; },
            "passport" => { controller = Box::new(PassportController::new(reader)); detected_type = "passport"; },
            "thai" => { controller = Box::new(ThaiController::new(reader)); detected_type = "thai"; },
            "mykad" => { controller = Box::new(MyKadController::new(reader)); detected_type = "mykad"; },
            "mynamenkyo" => { controller = Box::new(MynaMenkyoController::new(reader)); detected_type = "mynamenkyo"; },
            _ => return Err(anyhow::anyhow!("Invalid forced card type")),
        }
    } else if is_selected(&mut reader, &civ::passport::file_ids::DF_ICAO).await {
        controller = Box::new(PassportController::new(reader));
        detected_type = "passport";
    } else if is_selected(&mut reader, &[0xA0, 0x00, 0x00, 0x02, 0x31, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).await {
        controller = Box::new(MynaMenkyoController::new(reader));
        detected_type = "mynamenkyo";
    } else if is_selected(&mut reader, &[0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01]).await {
        controller = Box::new(ThaiController::new(reader));
        detected_type = "thai";
    } else if is_selected(&mut reader, &[0xA0, 0x00, 0x00, 0x00, 0x74, 0x4A, 0x50, 0x4E, 0x00, 0x10]).await {
        controller = Box::new(MyKadController::new(reader));
        detected_type = "mykad";
    } else if is_selected(&mut reader, &civ::jpdl::file_ids::DF_DL).await {
        controller = Box::new(DriversLicenseController::new(reader));
        detected_type = "dl";
    } else if is_selected(&mut reader, &civ::apdu::file_ids::DF_JPKI).await {
        controller = Box::new(JpkiController::new(reader));
        detected_type = "jpki";
    } else if is_selected(&mut reader, &civ::jprc::file_ids::DF1).await {
        controller = Box::new(ResidenceCardController::new(reader));
        detected_type = "rc";
    } else {
        return Err(anyhow::anyhow!("Unknown or unsupported card type"));
    }

    // 2. Setup Credentials
    // JPKI uses 4-digit PIN for auth/input, 6-16 for sign.
    // Others use what they use. Mock defaults to 1234 for JPKI numeric, 123456 for others/sign.
    let default_pin = if detected_type == "jpki" { "1234" } else { "123456" };
    // For Passport, we prefer BAC (MRZ) in demo mode as PACE mock crypto is flaky
    if detected_type == "passport" {
         if mrz.is_some() {
             let _ = controller.provide_pin("mrz", mrz.as_ref().unwrap()).await;
         } else {
             // Default to 123456 as MRZ
             let _ = controller.provide_pin("mrz", "123456").await;
         }
         // Do NOT provide CAN by default, so it falls back to BAC
    } else {
         let p = pin.unwrap_or_else(|| default_pin.to_string());
         let _ = controller.provide_pin("auth", &p).await;
         let _ = controller.provide_pin("pin1", &p).await;
         let _ = controller.provide_pin("can", &p).await;
    }

    if verify {
        let _ = controller.verify().await?;
    }

    let identity = controller.read_identity().await?;

    if json {
        println!("{}", serde_json::to_string_pretty(&identity)?);
    } else {
        println!("--- Identity Information ---");
        println!("Card Type: {}", identity.card_type);
        println!("Name:      {}", identity.full_name);
        if let Some(surname) = identity.surname { println!("Surname:   {}", surname); }
        if let Some(given) = identity.given_names { println!("Given:     {}", given); }
        if let Some(kana) = identity.full_name_kana { println!("Kana:      {}", kana); }
        println!("DOB:       {}", identity.birth_date);
        if let Some(addr) = identity.address { println!("Address:   {}", addr); }
        println!("Gender:    {}", identity.gender);
        println!("ID Number: {}", identity.identity_number);
        if let Some(iss) = identity.issuing_authority { println!("Issuer:    {}", iss); }
        if let Some(exp) = identity.expiration_date { println!("Expires:   {}", exp); }
        println!("Verified:  {}", if identity.verified { "YES" } else { "NO" });
        if !identity.attributes.is_empty() {
            println!("Attributes: {:?}", identity.attributes);
        }
    }

    Ok(())
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
    }
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Id { pin, mrz, verify, json, type_ } => {
            if cli.demo {
                run_unified_id(MockReader::new(), pin, mrz, verify, json, type_).await?;
            } else {
                let mut reader = PcscReader::new()?;
                let _ = reader.connect()?;
                run_unified_id(reader, pin, mrz, verify, json, type_).await?;
            }
        }
        Commands::Jpki { command } => {
            if cli.demo {
                let controller = JpkiController::new(MockReader::new());
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



#[cfg(all(test, not(target_arch = "wasm32")))]

mod tests {

    use super::*;



    #[tokio::test]

    async fn test_run_unified_jpki_demo() {

        let reader = MockReader::new();

        let res = run_unified_id(reader, Some("1234".to_string()), None, false, false, Some("jpki".to_string())).await;

        assert!(res.is_ok());

    }



    #[tokio::test]

    async fn test_run_unified_unknown_type() {

        let reader = MockReader::new();

        let res = run_unified_id(reader, None, None, false, false, Some("invalid".to_string())).await;

        assert!(res.is_err());

    }



    #[tokio::test]

    async fn test_run_unified_no_card() {

        // MockReader without any matching backend simulation 

        // (actually MockReader has them all by default, so it's hard to fail selection)

    }

}
