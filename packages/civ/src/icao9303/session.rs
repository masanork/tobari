use crate::apdu::ApduCommand;
use crate::crypto::bac::BacSession;
use crate::crypto::sm::{AesSecureMessaging, SecureMessagingSession};
use crate::errors::{CivError, Result};

/// Secure Session Wrapper (BAC or PACE)
pub enum SecureSession {
    Bac(BacSession),
    Pace(AesSecureMessaging),
}

impl SecureSession {
    pub fn is_null_session(&self) -> bool {
        match self {
            SecureSession::Bac(s) => s.is_null_session(),
            SecureSession::Pace(s) => s.is_null_session(),
        }
    }

    pub fn wrap_command(&mut self, apdu: &ApduCommand) -> Result<Vec<u8>> {
        match self {
            SecureSession::Bac(s) => s
                .wrap_command(apdu)
                .map_err(|e| CivError::SecureMessagingError(e.to_string())),
            SecureSession::Pace(s) => s
                .wrap_command(apdu)
                .map_err(|e| CivError::SecureMessagingError(e.to_string())),
        }
    }

    pub fn unwrap_response(&mut self, data: &[u8]) -> Result<(Vec<u8>, u8, u8)> {
        match self {
            SecureSession::Bac(s) => s
                .unwrap_response(data)
                .map_err(|e| CivError::SecureMessagingError(e.to_string())),
            SecureSession::Pace(s) => s
                .unwrap_response(data)
                .map_err(|e| CivError::SecureMessagingError(e.to_string())),
        }
    }
}
