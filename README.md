# Tobari (帳)

> **A Lightweight Veil for Verifiable Documents.**
> *Providing a thin, secure screen between data and agents.*

Tobari is a set of minimal tools for the AI Agent era. It provides a simple way to add authenticity and machine-readability to digital documents, acting like a thin "veil" (Tobari) that protects privacy while ensuring integrity.

Tobari is a digital certificate framework that imparts strong authenticity and machine readability while maintaining the "human-readable" experience of existing documents. It reconciles the trust placed in "completed forms" (like PDF or paper) with the engineering need for "programmatic verification and parsing" within a single, self-contained HTML file.

Through the **civ (Citizen Identity Verification)** library, it also securely connects public personal authentication infrastructures (like My Number Cards and Passports) with the world of Web and AI agents.

## Core Philosophy

- **Silent Adoption**: Users perceive it merely as a "beautiful Web document," without needing to be conscious of the underlying P-384 signatures or advanced cryptography.
- **Data First (Schema-driven)**: Authenticity is granted to the data structure itself, not bound to a specific layout. Responsive viewing views are automatically generated.
- **Verifier First**: Prioritizes "practical portability," allowing recipients to verify authenticity without special software and import raw data directly into their systems.

## Key Features

1. **SD-CBOR / Selective Disclosure**:
   Submit documents with specific fields (e.g., My Number, Date of Birth) physically removed while maintaining signature integrity. Balances privacy and authenticity.
2. **Universal Viewer (Schema-driven)**:
   Automatically constructs responsive views from CDDL/YAML schemas. Eliminates dependency on specific form formats, improving accessibility and readability.
3. **P-384 / ES384 Signature**:
   Standardizes on P-384 (ECDSA), the latest recommended algorithm, to ensure long-term authenticity.
4. **Font Subsetting & IVS Support**:
   Supports Ideographic Variation Sequences (IVS), essential for Japanese names. Extracts and embeds only necessary glyphs from IPA MJ Mincho, achieving perfect rendering in just a few dozen KB.
5. **Holder Binding (Device Signature)**:
   Supports device authentication compliant with ISO 18013-5 (mdoc) and OID4VP. Cryptographically guarantees that the presented data comes from the legitimate owner.
   [Read more: docs/HOLDER_BINDING.md](docs/HOLDER_BINDING.md)
6. **Zero-Knowledge Proofs (ZKP)**:
   Supports ZK circuits (Circom) and BBS+ signatures for "Unlinkable Proofs" and proving "Over 18" without revealing birth dates.

## Advanced Privacy & Web3 Compliance

Tobari goes beyond simple digital certificates, equipped with advanced privacy features to support Web3 and financial regulations (FATF Travel Rule).

### SCAC: Crypto Account Ownership Credential
A credential model to comply with [FATF Unhosted Wallet Regulations](docs/FATF_ANALYSIS.md). It cryptographically binds a verified individual to self-custody wallets (Ethereum, Solana, etc.).

### ZKP Examples
- **Passport Age Verification**: Proving age requirements without revealing the passport number.
- **BBS+ Unlinkability**: "Untraceable proofs" where presenting the same credential multiple times does not link to the same identity.

Run these demos with:
```bash
bun run demo:zkp:passport
bun run demo:zkp:bbs
bun run demo:scac
```

## Project Structure

- `packages/codec`: CDDL generation from YAML, signed binary (.cose) generation, HTML viewer bundling.
- `packages/civ`: Universal Identity Library for manipulating smart cards. Verified with My Number Card (JPKI), Driver's License, and Passport (BAC).
- `packages/crypto`: P-384 COSE signing/verification core implementation.
- `packages/mcp-server`: Model Context Protocol interface for AI Agent integration.
- `packages/holder`: Tauri-based companion app for WebAuthn/FIDO signing and ID card reading.
- `packages/signer-macos`: Native Swift implementation for improved macOS smart card support.
  - **Note**: Passport reading via BAC is verified. PACE support is currently experimental.
- `examples`: Implementation references (Juminhyo, Ininjo) demonstrating SD-CBOR and nested structures.

## Documentation

Full documentation is available at [**https://masanork.github.io/tobari/**](https://masanork.github.io/tobari/) or in the `docs/` directory.

- [Architecture Overview](docs/ARCHITECTURE.md)
- [MCP Server (AI Integration)](docs/MCP_SERVER.md)
- [Holder Binding](docs/HOLDER_BINDING.md)
- [Schema Specification](docs/SCHEMA_SPEC.md)
- [CLI Tools Reference](docs/CLI_TOOLS.md)

## Quick Start

Tobari uses **IPAmj Mincho** for high-precision Japanese text rendering. Due to license restrictions, the font file is not included in the repository.

1. **Prepare Font**:
   Download `ipamjm.ttf` from the [IPA Website](https://moji.ipa.go.jp/mojikiban/mjmincho/) and place it at:
   `shared/fonts/ipamjm.ttf`

2. **Install Dependencies**:
   ```bash
   bun install
   ```

3. **Build Demo & Verifier**:
   ```bash
   bun run build
   ```

## Generated Artifacts

### Resident Record (Juminhyo)
- `examples/juminhyo/juminhyo.html` -> User Viewer (Signed Original)
- `examples/juminhyo/juminhyo.cose` -> Signed Data (COSE file)

### Electronic Power of Attorney (Ininjo)
- `examples/ininjo/ininjo.html` -> User Viewer (Nested Data Structure)

*(Append `?debug=1` to the URL to enable debug mode and inspect internal data structures)*

### Verifier
- `examples/verifier.html` -> General-purpose verification tool for businesses.

## CLI Tools

Command-line tools are provided for developers and CI/CD environments.

### Presentation (Issue & Present)

```bash
# 1. Issue Credential (Generate & Embed Device Key)
bun run examples/juminhyo/gen-tobari.ts

# 2. Create Presentation (Selective Disclosure & Holder Binding)
bun run present:cli examples/juminhyo/juminhyo.cose output_vp.cose \
  --fields="世帯主氏名,交付年月日" \
  --nonce=12345 --audience=verifier.id --response-uri=https://verifier.id/cb
```

### Verification

```bash
# Decode Original Data & Verify Signature
bun run verify:cli output_vp.cose pubkey.json
```

## Library Usage (TypeScript)

Use the `@tobari/codec` API to embed verification logic into your own applications.

```typescript
import { verifyTobari } from '@tobari/codec';

// Verify .cose binary
const result = await verifyTobari(binaryData, issuerPublicKey);

if (result.isValid) {
  console.log("Verified payload:", result.payload);
}
```

---
Produced by the Tobari Project.