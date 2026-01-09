# Unlinkable Credentials with ZKP (BBS+ Signatures)

## Concept

Standard digital credentials (like simple JWS or CWT) often present a static signature from the Issuer to the Verifier. This static signature acts as a "super-cookie" that allows verifiers to correlate multiple presentations of the same credential, even if the user selectively discloses different attributes.

To achieve **Unlinkability**, we need a scheme where:
1.  **Selective Disclosure**: The user can reveal only a subset of attributes.
2.  **Zero-Knowledge Proof of Signature**: The user proves they possess a valid signature from the Issuer on the attributes, **without revealing the signature itself**.
3.  **Randomization**: Every proof is randomized, so two proofs of the same credential look completely different (bit-wise).


## Concrete Scenarios

### 1. Privacy-Preserving Lunch Discount (`scenario-employee-discount.ts`)
*   **Context**: A cafe offers a discount to employees of "Myna Trust Corp".
*   **Problem**: If an employee shows their ID card or a standard digital certificate, the cafe can track their visits ("Taro came on Mon, Tue, Fri").
*   **Solution**: Using ZKP (BBS+), the employee proves "My Employer is Myna Trust" **without** revealing their name or ID.
*   **Result**: The cafe verifies eligibility but sees a completely different, random proof string each time. They cannot link the visits to the same person.


### 2. Anonymous High-Spec Dating (`scenario-dating-app.ts`)
*   **Context**: A dating app requires users to be Adults (18+), High Income (>6M), and Single.
*   **Problem**: Users do not want to upload sensitive documents (Tax forms, Koseki) to a dating app DB.
*   **Solution**: Multi-Credential ZKP. The user combines:
    1.  Identity Card (Age)
    2.  Tax Certificate (Income)
    3.  Koseki (Marital Status)
*   **Key Feature**: **Link Secrets**. The proof mathematically guarantees that all 3 credentials belong to the *same* user, preventing someone from borrowing a friend's high-income cert.
*   **Result**: The app verifies the user meets the "High Spec" criteria without ever knowing who they are.

## Sample Workflow (Generic)

1.  **Issuance**:
    *   Issuer creates a BBS+ Signature on a message vector: `[Name, Age, Citizenship, MembershipID, SecretFactor]`.
    *   Issuer sends the Signature to the Holder.

2.  **Presentation (Context A: Bar)**:
    *   Holder wants to prove `Age > 20`.
    *   Holder generates a ZK Proof:
        *   Reveals: `Age` (or predicate).
        *   Hides: `Name`, `Citizenship`, `MembershipID`, `SecretFactor`.
        *   Proves: "I possess a valid signature on a set of attributes including this Age."
    *   Verifier checks the proof. They learn "Someone over 20 with a valid ID", but not WHO.

3.  **Presentation (Context B: Voting)**:
    *   Holder wants to prove "Citizenship = JP" and "MembershipID is unique (for nullifier)".
    *   Holder generates a new ZK Proof.
    *   Verifier learns "Someone with JP Citizenship".
    *   **Crucially**: Context B cannot link this user to Context A.

## Implementation Plan

We will simulate this flow using a BBS+ library (or a mock if dependencies are constrained).
The goal is to generate two distinct proofs from the same credential that verify against the same Issuer Public Key.
