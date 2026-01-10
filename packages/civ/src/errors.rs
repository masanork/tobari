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
            (0x63, 0x00) => CivError::AuthenticationFailed("Verification failed".to_string()),
            (0x63, 0xC0..=0xCF) => CivError::IncorrectPin(sw2 & 0x0F),
            
            (0x67, 0x00) => CivError::InvalidData("Wrong length".to_string()),
            
            (0x69, 0x82) => CivError::AccessDenied("Security status not satisfied".to_string()),
            (0x69, 0x83) => CivError::PinLocked,
            (0x69, 0x85) => CivError::AccessDenied("Condition of use not satisfied".to_string()),
            (0x69, 0x88) => CivError::SecureMessagingError("SM data object incorrect".to_string()),
            
            (0x6A, 0x80) => CivError::InvalidData("Incorrect parameters in data field".to_string()),
            (0x6A, 0x82) => CivError::NotFound("File or application not found".to_string()),
            (0x6A, 0x86) => CivError::InvalidData("Incorrect parameters P1-P2".to_string()),
            (0x6A, 0x88) => CivError::NotFound("Referenced data not found".to_string()),
            
            (0x6B, 0x00) => CivError::InvalidData("Wrong parameter P1-P2".to_string()),
            _ => CivError::Communication(format!("APDU Error: {:02X}{:02X}", sw1, sw2)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

        #[test]

        fn test_error_display() {

            assert!(format!("{}", CivError::Communication("err".to_string())).contains("Communication"));

            assert!(format!("{}", CivError::ApduError(0x6A, 0x82)).contains("6A"));

            assert!(format!("{}", CivError::IncorrectPin(3)).contains("3"));

            assert!(format!("{}", CivError::PinLocked).contains("locked"));

            assert!(format!("{}", CivError::AuthenticationFailed("err".to_string())).contains("failed"));

            assert!(format!("{}", CivError::AccessDenied("err".to_string())).contains("denied"));

            assert!(format!("{}", CivError::NotFound("err".to_string())).contains("Not found"));

            assert!(format!("{}", CivError::InvalidData("err".to_string())).contains("Invalid"));

            assert!(format!("{}", CivError::CryptoError("err".to_string())).contains("Cryptographic"));

            assert!(format!("{}", CivError::SecureMessagingError("err".to_string())).contains("Secure Messaging"));

            assert!(format!("{}", CivError::Unexpected("err".to_string())).contains("Unexpected"));

            

            let sw_err = CivError::from_sw(0x6A, 0x82);

            assert!(format!("{}", sw_err).contains("File or application not found"));

        }

    

        #[test]

        fn test_from_sw_extra() {

            assert!(matches!(CivError::from_sw(0x63, 0x00), CivError::AuthenticationFailed(_)));

            assert!(matches!(CivError::from_sw(0x67, 0x00), CivError::InvalidData(_)));

            assert!(matches!(CivError::from_sw(0x69, 0x83), CivError::PinLocked));

            assert!(matches!(CivError::from_sw(0x69, 0x85), CivError::AccessDenied(_)));

            assert!(matches!(CivError::from_sw(0x69, 0x88), CivError::SecureMessagingError(_)));

            assert!(matches!(CivError::from_sw(0x6A, 0x80), CivError::InvalidData(_)));

            assert!(matches!(CivError::from_sw(0x6A, 0x86), CivError::InvalidData(_)));

            assert!(matches!(CivError::from_sw(0x6A, 0x88), CivError::NotFound(_)));

            assert!(matches!(CivError::from_sw(0x6B, 0x00), CivError::InvalidData(_)));

            assert!(matches!(CivError::from_sw(0xFF, 0xFF), CivError::Communication(_)));

        }

    

        

            #[test]

            fn test_error_conversion() {

                let io_err = std::io::Error::new(std::io::ErrorKind::Other, "io error");

                let civ_err: CivError = io_err.into();

                assert!(format!("{}", civ_err).contains("io error"));

        

                let any_err = anyhow::anyhow!("anyhow error");

                let civ_err2: CivError = any_err.into();

                assert!(format!("{}", civ_err2).contains("anyhow error"));

            }

        }

        

    