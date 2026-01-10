# Zero-Knowledge Proof (ZKP) Examples

This directory contains examples and prototypes for using Zero-Knowledge Proofs within the Tobari ecosystem to enhance privacy.

## Directory Structure

### 1. [passport-circuit](./passport-circuit) (Technical Prototype)
**Real implementation of ZK Circuits using Circom.**

*   **Goal**: To prove that a user holds a valid passport (signed by the government) and matches specific attributes (e.g., age, nationality) **without revealing** the passport number or raw personal data.
*   **Tech Stack**: Circom, SnarkJS.
*   **Status**: Circuit definition and input generation logic are implemented.

### 2. [bbs-scenarios](./bbs-scenarios) (Conceptual Demo -> Prototype)
**Scenario-based demonstrations of Unlinkable Credentials.**

*   **Goal**: To demonstrate the concept of "Unlinkability" and "Selective Disclosure" using **BBS 2023** signatures.
*   **Scenarios**:
    *   **Employee Discount**: Proving employment without being tracked across visits.
    *   **Dating App**: Combining multiple credentials (ID, Income) without revealing identity.
*   **Tech Stack**: TypeScript, `@digitalbazaar/bbs-2023-cryptosuite`.
*   **Status**: Working prototype demonstrating full Selective Disclosure flow.

### 3. [scac](./scac) (Application Prototype)
**Self-Hosted Crypto Account Ownership Credential.**

*   **Goal**: To securely bind strict identity verification (e.g., Passport, My Number Card) to anonymous crypto wallets for FATF Travel Rule compliance without exposing personal data on-chain.
*   **Tech Stack**: BIP-32/BIP-39, COSE/CBOR, BBS+ Signatures.
*   **Status**: Prototype for data modeling and credential generation.

## Relationships

The **SCAC** project integrates the concepts from the other components:
*   It uses **ZK Proofs** (like those in `passport-circuit`) to ingest verified identity data without storing raw sensitive identifiers (like MRZ).
*   It uses **BBS+ Signatures** (demonstrated in `bbs-scenarios`) to allow users to present this credential to VASPs selectively (e.g., "I own this wallet and am over 18" without revealing "I am John Doe").
