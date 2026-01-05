# v0.2.0 - Holder Binding & OID4VP Support

This release introduces **Holder Binding** capabilities to Tobari, allowing Verifiable Presentations (VPs) to be cryptographic bound to a specific holder's device, significantly enhancing security against replay attacks and phishing.

## New Features

### 🔒 Holder Binding (Device Signed)
- **Concept**: Similar to ISO 18013-5 mdoc Device Authentication.
- **Mechanism**:
  - **Issuance**: A unique "Device Key" (P-384) is embedded in the Mobile Security Object (MSO) during credential issuance (`tobari-gen`).
  - **Presentation**: The holder signs a session-specific payload (Nonce, Audience) using their private Device Key.
  - **Verification**: The verifier checks the signature against the public key embedded in the MSO.

### 🌐 OID4VP Session Transcript
- Implemented **ISO 18013-7 / OpenID for Verifiable Presentations (OID4VP)** compliant Handover structure.
- **SessionTranscript**: `[null, null, [clientIdHash, responseUriHash, nonce]]`
- Ensures that the presentation is bound not just to a random nonce, but to a specific Verifier (Client ID) and return path (Response URI), preventing man-in-the-middle and forwarding attacks.

### 🛠 CLI Tools
- **`present-cli`**: New tool to generate Verifiable Presentations from a source credential.
  - Supports Selective Disclosure (filtering fields).
  - Supports Device Signing (Holder Binding) with `--nonce`, `--audience`, and `--response-uri`.
- **`verify-cli`**: Enhanced to verify Device Signatures and display OID4VP session data.
- **`tobari-gen`**: Updated to automatically generate and embed a Holder Device Key (simulating a Passkey registration).

## Improvements

- **CBOR/COSE**: Improved handling of COSE Key Maps (with negative integer keys) using `cbor-x`.
- **Security**: Added strict validation for Device Auth structures.

---

# v0.1.0 - Initial Release

- **Core Framework**: Schema-driven credential format.
- **Universal Viewer**: HTML-based viewer with font subsetting (IVS support).
- **Cryptography**: P-384 (ES384) COSE Sign1 implementation.
- **Selective Disclosure**: Granular privacy control.
