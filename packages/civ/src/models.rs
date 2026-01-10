use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CitizenIdentity {
    /// Full Name (Display Name)
    pub full_name: String,
    /// Surname / Family Name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surname: Option<String>,
    /// Given Names
    #[serde(skip_serializing_if = "Option::is_none")]
    pub given_names: Option<String>,
    /// Name in Kana (Japanese specific)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_name_kana: Option<String>,
    
    /// Standardized Address
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    /// Birth Date (ISO 8601: YYYY-MM-DD)
    pub birth_date: String,
    /// Gender (1: Male, 2: Female, 9: Not specified, or ICAO "M"/"F"/"<")
    pub gender: String,
    
    /// Identity Number (My Number, License No, Passport No, etc.)
    pub identity_number: String,
    /// Card Type (JPKI, DriverLicense, Passport, etc.)
    pub card_type: String,
    /// Issuing Authority (Country Code or Agency)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issuing_authority: Option<String>,
    /// Expiration Date
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiration_date: Option<String>,
    
    /// Face Photo Data (JPEG/JP2/PNG)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photo_data: Option<Vec<u8>>,

    /// Result of Passive Authentication (PA)
    pub verified: bool,

    /// Extended Attributes (Country/Card specific)
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub attributes: HashMap<String, String>,
}

#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
pub trait IdentityController {
    /// Read basic identity information from the card.
    async fn read_identity(&mut self) -> crate::errors::Result<CitizenIdentity>;

    /// Provide a PIN for subsequent operations.
    /// Many operations require a PIN to be verified first.
    async fn provide_pin(&mut self, pin_type: &str, pin: &str) -> crate::errors::Result<()>;

    /// Verify the authenticity of the data read from the card (Passive Authentication).
    async fn verify(&mut self) -> crate::errors::Result<bool>;
}