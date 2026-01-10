use anyhow::{Result, anyhow};
use x509_parser::prelude::*;

/// Trusted Anchor types
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum TrustAnchorType {
    CSCA, // Country Signing CA (Passport/eID)
    JpkiRoot, // JPKI Root CA
    JpdlRoot, // Police Agency Root (Hypothetical)
}

/// A stored trusted certificate
#[derive(Debug, Clone)]
pub struct TrustedCertificate {
    pub subject: String,
    pub issuer: String,
    pub serial: String,
    pub raw_der: Vec<u8>,
    pub anchor_type: TrustAnchorType,
}

/// Interface for Trust Store
pub trait TrustStore: Send + Sync {
    /// Add a certificate to the store
    fn add_certificate(&mut self, cert_der: &[u8], anchor_type: TrustAnchorType) -> Result<()>;
    
    /// Find a certificate by Subject Key Identifier (SKI) or similar ID
    /// For now, simpler lookup by Subject Name or just returning all matching type.
    fn find_by_subject(&self, subject: &str) -> Option<&TrustedCertificate>;
    
    /// Get all certificates of a specific type
    fn get_by_type(&self, anchor_type: TrustAnchorType) -> Vec<&TrustedCertificate>;
}

/// In-Memory Trust Store Implementation
#[derive(Default)]
pub struct InMemoryTrustStore {
    certs: Vec<TrustedCertificate>,
}

impl InMemoryTrustStore {
    pub fn new() -> Self {
        Self { certs: Vec::new() }
    }
}

impl TrustStore for InMemoryTrustStore {
    fn add_certificate(&mut self, cert_der: &[u8], anchor_type: TrustAnchorType) -> Result<()> {
        let (_, cert) = X509Certificate::from_der(cert_der)
            .map_err(|e| anyhow!("Failed to parse certificate: {}", e))?;
        
        let t_cert = TrustedCertificate {
            subject: cert.subject().to_string(),
            issuer: cert.issuer().to_string(),
            serial: cert.tbs_certificate.serial.to_string(),
            raw_der: cert_der.to_vec(),
            anchor_type,
        };
        
        self.certs.push(t_cert);
        Ok(())
    }

    fn find_by_subject(&self, subject: &str) -> Option<&TrustedCertificate> {
        self.certs.iter().find(|c| c.subject == subject)
    }

    fn get_by_type(&self, anchor_type: TrustAnchorType) -> Vec<&TrustedCertificate> {
        self.certs.iter().filter(|c| c.anchor_type == anchor_type).collect()
    }
}
