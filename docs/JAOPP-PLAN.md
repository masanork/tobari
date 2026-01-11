# Strategic Proposal for Next-Generation KYC Protocol for Unhosted Wallets

## 1. Introduction: Regulation and Self-Sovereign Identity

In the crypto-asset ecosystem, the eyes of regulators and the privacy-preserving philosophy of decentralized technology have long been viewed as being in conflict. The FATF's 2019 decision to extend "Travel Rule" requirements to Virtual Asset Service Providers (VASPs) significantly impacted the industry. Furthermore, advanced regulators like FINMA (Switzerland) have required technical proof that the customer owns the self-hosted wallet involved in transactions.

## 2. Analysis of the Swiss AOPP (Address Ownership Proof Protocol)

AOPP is a protocol that allows users to sign a message using their wallet's private key to prove ownership. While effective for verifying address ownership, it has limitations:
- **Identity Gap**: It proves ownership of an address but does not link it to a verified real-world identity.
- **Privacy Concerns**: Direct linking can lead to unnecessary data exposure.

## 3. The SCAC Strategy (Tobari/JAOPP Approach)

We propose using **ISO 18013-5 (mDoc)** based credentials to bridge this gap.
- **Verified Linkage**: Linking a verified identity (from JPKI/My Number Card) to a wallet address within a secure credential.
- **Selective Disclosure**: Allowing users to prove "I am a KYCed individual who owns this address" without revealing their full identity to the VASP.
- **Machine Readability**: Using Tobari's schema-driven forms to handle complex regulatory requirements autonomously.

## 4. Roadmap

1. **Proof of Concept**: Implementation of the SCAC credential using `civ` and Tobari processor.
2. **Standardization**: Aligning with ISO/IEC 18013-5 and 18013-7 (OpenID4VP).
3. **Ecosystem Integration**: Partnering with local VASPs to test the verification flow.
4. **Future-Proofing**: Implementing Post-Quantum Cryptography (ML-DSA) hybrid signatures to ensure long-term security of holder binding.
