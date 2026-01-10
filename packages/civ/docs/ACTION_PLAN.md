# Action Plan: Enhancing Civ Quality

This document outlines the roadmap for elevating `civ` from an experimental component to a production-grade, universal identity library.

## Phase 1: Robustness & Test Coverage (Priority: High)
Establish a reliable testing baseline independent of physical hardware.

- [x] **Comprehensive Mock Card Reader**:
    - [x] Initial `MockSmartCard` capable of simulating stateful APDU sessions for JPKI, JPDL, and JPRC.
    - [ ] Refactor into a unified `MockCard` trait and separate backend implementations for cleaner maintenance.
    - [x] Implement full **Passport** mock scenarios (BAC/PACE handshake, DG reading, Active Authentication).
    - [x] Implement full **PIV** mock scenarios (Authentication, Signing).
    - [ ] Add specific error simulation (SW 63C0 for PIN retries, 6982 for Auth Required).
- [ ] **Integration Testing**:
    - [ ] Ensure `cargo test` runs all mock scenarios in GitHub Actions.
    - [ ] Achieve >80% code coverage for core controller logic.
    - [ ] Add `cargo-tarpaulin` for code coverage visualization.

## Phase 2: Internal Quality & API Stability (Priority: High)
Refine the internal architecture for better maintainability and error reporting.

- [x] **Typed Error Handling**:
    - [x] Replace `anyhow` usage with a dedicated `CivError` enum using `thiserror`.
        - [x] `jpki.rs`
        - [x] `piv.rs`
        - [x] `jpdl.rs`
        - [x] `jprc.rs`
        - [x] `passport.rs`
        - [x] `eu_eid.rs`
        - [x] `crypto/sm.rs` (Secure Messaging)
    - [ ] Explicitly handle card-specific errors (e.g., `IncorrectPin { remaining: u8 }`, `CardLocked`, `NotAuthenticated`).
    - [x] Standardize error mapping from APDU Status Words (SW1/SW2).
- [x] **Passive Authentication (PA)**:
    - [x] Implement SOD (Security Object) verification for ICAO 9303.
    - [x] Implement data integrity checks for JPKI and JPDL (verifying digital signatures on EF files).
    - [x] Add a `verify()` method to each controller to validate the authenticity of the read data.

## Phase 3: Usability & Developer Experience (Priority: Medium)
Make the library intuitive and easy to integrate for external developers.

- [ ] **Documentation & Examples**:
    - [ ] Standardize Rustdoc comments for all public APIs.
    - [ ] Create a `examples/` directory with runnable code snippets for each card type (e.g., `read_jpki.rs`, `read_passport.rs`).
- [x] **Unified Identity Model**:
    - [x] Design a common trait/struct that maps disparate card data to a standardized JSON schema (e.g., "Full Name", "Birth Date", "Address").

## Phase 4: Distribution & Portability (Priority: Medium)
Expand the reach of `civ` beyond the Rust ecosystem.

- [ ] **FFI & Cross-Language Support**:
    - [ ] Investigate `uniffi-rs` for generating Kotlin (Android) and Swift (iOS) bindings.
    - [ ] Ensure the WASM interface is robust and well-documented for web developers.
- [ ] **Secure Messaging Consolidation**:
    - [ ] Unify SM (Secure Messaging) logic for AES (PACE) and 3DES (BAC) into a common crypto module.

## Phase 5: Future-Proofing (Priority: Low)
- [ ] **PQC Readiness**: Prototype ML-DSA (Dilithium) signature verification.
- [ ] **Extended Length APDU**: Broaden support for large data transfers.
