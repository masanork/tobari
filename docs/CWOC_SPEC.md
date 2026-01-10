# JAOPP Self-hosted Crypto Account Ownership Credential (SCAC) Spec

**Version:** 0.5.0 (Draft)
**Target:** Prototype for JAOPP (Japan Open Privacy Platform)
**Standard:** ISO/IEC 18013-5 (mDoc)

## 1. Introduction

This specification defines the "Self-hosted Crypto Account Ownership Credential" (SCAC) used within the JAOPP ecosystem. SCAC allows a user to prove they own a specific cryptocurrency wallet address (Un-hosted Wallet) while maintaining a link to their verified identity, without necessarily revealing their real name to the public blockchain.

## 2. Data Structure (mDoc namespaces)

Based on ISO 18013-5, the SCAC uses the `org.jaopp.scac` namespace.

### Namespace: `org.jaopp.scac`

| Element Identifier | Type | Description |
|--------------------|------|-------------|
| `wallet_address`   | tstr | Public key or address of the crypto wallet. |
| `blockchain`       | tstr | Name of the network (e.g., "Ethereum", "Polygon"). |
| `verified_at`      | tfmt | Date and time the ownership was verified. |
| `assurance_level`  | tstr | Level of identity verification (e.g., "high" if tied to JPKI). |

## 3. Holder Binding

SCAC MUST use Holder Binding. The `DeviceSigned` structure from ISO 18013-5 ensures that the credential cannot be used without the private key stored in the holder's device HSM.

## 4. Verification Flow

1. **Issuer**: Verifies user's identity (via JPKI) and wallet ownership (via signature).
2. **Issuance**: Issuer signs the SCAC and sends it to the user's wallet.
3. **Presentation**: User selects specific fields (e.g., wallet_address and assurance_level) to share with a VASP or Verifier.
4. **Verifier**: Validates the Issuer's signature and the Device Binding.
