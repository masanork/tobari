# PQC Issuer Countersign PoC Spec

## Goal
Add PQC issuer signatures to Tobari while preserving backward compatibility for existing COSE_Sign1 verifiers. This PoC targets standard-aligned structures so it can evolve toward international standardization.

## Scope
- Issuer signature only (Device binding remains classical for now).
- Default issuer signature: ECDSA P-384 (COSE alg -35).
- PQC countersign: ML-DSA-65 (experimental, optional).
- Backward compatibility: legacy verifiers must ignore PQC data and still validate ECDSA.

## Representation
**Primary structure**: COSE_Sign1 (unchanged)
- ECDSA P-384 signature stays as the main COSE_Sign1 signature.

**PQC attachment**: COSE Countersign (standard-aligned)
- Add a countersignature using ML-DSA-65.
- This is attached to the issuer signature as an extension.

## Verification Rules
- If PQC countersign is present, verify it; report PQC status separately.
- If PQC countersign is missing or unverifiable, ECDSA validation still determines overall validity.
- PQC validation does not override ECDSA failure.

## Minimal Data Model (conceptual)
- IssuerAuth: COSE_Sign1 (ECDSA P-384)
- IssuerAuth.countersign: COSE_Countersign (ML-DSA-65)

## Measurements
Record the following on one sample doc (e.g., juminhyo):
- IssuerAuth size (ECDSA only)
- IssuerAuth size with Countersign (ECDSA + ML-DSA-65)
- Total VP size change
- Signing time (ECDSA vs hybrid)
- Verification time (ECDSA vs hybrid)

## Open Decisions (PoC defaults)
- ML-DSA-65 for PQC baseline
- Countersign as the PQC carrier
- PQC optional for compatibility

## Out of Scope
- Device binding PQC (deferred until PQC-capable FIDO devices exist)
- PQC encryption for VP payloads

## Implementation Tasks
1) **PQC signing backend**
   - Add ML-DSA-65 signing/verify implementation (Rust/WASM).
   - COSE alg ID for ML-DSA-65: `-49` (draft-ietf-cose-mldsa-00).
   - Cryptosuite label: `ml-dsa-65-jcs-2025` (mirrors `ml-dsa-44-jcs-2025` naming).

2) **COSE countersign integration**
   - Extend `packages/crypto/src/cose.ts` to support non-WebCrypto algs in `signWithKey`.
   - Attach PQC countersign in `signCoseSign1` when `countersignSetup.alg` is ML-DSA-65.

3) **IssuerAuth generation**
   - In `packages/codec/src/tobari-gen.ts`, wire PQC countersign setup for issuer (flag/option).

4) **Verification**
   - In `packages/codec/src/validator.ts`, detect Countersignature0 and verify ML-DSA-65 when present.
   - Report PQC result separately (do not fail overall if PQC is missing).

5) **MCP output**
   - In `packages/mcp-server/src/tools/tobari.ts` and `verify_presentation`, add PQC status fields to response.

## Open Items
- Confirm COSE alg ID mapping for ML-DSA-65 (draft assignment to be pinned if registry changes).
- Library choice: `pqcrypto` (Rust) vs `liboqs` vs other WASM-friendly PQC.
