use thiserror::Error;

#[derive(Error, Debug)]
pub enum CivError {
    #[error("Communication error: {0}")]
    Communication(String),

    #[error("APDU error: SW1={0:02X}, SW2={1:02X}")]
    ApduError(u8, u8),

    #[error("Invalid PIN. Retries remaining: {0}")]
    IncorrectPin(u8),

    #[error("PIN is locked")]
    PinLocked,

    #[error("Authentication failed: {0}")]
    AuthenticationFailed(String),

    #[error("Access denied: {0}")]
    AccessDenied(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid data: {0}")]
    InvalidData(String),

    #[error("Cryptographic error: {0}")]
    CryptoError(String),

    #[error("Secure Messaging error: {0}")]
    SecureMessagingError(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Unexpected error: {0}")]
    Unexpected(String),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type Result<T> = std::result::Result<T, CivError>;

impl CivError {
    pub fn from_sw(sw1: u8, sw2: u8) -> Self {
        match (sw1, sw2) {
            (0x63, 0xC0..=0xCF) => CivError::IncorrectPin(sw2 & 0x0F),
            (0x69, 0x82) => CivError::AccessDenied("Security status not satisfied".to_string()),
            (0x69, 0x83) => CivError::PinLocked,
            (0x6A, 0x82) => CivError::NotFound("File or application not found".to_string()),
            _ => CivError::ApduError(sw1, sw2),
        }
    }
}
