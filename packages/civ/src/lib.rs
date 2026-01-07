pub mod apdu;
pub mod crypto;
pub mod jpki;
pub mod jpdl;
pub mod passport;
pub mod passport_verify;
pub mod jprc;
pub mod piv;
pub mod eu_eid;
pub mod demo_reader;
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
pub use jpdl::DriversLicenseController;
pub use passport::PassportController;
pub use passport_verify::PassportVerifier;
pub use jprc::ResidenceCardController;
pub use piv::PivController;
pub use eu_eid::EuIdController;

#[cfg(target_arch = "wasm32")]
pub use transport::WebUsbReader;

#[cfg(not(target_arch = "wasm32"))]
pub use native_reader::PcscReader;
