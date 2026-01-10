# Tobari Long-Term Validation (LTV) Strategy

## Overview

Tobari (based on ISO 18013-5 mdoc and COSE) currently provides data integrity and authenticity verification using EdDSA/ECDSA signatures. However, for documents with long-term legal validity (e.g., University Degrees, Real Estate Digital Deeds, Electronic Power of Attorney), standard signatures are insufficient due to:
1.  **Certificate Expiration**: Signatures cannot be verified once the issuer's certificate expires.
2.  **Algorithm Obsolescence**: Cryptographic algorithms (e.g., P-256) may become vulnerable over decades.
3.  **Key Compromise**: If an issuer's key is compromised later, valid past signatures might be deemed invalid without trusted timestamps.

This document outlines the challenges and proposed architecture for implementing **Long-Term Validation (LTV)** in Tobari.

## Technical Challenges

### 1. Embedding Timestamps in COSE
Unlike CAdES (CMS) or PAdES (PDF), COSE does not have a widely adopted, rigid standard for embedding RFC 3161 timestamps *inside* the signature structure for LTV.

- **Status**: ISO 18013-5 does not specify mechanisms for LTV.
- **Proposed Solution**: Use **RFC 9338 (COSE Countersignatures)** or custom header parameters in the `unprotected` bucket of `COSE_Sign1`.
  - **Attribute**: `timestamp` (custom label TBD, e.g., defined in private range) containing the DER-encoded Time-Stamp Token (TST).

### 2. Compatibility with Selective Disclosure
This is the most critical architectural challenge.

- **Problem**: In traditional LTV, the timestamp is applied to the *entire document*. In Tobari, the Holder discloses only a subset of data (Selective Disclosure) to the Verifier.
- **Analysis**:
  - The `issuerAuth` (COSE_Sign1) signature covers the **Mobile Security Object (MSO)**, not the raw personal data.
  - The MSO contains *hashes* of the data items (`digest`), not the values themselves.
  - **Conclusion**: Since the MSO is disclosed *intact* even during Selective Disclosure (to verify hashes), **timestamping the MSO signature fits perfectly.**
  - **Verification Flow**:
    1. Verifier checks `issuerAuth` signature (integrity of MSO).
    2. Verifier checks TST embedded in `issuerAuth` header (proof of existence at time T).
    3. Verifier calculates hashes of disclosed data items and matches them against MSO.
    4. **Result**: The timestamp proves the MSO existed at time T, and the MSO proves the individual data items existed at time T.

### 3. File Size & complexity
Full LTV (like PAdES-L-TV) requires embedding:
- The Time-Stamp Token (TST).
- The Issuer's Certificate Chain.
- Revocation Info (CRLs or OCSP Responses) captured at signing time.

- **Impact**: This can add 10KB-50KB to the credential.
- **Mitigation**: Tobari favors "Lightweight" credentials.
  - **Profile A (Full Embedded)**: Good for offline, standalone verification (e.g., archived contracts).
  - **Profile B (Reference)**: Embed only the TST. Rely on online repositories or verifiable logs for cert chains and revocation history.

## Proposed Architecture

### Structure Update (COSE_Sign1)

We propose extending the `issuerAuth` structure in the MSO:

```cbor
COSE_Sign1 = [
  protected: bstr,
  unprotected: {
    ...
    // PROPOSED: RFC 3161 Time-Stamp Token
    111 (TBD): bstr(TST), 
    
    // PROPOSED: Archival Attributes (optional)
    112 (TBD): [ CertChain, CRLs/OCSP ]
  },
  payload: bstr(MSO),
  signature: bstr
]
```

### Verification Logic Updates
The Subscriber (Viewer/Verifier) needs updated logic:

1.  **Extract TST**: Parse `unprotected` header to find the timestamp.
2.  **Verify TST**: Verify the TST signature against a Trusted Time Stamping Authority (TSA).
3.  **Key Validity Check**: Ensure the Issuer's key was valid *at the time indicated by the TST*, even if it is currently expired or revoked.

## Roadmap Suggestion

1.  **Phase 1 (Proof of Concept)**:
    - Implement fetching a dummy/free RFC 3161 TST during `tobari-gen`.
    - Embed TST into `issuerAuth` unprotected header.
    - Update `viewer-client.ts` to display "Timestamped at: <Time>" if present.

2.  **Phase 2 (Standardization)**:
    - Align with upcoming COSE / ISO 18013 extensions regarding LTV.
    - Define specific header labels to avoid collision.

3.  **Phase 3 (Evidence Records)**:
    - For multi-decade preservation, research **ERS (Evidence Record Syntax)** to allow "re-stamping" the archive without breaking the original Tobari file structure (Detached LTV).

## References
- RFC 9052: COSE
- RFC 3161: Time-Stamp Protocol (PKIX)
- RFC 4998: Evidence Record Syntax (ERS)
- ISO/IEC 18013-5: mdoc
