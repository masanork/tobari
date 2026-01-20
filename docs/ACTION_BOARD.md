# Tobari Action Board

**Last Updated:** 2026-01-18
**Scope:** Tobari Project (MCP/Signer/SCAC/Compliance/civ)

## 🚀 Now (Current Sprint)

### macOS & Signer Integration
- [x] **macOS Native Integration**: `mcp-server` automatically detects macOS and invokes `signer-macos` (CTK/Secure Enclave) for JPKI and Device Auth.
- [x] **JPKI Full Support (macOS)**: Implemented signing, reading attributes, My Number, and face photo in `signer-macos` with comprehensive unit tests.
- [x] **Device-bound Decryption (ECIES)**: Implemented full-stack decryption flow using Secure Enclave Key Agreement via `mcp-server` and `signer-macos`.
- [x] **Hardware-backed Registration**: Added `register_device` tool to export Secure Enclave public keys for issuance.
- [x] **Hardware Reader Optimization**: Identified Sony RC-S380 driver issues with Rust/PCSC on macOS; established `signer-macos` (Swift/CryptoTokenKit) as the primary stable path for macOS users.
- [x] **VP Signing (macOS)**: Implemented native Verifiable Presentation (VP) signing using Secure Enclave and ISO 18013-5 Device Authentication.

### 🔄 Cross-Platform Signer Alignment (Tauri/Rust)
- [x] **Unified Interface Porting**: Ported full `UnifiedRequest`/`UnifiedResponse` protocol to Tauri signer CLI, achieving parity with Swift implementation.
- [x] **Recursive Document Inspector**: Implemented advanced `inspect_document` logic in both Rust and Swift with support for nested structures and binary inspection.
- [x] **File-based I/O Support**: Integrated `outputPath` across all native tools to handle large transfers (face photos, mdocs) efficiently.
- [ ] **Windows TPM Integration**: Research and implement hardware-bound key support for Windows (NCrypt/TPM) to match Secure Enclave functionality.

### Performance & PQC
- [x] **PQC Countersign Verification**: Implemented and verified full PQC flow (Generation -> Verification) in `verify-cli` and `mcp-server`.
- [x] **PQC Benchmark Refinement**: Updated whitepaper with exact WASM size breakdowns for ML-DSA and ML-KEM.
- [x] **AI-Ready Identity**: Implemented mdoc-to-JSON translation to enable LLM agents to process complex identity documents.
// ... (omitted) ...
### Compliance & SCAC
- [x] **FATF/SCAC Operations Mapping**: Created correspondence table for VASP risk assessment vs VP elements in `docs/FATF_OPERATIONS_MAP.md`.
- [x] **Travel Rule Interface Draft**: Defined minimal OID4VP-based interface in `docs/TRAVEL_RULE_INTERFACE.md`.
- [x] **SCAC mDoc Implementation**: Implemented `org.jaopp.scac` mDoc generation and testing in `packages/civ`.
- [ ] **OID4VP Implementation**: Extend `present-cli` to handle `presentation_definition` and generate compliant responses.
- [x] **DTC Type 1 Implementation**: Enhanced `issue_identity_document` to support ICAO DTC Type 1 (Derived) structure, preserving government signatures.
- [x] **Passport SOD Verification**: Implemented government signature verification against 570+ CSCA root certificates.

### MCP Enhancements (Demo Automation)
- [x] **End-to-End Demo Support**
  - [x] Update `list_available_documents` to return issuer key paths (classic/pqc).
  - [x] Remove `generate_example_document` (build-time generation instead of MCP-triggered scripts).
  - [x] Add VP preview metadata (sizes/docTypes/disclosed fields) for demo readability.

## 📅 Next (1-2 Months)

### Privacy & ZKP
- [x] **BBS+ Unlinkable Credentials (Tauri)**: Integrated keygen and proof generation into Tauri signer.
- [ ] **BBS+ Portability**: Port/Bridge BBS+ implementation to `signer-macos` via Rust FFI.
- [ ] **Production ZKP Pipeline (snarkjs)**

### 🏛️ Regulatory Compliance (Travel Rule & FATF)
- [ ] **Audit Trail Architecture**: Design the schema for VASP-side logging of "SCAC Issue/Verify" events to link anonymized ZKPs with real identities for audit purposes.
- [ ] **LEA Endpoint Specification**: Define a standardized API/Protocol for Law Enforcement Agencies to query the underlying identity of a ZKP subject (given a warrant).
- [ ] **IVMS101 Extension**: Draft a proposal for embedding ZKP-based "Pointer References" and "Issuer Signatures" into the standard FATF data exchange format.

### Civ Library Refinement
- [x] **Error Handling**: Explicitly handle card-specific errors (`IncorrectPin`, `CardLocked`) across all platforms.
- [x] **Extended Length APDU**: Implemented and verified for large data (e.g., high-res face photos) across macOS and Rust controllers.
- [x] **Full PACE/BAC Protocol Sync**: Resolved synchronization issues between controller and reader for Secure Messaging (SM) on macOS and Rust.

### Signer UX Evolution
- [ ] **macOS GUI (SwiftUI)**: Port Tauri's rich identity display and interaction to a native macOS SwiftUI application.
- [ ] **Interactive PIN Recovery**: Guide users through municipal office reset procedures via LLM when a card is locked.

## 🔮 Later (2026 / Q2+)

### Infrastructure & Mobile
- [ ] **Key Management**: Design Cloud KMS / On-premise HSM integration.
- [ ] **Revocation**: Implement mDoc Status List 2021 registry.
- [ ] **Mobile SDK**: Prototyping for Flutter/Kotlin (NFC reading -> SCAC reception).
- [ ] **Wallet Integration**: Partnership/Integration with crypto wallets.

### Standardization
- [ ] **OID4VC**: Implement OID4VCI (Issuance) and OID4VP (Presentation).
- [ ] **Global Compliance**: Travel Rule / FATF alignment.

### Civ Future-Proofing
- [ ] **FFI**: `uniffi-rs` bindings for Swift/Kotlin.
- [ ] **Crypto Consolidation**: Unify AES/3DES logic in `civ`.
- [ ] **Extended Length APDU**: Verify stability for large data.

---

## 🗺️ Strategic Roadmap (Context)

This section maps the tactical tasks above to broader strategic goals (imported from Phase 2-4 plans).

### Phase 2: Performance & Scalability (Focus)
*   **Optimization**: Address computational cost of RSA/ZKP via Wasm optimization.
*   **Unlinkability**: Deliver fully functional BBS+ credentials.
*   **ZKP Maturity**: Move from prototype circuits to production-ready `snarkjs` pipelines.

### Phase 3: Production Infrastructure
*   **Trust Anchors**: Move from local demo keys to KMS/HSM managed keys.
*   **Mobile First**: Enable mobile apps to act as Holders (SDK) and Signers.

### Phase 4: Standardization & Compliance
*   **Interoperability**: OID4VC support is critical for cross-ecosystem adoption.
*   **Regulatory**: Ensure JPKI/Travel Rule compliance for VASP adoption.
