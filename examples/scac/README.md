# SCAC: Self-Hosted Crypto Account Ownership Credential

SCAC is a privacy-preserving credential that binds a verified legal identity to one or more self-hosted crypto wallet addresses. It is designed to satisfy FATF (Financial Action Task Force) requirements for VASP-to-Unhosted-Wallet transactions without sacrificing user privacy.

## Features

- **Multi-Chain Binding**: Prove ownership of multiple addresses (Ethereum, Solana, etc.) in a single credential.
- **Root of Trust**: Verified against government-issued identity documents (Passport/ICAO 9303, My Number Card/JPKI) using NFC chip verification.
- **Privacy First (ZKP)**: Uses Zero-Knowledge Proofs to prove the authenticity of the ID document without revealing sensitive identifiers like Passport Numbers or full MRZ strings on-chain.
- **mDoc Compatible**: Built on ISO 18013-5 (Mobile Driving License) standards for interoperability.

## Why SCAC? (FATF Compliance)

According to the FATF Guidance (2021), VASPs interacting with unhosted wallets need to:
1.  **Identify** the owner.
2.  **Verify** the identity using reliable sources.
3.  **Confirm Control** of the wallet address.

SCAC automates all three steps using cryptography, providing a "Trust Score" and verified attributes that VASPs can process instantly.

## How to Run

### 1. Install Dependencies

```bash
bun install
```

### 2. Generate SCAC

This script simulates the issuance process:
- Loads identity data from `scac-data.yaml`.
- Verifies a dummy ZK Proof.
- Signs the data using an Issuer key.
- Generates a COSE file (mDoc) and an HTML viewer.

```bash
bun run gen-scac.ts
```

### 3. View the Result

Open `scac.html` in your browser to see the verified credential view.

## Integration with ZKP Circuits

The `identity_proof` field in `scac-data.yaml` is intended to be the output of the [Passport ZK Circuit](../zkp/passport-circuit). By providing a proof that the MRZ is valid and matches the user's claims, we avoid storing the raw MRZ bits in the credential or on the blockchain.

See [FATF Analysis](../../docs/FATF_ANALYSIS.md) for a deep dive into the regulatory context.