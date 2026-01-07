# CIV (Citizen Identity Verification) Roadmap

This document outlines the development path for the `civ` library and the required information for full implementation.

## 1. Current Capabilities (Phase 0: Foundation)
- **JPKI**: Read Basic 4 info, Auth/Sign Certs, and Compute Signature.
- **Driver's License (DL)**: PIN verification and reading common data (EF01).
- **ePassport / EuId**: AID selection, BAC key derivation, and reading DGs (DG1, DG2, DG11).
- **Residence Card (RC)**: Selection and basic info reading.
- **PIV**: CHUID, Certs, and General Authenticate (Sign).

## 2. Roadmap

### Phase 1: Communication Integrity & Stability (Short-term)
- **Secure Messaging (SM) Wrapper**: Implemented BAC 3DES ISO 7816-4 / ICAO
  9303 wrapper for encrypted APDUs. AES-based PACE SM remains pending.
- **PACE Support**: Implement Password Authenticated Connection Establishment for newer passports and EU IDs.
- **Extended Read Logic**: Support for large file reading across all controllers (Passport, Driver's License, and Residence Card implemented).

### Phase 2: Authenticity Verification (Medium-term)
- **Passive Authentication (PA)**: Verify Data Groups against the Security Object (SOD) using Document Signer certificates.
- **Active Authentication (AA)**: Challenge-response mechanism to prevent card cloning.
- **Trust Store Management**: A system to manage and update CSCA (Country Signing CA) and Document Signer (DS) certificates.

### Phase 3: Unified Identity API (Long-term)
- **Common Identity Model**: A high-level API that returns a standardized JSON structure regardless of the card type.
- **Wasm/Web Integration**: Optimize for browser environments via WebUSB/WebNFC.

## 3. Required Information & Resources

### Driver's License Specifics
- **NPA External Character Table (外字コード表)**: Mapping from NPA-specific codes to Unicode for correct name/address rendering.
- **Verification Keys**: Public keys or certificates used by Japanese Prefectural Police for signing DL data (needed for Passive Authentication).

### Authenticity & Cryptography
- **ASN.1 Definitions**: Detailed structures of SOD for JPKI, DL, and Residence Cards.
- **Trust Anchors**: Access to ICAO PKD (Public Key Directory) or equivalent for ePassport/EuId verification.

### Protocol Details
- **Japanese Specific PACE/EAC**: Verification of whether Japanese identity cards use standard ICAO PACE or specific extensions for EAC (Extended Access Control).
