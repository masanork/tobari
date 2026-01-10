# Passport (ICAO 9303) Implementation Milestones

This document outlines the roadmap to achieve a "feature-complete" and robust implementation of the ICAO 9303 (ePassport/EU eID) controller in `civ`.

## Phase 1: Verification & Quality (Current Focus)
Goal: Complete Passive Authentication and Active Authentication verification logic.

- [ ] **Full SOD Signature Verification**
  - Implement actual cryptographic signature verification for EF.SOD.
  - Support RSA (PKCS#1 v1.5 / PSS) and ECDSA algorithms.
  - Verify Signer Certificate validity against CSCA (chain validation).
- [ ] **Certificate Handling Improvements**
  - Robust handling of Document Signer (DS) certificates extracted from SOD.
  - Better X.509 parsing and validation logic (validity dates, extensions).
- [ ] **Error Handling Refinement**
  - Map specific APDU Status Words (SW) to typed errors (e.g., "Security Status Not Satisfied", "Auth Failed").
  - Improve debug logging for APDU traces.

## Phase 2: Extended Access Control (EAC v1)
Goal: Support access to sensitive Data Groups (DG3 - Fingerprints, DG4 - Iris) used in EU eIDs and modern passports.

- [ ] **Chip Authentication (CA)**
  - Implement DH/ECDH key agreement to prove chip authenticity.
  - Replace current BAC/PACE session keys with stronger CA session keys.
  - Read `EF.DG14` (Security Infos) to determine CA algorithms.
- [ ] **Terminal Authentication (TA)**
  - Implement Terminal Authentication protocol (v1).
  - **CV Certificate Parser:** Implement parser for Card Verifiable Certificates (CVC/CV Certificates) - *Note: These are NOT X.509.*
  - Management of IS (Inspection System) private keys and certificate chains (CVCA -> DV -> IS).
- [ ] **MockPassport EAC Support**
  - Update `MockPassport` to simulate EAC behavior (CA/TA steps) for E2E testing.

## Phase 3: Advanced Features (LDS2 & Maintenance)
Goal: Support next-generation features and long-term maintenance.

- [ ] **LDS2 Support**
  - Support for reading/writing Travel Records (stamps) and Visa Records (if accessible).
- [ ] **PACE-CAM**
  - Support PACE with Chip Authentication Mapping (combining PACE and CA).
- [ ] **Performance Optimization**
  - Optimize AES/ECC operations for WASM targets.

## Current Status (as of 2026-01-08)
- ✅ **BAC:** Implemented & Tested.
- ✅ **PACE:** Implemented (Generic Mapping) & Tested.
- ✅ **Secure Messaging:** AES-128/256 & 3DES Implemented.
- ✅ **Passive Authentication:** Hash verification implemented. Signature verification partial (placeholder).
- ✅ **Active Authentication:** Implemented (Internal Authenticate).
