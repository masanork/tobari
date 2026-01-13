# Tobari Action Board

**Last Updated:** 2026-01-11
**Scope:** Tobari Project (MCP/Signer/SCAC/Compliance/civ)

## 🚀 Now (Current Sprint)

### macOS & Signer Integration
- [x] **macOS Native Integration**: `mcp-server` automatically detects macOS and invokes `signer-macos` (CTK/Secure Enclave) for JPKI and Device Auth.
- [x] **Device-bound Decryption (ECIES)**: Implemented full-stack decryption flow using Secure Enclave Key Agreement via `mcp-server` and `signer-macos`.
- [x] **Hardware-backed Registration**: Added `register_device` tool to export Secure Enclave public keys for issuance.
- [x] **Self-Issuance Workflow**: Implemented `issue_local_credential` to create hardware-bound "Master mdocs" from JPKI data, enabling card-less future interactions.
- [x] **LLM Communication Optimization**: Added `inspect_document` to `signer-macos` to offload CBOR parsing and minimize binary data transfer to LLM.

### 🔄 Cross-Platform Signer Alignment (Tauri/Rust)
- [ ] **Unified Interface Porting**: Implement `UnifiedRequest`/`UnifiedResponse` protocol in Tauri signer CLI to match `signer-macos`.
- [ ] **Rust-based Document Inspector**: Implement `inspect_document` logic in Rust using `ciborium` to support local parsing on Windows/Linux.
- [ ] **File-based I/O Support**: Update Tauri signer to support `outputPath` for Verifiable Presentations, returning paths instead of large Base64 strings.
- [ ] **Windows TPM Integration**: Research and implement hardware-bound key support for Windows (NCrypt/TPM) to match Secure Enclave functionality.

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
