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
*   ❌ **Face Photo**: **Not Working (Blocked)**. 
    *   Direct read from Input Support AP failed (not present in standard FIDs `0001-0006`).
    *   Accessing "Visual AP" (Face Recognition AP) via Password A/B is currently failing.
    *   Encountered `6A82` (File not found) and `6981` when attempting to select PIN files.
    *   Hardware tests suggest a "Direct Authentication" model is required (no `SELECT EF` before `VERIFY`).
*   ✅ **Retry Counters**: **Working**. Implemented status check for all 5 PIN types (Auth, Sign, Input Support, Password A, Password B).

### 2.2. Driver's License (DL)
*   ✅ **PIN Verification**: Working (PIN1, PIN2).
*   ✅ **Read Common Data**: Working (Shift-JIS parser included).

### 2.3. ePassport (EP)
*   ✅ **BAC/SM**: Implemented (3DES). PACE remains pending.

### 2.4. Residence Card (RC)
*   ✅ **Access Control**: Working (Card Number verification).

---

## 3. Findings from Hardware Testing (2026-01-07)

### 3.1. File ID Discrepancy
Live testing revealed that documentation (J-LIS guidelines) may vary between card batches.
Confirmed Working FIDs for most cards:
- `00 01`: My Number
- `00 02`: Basic 4 Attributes
- `00 03`: (Likely) Signature Image
- `00 04`: (Likely) Face Photo

### 3.2. Visual AP Authentication
Authentication to the Face Recognition AP (`D3 92 10 00 31 00 01 01 04 01`) requires:
- **Password A**: 12-digit My Number (Reference `0x81`).
- **Password B**: 14-digit sequence: `DOB(YYMMDD)` + `ExpYear(YYYY)` + `SecurityCode(4-digits)` (Reference `0x82`).
- **Protocol**: Some cards reject `SELECT EF 0011` and expect `VERIFY` immediately after AP selection.

## 4. Next Steps
1.  **Resolve Face Photo Auth**: Debug the `6981` / `6986` errors in Visual AP using the new "Direct Authentication" logic.
2.  **Gaiji Handling**: Improve the `decode_shift_jis_lossy_gaiji` helper for rare characters in addresses.
3.  **Error Refinement**: Map `63Cx` status words to meaningful retry-limit warnings in the UI.