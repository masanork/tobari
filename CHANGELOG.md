# Changelog

All notable changes to this project will be documented in this file.


## [0.3.1] - 2026-01-07

### Features
- **JPKI Simulation**:
  - Enhanced `dummy-myna` CLI to generate valid RSA-2048 signatures (SHA-256) for realistic JPKI testing.
  - Updated dummy identity data to conform to JIS X 0208 character set restrictions.

### Refactor
- **MCP Server**:
  - Modularized codebase by splitting monolithic `index.ts` into `tools/`, `schemas.ts`, and `utils.ts`.
  - Improved path resolution robustness in document discovery tools.


This release introduces the **Model Context Protocol (MCP) Server**, enabling AI agents to autonomously discover, read, verify, and present Tobari credentials. It also adds the **Service Request** concept, allowing procedures to define machine-readable requirements.

### Features
- **MCP Server (Digitized Agency)**:
  - Introduced `@tobari/mcp-server` for agentic workflows.
  - `list_available_documents`: Discovers Tobari files (HTML/CBOR) in the workspace.
  - `read_tobari_file`: Verifies signatures and extracts credential data.
  - `analyze_service_request`: Parses procedure requirements (Schema, Attributes).
  - `create_presentation`: Generates Verifiable Presentations (VP) with Selective Disclosure.
  - `verify_presentation`: Validates incoming VPs and Holder Binding.
- **Service Request PoC**:
  - Defined `ServiceRequest` schema for administrative procedures.
  - Added **Bank Account Balance Certificate** example.
  - Added **Service Request Viewer** with visual tutorial.
- **Documentation**:
  - Added `MCP_SERVER.md` with Claude Desktop configuration guide.

### Improvements
- **Performance**: Optimized HTML parsing and Base64 extraction in payload reader.
- **COSE**: Fixed algorithm ID parsing and test key usage.

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
