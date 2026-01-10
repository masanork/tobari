# FATF Unhosted Wallet Regulatory Requirements and SCAC Alignment Analysis

**Date:** 2026-01-10
**Project:** JAOPP (Japan Open Privacy Platform) / Tobari
**Subject:** Self-Hosted Crypto Account Ownership Credential (SCAC)

## 1. Background: FATF Discussion on Unhosted Wallets

The Financial Action Task Force (FATF) clarified risks and countermeasures regarding transactions with **unhosted wallets (self-hosted wallets)** in its October 2021 update to the "Guidance for a Risk-Based Approach to Virtual Assets and Virtual Asset Service Providers (VASPs)."

### 1.1 Key Requirements and Challenges

When a VASP transacts with an unhosted wallet (sending or receiving funds), the following actions are increasingly expected (extensions of the Travel Rule):
- **Verification of Identity**: Identifying the counterparty owner of the unhosted wallet.
- **Risk Assessment**: Evaluating the risk profile of the wallet and the transaction.

The primary challenge is how to achieve this without forcing users to disclose their full private data to every VASP, which creates massive honey-pots of sensitive identity data.

## 2. The SCAC Solution

The **Self-hosted Crypto Account Ownership Credential (SCAC)** provided by JAOPP/Tobari addresses these requirements using a privacy-preserving architecture based on **ISO 18013-5 (mDoc)**.

### 2.1 Identity Linkage via Hardware (JPKI)
SCAC is issued only after the holder verifies their identity using high-assurance hardware credentials like the Japanese My Number Card (JPKI). This ensures that the wallet address is cryptographically bound to a verified real-world identity.

### 2.2 Selective Disclosure (SD-CBOR)
Instead of sharing a full KYC profile, the user can present a "Verifiable Presentation" containing only the necessary proof:
- **Proof of Ownership**: Signature from the device bound to the wallet.
- **Assurance Level**: Proof that the identity was verified at a "High" level without revealing the name or address unless necessary.

### 2.3 Mitigation of "Honey-pot" Risks
Since SCAC supports selective disclosure, VASPs only store the minimum amount of data required by law, significantly reducing the impact of potential data breaches at the VASP level.

## 3. Compliance Mapping

| FATF Requirement | SCAC Countermeasure |
|------------------|---------------------|
| Identification of Counterparty | Cryptographic link between verified identity and wallet address. |
| Verification of Data | Issuer signature (Government or trusted third-party). |
| Travel Rule Compliance | Machine-readable credentials that can be integrated into automated Travel Rule messaging protocols. |
| Risk-based Approach | Ability to provide more or less data depending on the risk tier of the transaction. |

## 4. Conclusion

SCAC provides a technically robust framework that satisfies FATF's regulatory goals while upholding the privacy principles essential to the decentralized finance (DeFi) ecosystem.