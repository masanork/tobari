use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CitizenIdentity {
    /// Full Name
    pub full_name: String,
    /// Name in Kana (Japanese specific)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_name_kana: Option<String>,
    /// Standardized Address
    pub address: String,
    /// Birth Date (ISO 8601: YYYY-MM-DD)
    pub birth_date: String,
    /// Gender (1: Male, 2: Female, 9: Not specified)
    pub gender: String,
    /// Identity Number (My Number, License No, Passport No, etc.)
    pub identity_number: String,
    /// Card Type (JPKI, DriverLicense, Passport, etc.)
    pub card_type: String,
    /// Expiration Date
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiration_date: Option<String>,
    /// Result of Passive Authentication (PA)
    pub verified: bool,
}

#[async_trait::async_trait]
pub trait IdentityController {
    /// Read basic identity information from the card.
    async fn read_identity(&mut self) -> crate::errors::Result<CitizenIdentity>;

    /// Provide a PIN for subsequent operations.
    /// Many operations require a PIN to be verified first.
    async fn provide_pin(&mut self, pin_type: &str, pin: &str) -> crate::errors::Result<()>;

    /// Verify the authenticity of the data read from the card (Passive Authentication).
    async fn verify(&mut self) -> crate::errors::Result<bool>;
}