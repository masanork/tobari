# Zero-Knowledge Proof (ZKP) Examples

This directory contains examples and prototypes for using Zero-Knowledge Proofs within the Tobari ecosystem to enhance privacy.

## Directory Structure

### 1. [passport-circuit](./passport-circuit) (Technical Prototype)
**Real implementation of ZK Circuits using Circom.**

*   **Goal**: To prove that a user holds a valid passport (signed by the government) and matches specific attributes (e.g., age, nationality) **without revealing** the passport number or raw personal data.
*   **Tech Stack**: Circom, SnarkJS.
*   **Status**: Circuit definition and input generation logic are implemented.

### 2. [bbs-scenarios](./bbs-scenarios) (conceptual Demo -> Prototype)
**Scenario-based demonstrations of Unlinkable Credentials.**

*   **Goal**: To demonstrate the concept of "Unlinkability" and "Selective Disclosure" using **BBS 2023** signatures.
*   **Scenarios**:
    *   **Employee Discount**: Proving employment without being tracked across visits.
    *   **Dating App**: Combining multiple credentials (ID, Income) without revealing identity.
*   **Tech Stack**: TypeScript, `@digitalbazaar/bbs-2023-cryptosuite`.
*   **Status**: Working prototype demonstrating full Selective Disclosure flow.

## How they relate to SCAC

The **Self-Hosted Crypto Account Ownership Credential (SCAC)** (found in `../scac`) utilizes the concepts demonstrated here.
Specifically, SCAC uses a ZK Proof (like the one in `passport-circuit`) to bind an anonymous crypto account to a verified identity, ensuring regulatory compliance (KYC) while preserving user privacy (No passport number on-chain).
