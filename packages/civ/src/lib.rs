pub mod apdu;
pub mod crypto;
pub mod jpki;
pub mod drivers_license;
pub mod passport;
pub mod passport_verify;
pub mod residence_card;
pub mod piv;
pub mod eu_eid;
pub mod reader;
#[cfg(not(target_arch = "wasm32"))]
pub mod native_reader;
#[cfg(target_arch = "wasm32")]
pub mod transport;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub mod utils;

#[cfg(test)]
pub mod test_utils;

pub use apdu::ApduCommand;
pub use reader::CardReader;
pub use jpki::JpkiController;
pub use drivers_license::DriversLicenseController;
pub use passport::PassportController;
pub use passport_verify::PassportVerifier;
pub use residence_card::ResidenceCardController;
pub use piv::PivController;
pub use eu_eid::EuIdController;

#[cfg(target_arch = "wasm32")]
pub use transport::WebUsbReader;

#[cfg(not(target_arch = "wasm32"))]
pub use native_reader::PcscReader;
