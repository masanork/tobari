# Changelog

All notable changes to this project will be documented in this file.


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
