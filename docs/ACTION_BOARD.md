# Tobari Action Board

**Last Updated:** 2026-01-11
**Scope:** Tobari Project (MCP/Signer/SCAC/Compliance/civ)

## 🚀 Now (Current Sprint)

### macOS & Signer Integration
- [x] **macOS Native Integration**: `mcp-server` automatically detects macOS and invokes `signer-macos` (CTK/Secure Enclave) for JPKI and Device Auth.
- [x] **Device-bound Decryption (ECIES)**: Implemented full-stack decryption flow using Secure Enclave Key Agreement via `mcp-server` and `signer-macos`.
- [x] **Hardware-backed Registration**: Added `register_device` tool to export Secure Enclave public keys for issuance.
- [x] **Self-Issuance Workflow**: Implemented `issue_local_credential` to create hardware-bound "Master mdocs" from JPKI data, enabling card-less future interactions.
- [x] **MCP ↔ Tobari Signer (Tauri/FIDO) Coupling**
  - [x] **Resolve Protocol Mismatch**: Extended Tobari VP format and `@tobari/codec` to natively support WebAuthn assertions (`authData` + `clientDataJSON`).
  - [x] **Implement in Tauri**: Updated `tobari-signer` (Rust) to return raw WebAuthn assertions for assembly by MCP.
  - [x] **Extended Identity Support**: Added Passport (BAC/PACE), Driver's License, and Residence Card reading.
  - [x] **Native macOS UX**: Integrated Touch ID and native PIN prompt dialogs.
  - [x] Document build/install steps for macOS/Windows and `TOBARI_SIGNER_PATH` configuration.

### Performance & PQC
// ... (omitted) ...
### Compliance & SCAC
- [ ] **FATF/SCAC Operations Mapping**
  - [ ] Create correspondence table for VASP risk assessment vs VP elements.
  - [ ] Draft minimal Travel Rule interface.
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
// ... (omitted) ...
### Civ Library Refinement
- [x] **Error Handling**: Explicitly handle card-specific errors (`IncorrectPin`, `CardLocked`) across all platforms.
- [ ] **Extended Length APDU**: Verify stability for large data across various readers.
- [ ] **Full PACE/BAC Crypto**: Complete the ECC/MAC implementation for macOS native passport reading.

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
