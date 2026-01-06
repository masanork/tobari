# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1] - 2026-01-06

### Features
- **Ininjo Example (Electronic Power of Attorney)**:
  - Added new PoC example `examples/ininjo` demonstrating nested data structures (Type "Group").
  - Updated Viewer to handle hierarchical data rendering recursively.
  - Implemented client-side signature verification (embedding Issuer Key in HTML).
  - Added visual tampering indicators (Hash Mismatch warnings).
- **Build System**:
  - Added `scripts/build_examples.ts` to automatically discover and build all examples in `examples/`.
  - Added `bun run build:examples`.

## [0.2.0] - Holder Binding & OID4VP Support

This release introduces **Holder Binding** capabilities, significantly enhancing security against replay attacks and phishing by binding VPs to a specific holder's device.

### Features
- **Holder Binding (Device Signed)**:
  - Implemented ISO 18013-5 mdoc-like Device Authentication.
  - Issuance: Embeds a unique "Device Key" (P-384) in the MSO.
  - Presentation: Signs session payload (Nonce, Audience) using private Device Key.
- **OID4VP Session Transcript**:
  - Implemented ISO 18013-7 / OpenID for Verifiable Presentations compliant Handover structure.
  - SessionTranscript: `[null, null, [clientIdHash, responseUriHash, nonce]]`.
- **CLI Tools**:
  - `present-cli`: Generate VPs with Selective Disclosure and Device Signing.
  - `verify-cli`: Verify Device Signatures and display OID4VP session data.
  - `tobari-gen`: Updated to generate/embed Holder Device Key.

### Improvements
- **CBOR/COSE**: Improved handling of COSE Key Maps.
- **Security**: Added strict validation for Device Auth structures.

## [0.1.0] - Initial Release

- **Core Framework**: Schema-driven credential format.
- **Universal Viewer**: HTML-based viewer with font subsetting (IVS support).
- **Cryptography**: P-384 (ES384) COSE Sign1 implementation.
- **Selective Disclosure**: Granular privacy control.
