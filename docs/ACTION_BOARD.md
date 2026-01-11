# Tobari Action Board

**Last Updated:** 2026-01-11
**Scope:** Tobari Project (MCP/Signer/SCAC/Compliance/civ)

## 🚀 Now (Current Sprint)

### macOS & Signer Integration
- [x] **macOS Native Integration**: `mcp-server` now automatically detects macOS and invokes `signer-macos` (CTK-based) for JPKI operations, bypassing PCSC issues.
- [ ] **MCP ↔ Tobari Signer (Tauri/FIDO) Coupling**
  - [ ] Verify external signing flow in `packages/mcp-server/src/tools/tobari.ts` with real devices.
  - [ ] Define CLI arguments and JSON output spec for `packages/signer`.
  - [ ] Document build/install steps for macOS/Windows and `TOBARI_SIGNER_PATH` configuration.

### Performance & PQC
- [ ] **WASM/Performance Optimization Plan**
  - [ ] Measure benchmarks for RSA verification (Passport/JPKI) and ZKP generation.
  - [ ] Investigate multi-threading and hardware acceleration support in Wasm.
- [x] **Post-Quantum Cryptography (PQC)**
  - [x] **Standardization**: Issuer = P-384, Device = P-256. PQC via COSE Countersign (Experimental).
  - [x] **PoC Implementation (ML-DSA-65)**:
    - [x] `tobari-gen`: Add IssuerAuth countersign generation.
    - [x] `validator`: Implement countersign verification and status display.
    - [x] Update `verify_presentation` tool to return PQC status.
    - [x] Documentation: Update demo steps for PQC keys.
  - [x] **ML-KEM (WASM)**: Integrate ML-KEM-768 keygen/encap/decap in crypto-wasm (full build).

### Compliance & SCAC
- [ ] **FATF/SCAC Operations Mapping**
  - [ ] Create correspondence table for VASP risk assessment vs VP elements.
  - [ ] Draft minimal Travel Rule interface.

### MCP Enhancements (Demo Automation)
- [ ] **End-to-End Demo Support**
  - [ ] Update `list_available_documents` to return issuer key paths (classic/pqc).
  - [ ] Create `generate_example_document` tool to trigger `gen-tobari.ts` scripts.

## 📅 Next (1-2 Months)

### Privacy & ZKP
- [ ] **BBS+ Unlinkable Credentials**
  - [ ] Resolve Wasm interface issues for blind signatures.
  - [ ] Implement seamless proof generation pipeline.
- [ ] **Production ZKP Pipeline (snarkjs)**
  - [ ] Integrate RSA/ECDSA verification circuits into `passport.circom`.
  - [ ] Establish testing with real passport data.

### Civ Library Refinement
- [ ] **Error Handling**: Explicitly handle card-specific errors (`IncorrectPin`, `CardLocked`, `NotAuthenticated`) in `CivError`.
- [ ] **Documentation**: Standardize Rustdoc comments for public APIs.

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
