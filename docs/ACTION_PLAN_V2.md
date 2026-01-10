# Tobari Project: Action Plan v2.0

**Last Updated:** 2026-01-10
**Status:** Active Development / Global Scale-out

## Phase 1: Core Foundation & Trust Anchors (Completed)

*   **Unified Identity Interface**: Unified JPKI, JPDL, and Passport reading under a single `IdentityController` interface.
*   **Secure Messaging**: Implemented encrypted communication for BAC (Passport), JPKI, and JPDL.
*   **Passive Authentication**: Implemented signature and hash verification for Japanese Drivers Licenses (JPDL).
*   **Multi-Chain Support**: Established a data model for verifying ownership of Ethereum, Solana, and other blockchain accounts.
*   **Privacy-First Design**: Shifted to designs favoring ZKP (Zero-Knowledge Proofs) to avoid exposing sensitive data like passport numbers.
*   **mDoc Generation**: Created a prototype for ISO 18013-5 compliant mobile credentials using CBOR/COSE.
*   **Passport Circuit**: Designed an MRZ hash verification circuit using Circom.
*   **BBS+ Signatures**: Integrated basic signature generation and verification via `crypto-wasm`.

## Phase 2: Performance & Scalability (Current Focus)

### Performance Optimization
*   **Issue**: RSA signature verification (Passport/JPKI) and ZKP generation are computationally expensive.
*   **Action**: Optimize WebAssembly (WASM) builds, implement multi-threading, and leverage hardware acceleration where available.

### Unlinkable Credentials
*   **Goal**: Fully functional unlinkable credentials using BBS+ signatures.
*   **Action**: Resolve WASM interface issues and implement a seamless proof generation pipeline.

### Snark-based Verification
*   **Goal**: Establish a production-ready pipeline for `snarkjs`.
*   **Action**: Incorporate RSA/ECDSA signature verification circuits into `passport.circom` and verify credentials against real passport data.

## Phase 3: Production Grade Infrastructure (Q1-Q2 2026)

### Key Management & Trust Services
*   **KMS Integration**: Design a key management system that interfaces with cloud KMS (AWS/GCP) or on-premise HSMs instead of using local demo keys.
*   **Revocation Registry**: Implement a status management server for mDoc revocation (Status List 2021).

### Mobile Integration
*   **Mobile SDK**: Create SDK prototypes for Flutter/Kotlin to handle everything from NFC reading to SCAC reception.
*   **Wallet Integration**: Partner with existing crypto wallets to integrate the signing process.

## Phase 4: Standardization & Compliance

*   **OpenID4VC Support**: Implement OID4VCI (Issuance) and OID4VP (Presentation) protocols for maximum interoperability.
*   **Regulatory Compliance**: Verify API compliance for commercial use of JPKI (Public Knowledge Service) and align with FATF/travel rule requirements globally.