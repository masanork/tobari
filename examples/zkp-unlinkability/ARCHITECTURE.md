# Architecture for Privacy-Preserving Tobari

To move from the current **Mock/Conceptual** ZKP to a real implementation in Tobari, we would need to integrate a cryptographic scheme that supports **Zero-Knowledge Proofs of Knowledge (ZKPoK)** of a signature.

## Recommended Scheme: BBS+ Signatures

**BBS+ (Boneh-Boyen-Shacham)** signatures are the industry standard for "Unlinkable Selective Disclosure" in the Verifiable Credentials (W3C/ISO) space.

### 1. Cryptographic Primitives
We need a library that supports **BLS12-381** pairing-friendly curves.
- **Candidate**: `@noble/bls12-381` (Pure JS/TS, works in Bun/Node/Browser).
- **Candidate**: `bbs-signatures` (WASM wrapper around Rust `mattrglobal` impl).

### 2. Data Structure Changes

#### Current (ISO 18013-5 / COSE)
- **Issuer**: Signs `Hash(MSO)` with ECDSA (P-256/P-384).
- **Holder**: Sends `MSO` + `IssuerSignature`.
- **Verifier**: Hashes `MSO`, verifies `IssuerSignature`.
- **Privacy**: Selective disclosure works (hiding fields), but `IssuerSignature` tracks the user.

#### Proposed (ZKP / BBS)
- **Issuer**: Signs Vector of Messages `[Attribute1, Attribute2, ..., SecretNonce]` with BBS+.
- **Holder**: 
  - Computes a **Blind Proof** of the signature.
  - Selects attributes to reveal.
  - Generates a **randomized proof** string.
- **Verifier**:
  - Verifies the proof against Issuer's BLS Public Key.
  - Checks revealed attributes match.
- **Privacy**: `IssuerSignature` is NEVER sent. The proof is random every time.

## Integration Path for Tobari

1.  **Add `packages/crypto-bbs`**: A new package wrapping the chosen library.
2.  **Extend `tobari-gen.ts`**: Add `generateSignedTobariBBS` function.
3.  **Extend Validator**: Add `verifyTobariBBS` function.
4.  **Browser Support**: Ensure the BLS library compiles to WASM or runs in JS (Noble does).

### Comparison
| Feature | Current Tobari (ECDSA) | Proposed Tobari (BBS+) |
| :--- | :--- | :--- |
| **Integrity** | ✅ High | ✅ High |
| **Selective Disclosure**| ✅ Yes (via Salted Hash) | ✅ Yes (Native) |
| **Unlinkability** | ❌ No (Sig is static) | ✅ Yes (Randomized Proof) |
| **Performance** | ⚡ Fast (~1ms) | 🐢 Slower (~10-50ms) |
| **Signer Key** | P-256 / P-384 | BLS12-381 |
