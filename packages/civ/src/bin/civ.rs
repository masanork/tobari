use civ::reader::CardReader;
use civ::jpki::JpkiController;
use civ::passport::PassportController;
use civ::jpdl::DriversLicenseController;
use civ::jprc::ResidenceCardController;
use civ::jpdlmnc::MynaMenkyoController;
use civ::thai::ThaiController;
use civ::mykad::MyKadController;
use civ::native_reader::PcscReader;
use civ::models::IdentityController;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Read { card_type: String, pin: Option<String> },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _cli = Cli::parse();
    Ok(())
}