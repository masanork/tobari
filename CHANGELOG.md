# Changelog

## [0.3.21] - 2026-01-18

### Features
- **Signer (macOS)**:
  - **Native VP Signing**: Implemented ISO 18013-5 compliant Verifiable Presentation (VP) signing using **Secure Enclave** and `DeviceAuthentication` structure.
  - **Recursive Document Inspector**: Enhanced `inspect_document` with a native Swift CBOR parser, supporting recursive extraction of nested identity data (e.g., family members in Resident Records) and binary inspection.
  - **Improved Passport Reading**: Ported robust reading logic from the Rust `civ` implementation, including automatic SW 0x6C/0x61 retry handling and TLV-based size detection.
  - **Extended APDU Support**: Formally integrated **Extended Length APDU (Case 2E)** support for high-resolution face photo retrieval, improving stability across different NFC readers.
  - **Security Fallbacks**: Added automatic plain-text fallback for `SELECT` commands when Secure Messaging (SM) is rejected by certain card chips.
  - **CBOR Core**: Developed a lightweight `CBORWriter` in Swift to support native structure generation for mdoc signatures without external dependencies.
- **GUI & UX Polish**:
  - **Loading Overlays**: Implemented a professional, full-screen loading overlay with animated spinners and phase-specific status updates (e.g., "Extracting Face Photo...") to provide reassurance during physical card reading.
  - **Visual Identity**: Enhanced the Wallet with card-like row designs featuring DocType-specific gradients (Passport: Deep Blue, License: Cyan, Resident Record: Teal) and iconography.
  - **Refined Detail Views**: Updated the Identity Inspector header to mirror the card's visual identity, creating a cohesive user experience across the app.
- **MCP Server**:
  - **Flexible VP Integration**: Updated `create_presentation` to seamlessly handle full DeviceResponse VPs returned by the native macOS signer, enabling more complex signing workflows.

### Refactor
- **CIV Passport Module**:
  - **Modular Architecture**: Successfully refactored the monolithic 3,700-line `passport.rs` into a clean, modular structure under `src/passport/`.
  - **Logic Separation**: Decoupled high-level `PassportController` logic from low-level protocol implementations (BAC, PACE, CA, TA, AA) and session management.
  - **Improved Maintainability**: Reorganized file-related constants, TLV utilities, and MRZ extraction into dedicated sub-modules, significantly reducing cognitive load for future enhancements.
- **Protocol Stability**:
  - **Synchronization Fixes**: Resolved critical SSC (Send Sequence Counter) synchronization issues in the mock environment by ensuring proper Applet selection (SELECT ICAO) before each authentication sequence.
  - **Unified Testing**: Verified 100% test parity across unit tests, integrated identity tests, and CLI E2E tests, confirming that the modularization preserves all core functionalities including real-device compatibility.

## [0.3.20] - 2026-01-17

### Features
- **Wallet UX Improvements**:
  - **Auto-Detect ID**: Simplified the "Add ID" workflow with a new "Scan Card" feature that automatically identifies the card type (JPKI, Passport, Driver's License, Residence Card) and presents the correct input form (PIN/MRZ), reducing user friction.
  - **Decrypted Data Priority**: Enhanced the wallet inspector to prioritize displaying decrypted attribute values (e.g., Name from a JPKI card) over file metadata, ensuring the UI reflects the actual identity content.
  - **Human-Readable Labels**: Updated the credential grid to display clean, formatted names (e.g., "PASSPORT" instead of "PASSPORT_123...") while maintaining privacy-preserving filenames on disk.
- **Privacy Protection**:
  - **Anonymous Storage**: Reverted a proposal to include personal names in filenames, strictly adhering to the "Card Type + Hash" convention to prevent PII leakage at the file system level.

## [0.3.19] - 2026-01-16

### Features
- **Passkey & Device Binding**:
  - **Envelope v2.0**: Implemented a multi-recipient encryption format allowing documents to be decrypted by both **Passkeys (WebAuthn PRF)** and **Native Device Keys** (Secure Enclave).
  - **Portable Security**: Users can now access their encrypted wallet items across different devices (e.g., macOS and Windows) using a portable FIDO2 authenticator (YubiKey) or synced Passkey (iCloud Keychain).
- **Crypto Core**:
  - **WebAuthn PRF**: Implemented key derivation logic using the PRF (Pseudo-Random Function) extension of WebAuthn, securing the Document Encryption Key (DEK) with hardware-backed entropy.
  - **HKDF-SHA256**: Standardized key derivation across Rust (Tauri) and Swift (macOS) implementations.
- **Signer (Tauri)**:
  - **UI Integration**: Added "Use Passkey" toggle in the sidebar. When enabled, documents are saved in the new Envelope v2.0 format.
  - **Auto-Detection**: The wallet inspector now automatically detects Envelope v2.0 items and prompts for the appropriate authenticator.
- **Signer (macOS)**:
  - **Native PRF Support**: Extended the CLI and internal architecture to support `decrypt_data` for Envelope v2.0 structures, paving the way for native Passkey usage.
  - **Interoperability**: Verified decryption compatibility between the Rust-generated envelopes and the Swift decryption logic via automated test vectors.

## [0.3.18] - 2026-01-16

### Fixes
- **Tauri Signer**: Corrected JPKI attribute parsing by handling `FF20`/`DF20` wrapper tags and padding, restoring proper Basic 4 info extraction.
- **JPKI (My Number Card)**: Improved face photo extraction to handle nested TLV structures and signature-based fallback for real cards.
- **Driver's License (JPDL)**: Stabilized TLV parsing and photo handling to match the working macOS implementation.
- **Cross-Platform Photo Handling**: Added JPEG conversion on macOS with explicit format metadata so GUIs can render photos reliably.
- **Debug Logging**: Routed PC/SC and card-reader debug output through `TOBARI_DEBUG` for clean GUI operation.

All notable changes to this project will be documented in this file.


## [0.3.17] - 2026-01-15

### Features
- **APDU Specification Alignment**:
  - **Passport (BAC/PACE)**: Aligned Rust `civ` implementation with `signer-macos` by updating `MSE:Set AT` CLA to `0x00` and appending mandatory `0x28` (Le) to `EXTERNAL AUTHENTICATE` data, ensuring compatibility with real-world passport chips.
  - **JPKI (My Number Card)**: Updated `COMPUTE DIGITAL SIGNATURE` command to use CLA `0x00` and P2 `0x80`, matching the working macOS implementation and improving reliability across different card readers.
  - **Rust Implementation**: Verified `RND.IF` (8 bytes) and 3DES/AES secure messaging implementations against the perfectly working Swift codebase.
- **Documentation Updates**:
  - **ICAO 9303 (Passport)**: Updated `docs/civ/icao9303.md` to include mandatory `Le=28` for Mutual Auth and clarified PACE OID prefixing requirements.
  - **JPKI (My Number Card)**: Updated `docs/civ/jpki.md` to reflect the standardized CLA `00/80` usage for signature computation, ensuring documentation matches the actual cross-platform implementation.
- **Developer UI**:
  - **Tauri Signer**: Confirmed and verified the presence of the developer-focused multi-tab UI for JPKI, Passport, and Drivers License in the Tauri app, facilitating real-device testing parity with the macOS version.

## [0.3.16] - 2026-01-14

### Features
- **Cross-Platform Signer Alignment**:
  - **Unified Protocol Completion**: Achieved 100% parity between the Rust (Tauri) and Swift signers by porting the full `UnifiedRequest/UnifiedResponse` protocol.
  - **Standardized Presentation Flow**: Implemented `sign_presentation` with preview support in the Rust signer, allowing the MCP server to launch the Tauri GUI for user approval via a common JSON interface.
  - **Comprehensive Command Support**: Standardized `read_card`, `register_device`, `sign_data`, `sign_with_bbs`, and `bbs_generate_key` across all native implementations.
  - **File-based I/O**: Integrated `outputPath` support across the stack to handle large identity data and face photos efficiently without stdout bottlenecks.
- **Rust Signer**:
  - **Recursive mdoc Inspection**: Implemented recursive CBOR-to-JSON conversion for `inspect_document` command, enabling full extraction of nested data structures (e.g., family members in Resident Records).
  - **Interactive Preview Bridge**: Added logic to bridge Unified Interface requests to the Tauri GUI, enabling a seamless transition from CLI/LLM interactions to interactive user approval.
  - **Internal Logic Refactoring**: Decoupled core card-reading logic from Tauri commands to support both GUI and headless CLI modes.
- **MCP Server**:
- **Signer (macOS)**:
  - **Stability & Build Fixes**: Fixed critical compilation error in Passport MRZ parsing (String indexing) and resolved numerous Swift 6 concurrency warnings (MainActor isolation).
  - **Modernization**: Updated SwiftUI `onChange` handlers to modern API and strengthened `Sendable` conformance for `SmartCardManager`.
  - **Warning Cleanup**: Removed unused variables and resolved "result unused" warnings across the codebase.
  - **Universal Native Integration**: Refactored `jpki` and `tobari` tools to use the standardized JSON-based protocol, eliminating platform-specific branching and complex CLI flag management.
  - **Enhanced Error Handling**: Improved `runCivCommand` to natively parse Unified Interface errors (e.g., `IncorrectPin`, `PinLocked`) and provide descriptive feedback to the LLM.
  - **Optimized Data Transfer**: Leveraged `outputPath` for large binary data to minimize communication overhead and improve reliability.

## [0.3.15] - 2026-01-13

### Features
- **Unified Interface**:
  - **JSON-based Protocol**: Implemented unified request/response interface between signer-macos and MCP Server with structured error handling, preview support, and extensible command system.
  - **Swift Types**: Added `UnifiedRequest`, `UnifiedResponse`, `ResponseResult`, and `PreviewInfo` structures with full CBOR/JSON compatibility.
  - **TypeScript Types**: Mirrored type definitions in `unified-interface.ts` with helper functions for response creation and parsing.
  - **UnifiedCLIHandler**: Centralized request routing and response formatting in signer-macos with consistent error handling across all commands.
- **VP Preview (SwiftUI)**:
  - **COSE Parser**: Implemented native Swift parser for COSE_Sign1 and ISO 18013-5 mdoc structures without external dependencies.
  - **Preview UI**: Added `PresentationPreviewView` with field-by-field disclosure visualization, verifier information display, and approve/cancel workflows.
  - **Session Management**: Implemented `PreviewSession` with automatic timeout (5 minutes) and secure session ID generation for two-phase approval flow.
  - **Preview Flow**: Added `sign_presentation` (preview mode) and `approve_preview` commands following AP2-compatible design patterns.
- **Holder Binding** (juminhyo_poc_proposal.md):
  - **Application Creation**: Implemented `create_application` command to generate Device Keys (Signing + Encryption), read JPKI card for applicant info, and create JPKI-signed application documents.
  - **Issuer Workflow**: Added `issue_with_binding` to verify JPKI signature, embed Device public key in MSO, and encrypt mdoc for Device encryption key.
  - **OID4VP Presentation**: Implemented `create_oid4vp_presentation` with Device signature, selective disclosure, and session handover (verifierId, nonce, responseUri) for phishing prevention.
  - **ApplicationDocument**: Defined complete application structure in Swift with Device Key binding, JPKI signature info, and applicant identification metadata.
- **MCP Server**:
  - **Holder Binding Tools**: Added three new MCP tools (`create_application`, `issue_with_binding`, `create_oid4vp_presentation`) exposing the complete holder binding workflow to LLM.
  - **Unified Migration**: Migrated existing JPKI reading tools (`read_basic_info`, `read_mynumber`, `read_photo`, etc.) to use unified interface for consistent error handling and preview support.
  - **VP Tools Migration**: Updated VP generation and signing tools to leverage unified signer interface with improved error reporting.
- **Developer Experience**:
  - **Test Scripts**: Added comprehensive test scripts (`test-holder-binding.ts`, `test-vp-preview.ts`) demonstrating full workflows with colored output and step-by-step explanations.
  - **Schema Validation**: Updated `create_application` to accept `requestedDocType` and `requestedFields` directly instead of requiring pre-existing mdoc files, aligning with real-world application flows.
  - **Decryption Utility**: Added `decrypt-demo-mdoc-v3.ts` for converting encrypted demo files to plaintext for testing.

### Breaking Changes
- **create_application API**: Changed from `documentPath` parameter to `requestedDocType` + `requestedFields`, reflecting the reality that applicants don't yet have the document they're applying for.

## [0.3.14] - 2026-01-12

### Features
- **Signer (macOS)**:
  - **SwiftUI GUI**: Implemented a modern, native GUI with automatic card detection, secure PIN entry sheets, and identity result views.
  - **Camera MRZ Scanning**: Integrated macOS **Vision framework** for real-time OCR scanning of Passport MRZ (Machine Readable Zone), eliminating manual entry.
  - **Strict MRZ Parsing**: Implemented ICAO 9303 compliant parsing for TD1, TD2, and TD3 formats with full checksum validation.
  - **PACE GM/ECDH**: Completed the PACE Generic Mapping (GM) and ECDH key agreement using dynamic OpenSSL linkage for advanced elliptic curve math.
  - **Passport Authenticity**: Added support for reading **EF.SOD (Document Security Object)** to enable downstream verification of government signatures.
  - **JPKI Verifiability**: Added retrieval of **Intermediate CA Certificates** to enable offline verification of the full trust chain.
  - **License Verifiability**: Captured **raw Data Group 1 bytes** and police signatures to enable mathematical proof of non-alteration.
  - **OS Integration**: Added Touch ID authentication and native secure PIN input dialogs for a seamless macOS experience.
- **Signer (Unified)**:
  - **Multi-Platform Verifiability Parity**: Ported advanced evidence collection (JPKI CA certs, Driver's License raw bytes/signatures) to the Tauri (Rust) signer via `civ` crate enhancements.
  - **JPKI/My Number Card**: Integrated full JPKI support (Sign, Read attributes/mynumber/photo) across both Tauri and macOS signers.
  - **Identity Documents**: Added native support for reading **ePassport (ICAO 9303)**, **Japanese Driver's License**, and **Residence Card**.
  - **BBS+ Unlinkability**: Integrated BBS+ key generation and Zero-Knowledge Proof (ZKP) generation into the Tauri signer backend.
  - **Structured Error Handling**: Implemented detailed error reporting for PIN retries, card locking, and hardware failures across all platforms.
- **MCP Server**:
  - **Authenticity Analysis**: Updated `preview_presentation` to automatically detect and report the presence of authenticity evidence (SOD, CA Certs, Police Signatures).
  - **ePassport Trust Chain**: Implemented full trust chain verification for ePassport SOD using a local CSCA Master List (570+ government roots).
  - **DTC Type 1 Compliance**: Enhanced `issue_identity_document` to support ICAO DTC Type 1 (Derived) structure, preserving binary government signatures (SOD) and Data Groups (DG1, DG2).
  - **Identity Tools**: Exposed `read_passport`, `read_driver_license`, and `read_residence_card` tools to LLM.
  - **Hardware-bound Issuance**: Added `issue_identity_document` tool to create hardware-encrypted mdocs from arbitrary physical card data, leveraging the new `--sign-mso` hardware signing capability.
  - **BBS+ Integration**: Added `generate_bbs_key` and `sign_with_bbs` tools.
- **Testing**:
  - **Signer-macOS Tests**: Added comprehensive mock-based unit tests for JPKI, Passport (BAC/PACE), License, and Residence Card controllers with an automated test runner.

## [0.3.13] - 2026-01-11

### Features
- **Codec**:
  - **WebAuthn Native Support**: Extended ISO 18013-5 mdoc implementation to support WebAuthn (FIDO2) assertions as a valid DeviceAuth format.
  - **Signature Binding**: Added verification logic to ensure the WebAuthn challenge matches the hash of the mdoc `DeviceAuthentication` structure.
  - **Assembler**: Added `assembleWebAuthnDeviceAuth` to wrap FIDO `authData` and `clientDataJSON` into COSE unprotected headers.
- **Signer (Tauri)**:
  - **Standardized Assertions**: Updated Rust backend to return raw WebAuthn assertions (`signature`, `authData`, `clientDataJSON`) for native mdoc assembly.
  - **Hardware Registration**: Updated `perform_register` to return JSON including both Credential ID and Public Key (JWK) for issuance.
  - **UI Update**: Refactored frontend to handle the new structured JSON responses from the Rust core.
- **MCP Server**:
  - **Flexible Assembly**: Updated `assemble_presentation` to handle both direct ECDSA and WebAuthn signature objects transparently.

## [0.3.12] - 2026-01-11

### Features
- **Signer (macOS)**:
  - **Secure Enclave Encryption**: Implemented **ECIES (P-256 Key Agreement)** support for hardware-backed decryption.
  - **JPKI Certificate Retrieval**: Added ability to read User Authentication Certificates from My Number Cards and extract RSA public keys as JWK.
  - **CLI Stability**: Added `TOBARI_DEBUG` environment variable to control debug output, ensuring stable JSON parsing for parent processes.
- **MCP Server**:
  - **Hardware Registration**: Added `register_device` tool to export Secure Enclave signing and encryption public keys.
  - **Self-Issuance**: Implemented `issue_local_credential` tool to create encrypted, hardware-bound "Master mdocs" directly from My Number Card data.
  - **Automatic Decryption**: `read_tobari_file` now automatically detects device-bound ECIES encryption and invokes `signer-macos` for seamless hardware-backed decryption.
  - **Platform Optimization**: Refined `create_presentation` to prioritize `signer-macos` (direct ECDSA) over WebAuthn on macOS for standard mdoc compatibility.
- **Tests**:
  - **Integration Tests**: Added `signer_integration.test.ts` to verify the full ECIES decryption flow between Node.js (WebCrypto) and macOS (CryptoKit).


## [0.3.11] - 2026-01-11

### Features
- **MCP Server**:
  - **Readable VP Preview**: Added `preview_presentation` output controls (`format`, `includeDecoded`, `redact`, `maxStringLength`) for human-readable VP inspection.
  - **Device Auth Fallback**: `create_presentation` now validates signer paths and can fall back to an ephemeral device key when the signer is unavailable.
  - **Demo Simplification**: Removed `demo_generate_example` to keep demo assets build-time only; `demo_list_examples` remains.
- **Tests**:
  - Added MCP server tests for encrypted reads, readable previews, decoded previews, and signer fallback behavior.

## [0.3.10] - 2026-01-11

### Features
- **Post-Quantum Cryptography (PQC)**:
  - **Full PoC Lifecycle**: Completed the end-to-end flow for **ML-DSA-65** countersignatures (Generation in `tobari-gen` -> Verification in `validator`).
  - **CLI Support**: Updated `verify-cli` to accept PQC public keys and verify hybrid signatures (Classic + PQC).
  - **MCP Integration**: Updated `read_tobari_file` and `verify_presentation` tools to report PQC verification status ("Valid (Classic + PQC)").
  - **Tool Refactoring**: Reorganized MCP tools to clearly separate core business logic from development utilities.
    - Renamed `list_available_documents` -> `demo_list_examples`.
    - Renamed `start_demo_server` -> `demo_start_server`.
    - Added `demo_generate_example` for autonomous test data generation.

## [0.3.9] - 2026-01-11

### Features
- **Signer (macOS)**:
  - **Native JPKI Support**: Fully implemented JPKI signing, My Number reading, and Face Photo retrieval using macOS **CryptoTokenKit**.
  - **Stability**: Replaced unstable PCSC calls with native system APIs to resolve Extended APDU issues on macOS.
  - **Testing**: Added comprehensive mock-based unit tests for all JPKI operations in `signer-macos`.
- **MCP Server**:
  - **Smart Platform Detection**: Automatically detects macOS environment and switches to the native `signer-macos` tool for JPKI operations.
  - **Seamless Integration**: Unified JPKI tool interfaces (`sign_with_jpki`, `read_mynumber`, `read_photo`) to work transparently across platforms (Native on macOS, `civ` on Linux/Windows).

## [0.3.8] - 2026-01-10

### Features
- **Security & Encryption**:
  - **Hardware-Bound Encryption**: Implemented HPKE (Hybrid Public Key Encryption) anchored to hardware Authenticators (Passkeys/TouchID) for end-to-end device binding.
  - **Visual Side-Channel Protection**: Encrypted font glyphs (embedded WOFS) to prevent text reconstruction attacks via side-channels.
  - **Isolated Web Apps (IWA)**: Added PoC for Signed Web Bundles (`.swbn`) to enable verification of the Viewer code itself in offline environments.
- **Viewer & UI**:
  - **Rebranding**: Complete UI overhaul with "Lightweight Veil" design language, featuring high-fidelity official document aesthetics and glassmorphism.
  - **Secure Shell Model**: Implemented "Secure Shell" architecture where documents are dropped into a protected local view, preventing accidental data exfiltration.
  - **Juminhyo Layout**: specialized responsive layout for **Residence Certificates**, optimizing scrolling and mobile presentation.
- **Documentation**:
  - **VitePress Migration**: Launched comprehensive documentation site using VitePress with full English translations and improved navigation.
  - **New Specifications**: Added detailed implementation guides for **Key Management**, **Post-Quantum Cryptography (PQC)** roadmap, and **Threat Models**.

### Fixes
- **Viewer**: Resolved stack overflow issues when rendering large binary blobs (embedded fonts) in the secure context.
- **Build**: Fixed various issues with asset paths and VitePress build configuration.

## [0.3.7] - 2026-01-10

### Features
- **CIV (Universal Identity)**:
  - **New Card Support**:
    - **Thai National ID**: Full support for reading identity from Thai ID cards (TIS-620 encoding).
    - **Malaysia MyKad**: Support for reading JPN (Identity) application data from MyKad.
  - **Unified Identity Model**: Added support for **Face Photo** retrieval and improved attribute mapping across all card types.
  - **Extended APDU**: Optimized `PcscReader` to support **Extended Length APDUs** (up to 64KB), preparing for PQC (Post-Quantum Cryptography) and large file transfers.
  - **Refactor**: Re-architected the mock system into a **modular backend** structure (`mock/jpki.rs`, `mock/passport.rs`, etc.) for better maintainability and scalability.
- **Web Integration**:
  - **WebUSB (CCID)**: Implemented a pure-JS CCID driver in `web-demo` to allow direct communication with smart card readers from the browser.

## [0.3.6] - 2026-01-10

### Features
- **CIV (Universal Identity)**:
  - **Unified Identity Model**: Implemented a standardized `CitizenIdentity` struct across all supported card types (JPKI, Passport, Drivers License, Residence Card, PIV).
  - **PIV Support**: Added full support for US PIV cards (NIST SP 800-73), including X.509 certificate reading, dynamic authentication (Challenge-Response), and signing.
  - **Mocking**: Significantly enhanced the mock backend to support:
    - **Passport**: Active Authentication (AA) with dynamic ECDSA key generation.
    - **PIV**: Full authentication flow with self-signed mock certificates.
  - **Error Handling**: Standardized ISO 7816-4 status word mapping to typed `CivError` (e.g., `AccessDenied`, `SecureMessagingError`).
  - **Web/Wasm**:
    - **Wasm Bindings**: Enhanced `CivContext` for Wasm, enabling `IdentityController` logic in browser environments.
    - **Web Demo**: Added `examples/web-demo` (React/Vite) demonstrating reading identity from Mock/WebUSB in the browser.
  - **CI/CD**:
    - **GitHub Actions**: Added `civ-ci.yml` for automated testing and coverage (`cargo-tarpaulin`) on every push.
    - **E2E Tests**: Added CLI integration tests (`cli_e2e.rs`) to verify `id` command against mock cards.
  - **Fixes**:
    - **Passport BAC**: Fixed Secure Messaging MAC verification and SSC synchronization in mock environment.
    - **Response Handling**: Corrected SW appending logic in Secure Messaging wrapper.

## [0.3.5] - 2026-01-10

### Features
- **Ininjo (Power of Attorney)**:
  - **Compliance**: Fully aligned schema and layout with Digital Agency's official specifications (Law enforcement examples).
  - **Viewer**: Enhanced rendering to support "Analysis Display Example" layout, including provider info and signature verification status.
  - **Security**: Upgraded to **P-384** curve for higher security and implemented flexible curve detection in Viewer.
- **CIV / Passport**:
  - **EAC/PACE**: Hardened PACE protocol logic and fixed synchronization issues between controller and mock.
  - **ZKP**: Added circuit prototypes for privacy-preserving passport verification (Age Verification etc.).

## [0.3.4] - 2026-01-09

### Features
- **SCAC (Self-Hosted Crypto Account Credential)**:
  - **New Credential**: Implemented SCAC for proving ownership of crypto accounts across multiple chains without revealing wallet addresses.
  - **Privacy**: Integrated **BBS+ Signature** (BBS 2023) and **Selective Disclosure** flow for unlinkable presentations.
  - **Protocol**: Implemented full `bbs-signature-2023` suite and ZKP generation for identity proofs.
- **CIV Security**:
  - **Passive Authentication**: Implemented full hash verification for EF.SOD and Data Groups (DG1/DG2/DG13 etc.).
  - **Mock**: Completed robust mock framework for JPKI, Passport, and Drivers License to simulate various edge cases.

## [0.3.3] - 2026-01-08

### Features
- **JPDL (Drivers License)**:
  - **Full Support**: Implemented `DriversLicenseController` for reading Text, Photo, and Conditions.
  - **Encoding**: Proper **Shift-JIS (CP932)** decoding including Gaiji placeholders.
  - **Security**: Added support for **PIN 1** (Common) and **PIN 2** (Sensitive/Honseki) verification.
  - **Photo**: Implemented JPEG2000 extraction from `DF2`.
- **JPRC (Residence Card)**:
  - **Full Support**: Implemented `ResidenceCardController` targeting `DF2` (Address/Permits) and `DF1` (Photo).
  - **Encoding**: **UTF-8** parsing for address and permit fields.
- **Refactor**:
  - Renamed modules to `jpdl` and `jprc` for better internationalization readiness.
  - Standardized APDU logic across all card types.

## [0.3.2] - 2026-01-07

### Features
- **CIV (JPKI/My Number Card)**:
  - **Refactored Identity Retrieval**: Implemented strict **BER-TLV** parsing for robust extraction of Basic 4 Info and My Number.
  - **Live Hardware Tuning**: Corrected File IDs (FID) based on real-world J-LIS card testing (`0001` for My Number, `0002` for Attributes).
  - **Security**: Added safe interactive PIN prompts (no-echo) and high-level signing APIs.
  - **Retry Monitoring**: Implemented comprehensive retry count checks for all PIN types, including Visual AP (Password A/B).
  - **In-Progress**: Face Photo retrieval logic refactored to support Password A (12-digit) and Password B (14-digit) "Direct Authentication" mode.
- **Documentation**:
  - Added technical specification `mynacard.md` and `implementation_insights.md`.
  - Updated `IMPLEMENTATION_STATUS.md` with detailed hardware test findings.

## [0.3.1] - 2026-01-07

### Features
- **JPKI Simulation**:
  - Enhanced `dummy-myna` CLI to generate valid RSA-2048 signatures (SHA-256) for realistic JPKI testing.
  - Updated dummy identity data to conform to JIS X 0208 character set restrictions.

### Refactor
- **MCP Server**:
  - Modularized codebase by splitting monolithic `index.ts` into `tools/`, `schemas.ts`, and `utils.ts`.
  - Improved path resolution robustness in document discovery tools.

## [0.2.1] - 2026-01-06

### Features
- **Ininjo Example (Electronic Power of Attorney)**:
  - Added new PoC example `examples/ininjo` demonstrating nested data structures (Type "Group").
  - Updated Viewer to handle hierarchical data rendering recursively.
- **Build System**:
  - Added `scripts/build_examples.ts` to automatically discover and build all examples in `examples/`.

## [0.2.0] - Holder Binding & OID4VP Support

This release introduces **Holder Binding** capabilities, significantly enhancing security against replay attacks and phishing by binding VPs to a specific holder's device.

## [0.1.0] - Initial Release

- **Core Framework**: Schema-driven credential format.
- **Universal Viewer**: HTML-based viewer with font subsetting (IVS support).
- **Cryptography**: P-384 (ES384) COSE Sign1 implementation.
- **Selective Disclosure**: Granular privacy control.