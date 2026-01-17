pub mod controller;
pub mod files;
pub mod protocols;
pub mod session;
pub mod utils;
pub mod verify;

pub use controller::Icao9303Controller;
pub use files as file_ids;
pub use verify::{Icao9303Verifier, SecurityObjectDocument, LdsSecurityObject};

// Alias for backward compatibility if needed, but we should prefer Icao9303Controller
pub type PassportController<R> = Icao9303Controller<R>;