# CIV (Citizen Identity Verification) Implementation Status Report

**Date:** 2026-01-07
**Status:** Beta-Alpha (Real-world JPKI testing in progress)

## 1. Overview
This library (`civ`) provides a unified interface for accessing identification cards.
Status focus: **JPKI (My Number Card)** real-world hardware verification.

## 2. Implementation Status by Component

### 2.1. JPKI (My Number Card)
*   ✅ **Basic Info (Attributes)**: **Working**. Successfully retrieved Name (with Gaiji), Address, DOB, and Gender using 4-digit PIN.
*   ✅ **My Number**: **Working**. Successfully retrieved 12-digit Individual Number.
*   ✅ **Certificates**: **Working**. Implemented full DER reading for both Auth and Sign certificates.
*   ✅ **Digital Signature**: **Working**. Implemented high-level API for User Auth (4-digit) and Digital Signature (6-16 alphanum).
*   ✅ **Face Photo**: **Working**. 
    *   Successfully retrieved via **Surface-AP** (AID ending in `02`).
    *   Authentication: Uses 12-digit My Number as PIN via EF `00 13`.
    *   Data Extraction: Parsed from EF `00 02` using BER-TLV Tag `DF 27`.
*   ✅ **Retry Counters**: **Working**. Implemented status check for all PIN types (Auth, Sign, Input Support, Surface/MyNumber).

### 2.2. Driver's License (DL)
... (omitted) ...

---

## 3. Findings from Hardware Testing (2026-01-07)

### 3.1. Implementation Verified
Live testing confirmed the specification in `docs/mynacard.md`:
- **Card-AP** (`...04 08`): Access to My Number (EF `00 01`) and 4-Info (EF `00 02`) using 4-digit PIN.
- **Surface-AP** (`...04 02`): Access to Face Photo (EF `00 02`) using 12-digit My Number as PIN.

### 3.2. Data Formats
- My Number EF can be either plain text or wrapped in TLV (implemented robust parser).
- Face Photo is typically JPEG2000 (`FF 4F ...`) encapsulated in a TLV structure with tag `DF 27`.

## 4. Next Steps
1.  **Resolve Face Photo Auth**: Debug the `6981` / `6986` errors in Visual AP using the new "Direct Authentication" logic.
2.  **Gaiji Handling**: Improve the `decode_shift_jis_lossy_gaiji` helper for rare characters in addresses.
3.  **Error Refinement**: Map `63Cx` status words to meaningful retry-limit warnings in the UI.