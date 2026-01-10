# Changelog

All notable changes to this project will be documented in this file.


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
