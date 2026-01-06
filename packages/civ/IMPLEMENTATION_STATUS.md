# CIV (Citizen Identity Verification) Implementation Status Report

**Date:** 2026-01-01
**Status:** Alpha (Functions Implemented, some crypto logic mocked)

## 1. Overview
This library (`civ`) aims to provide a unified interface for accessing Japanese public identification cards:
1.  **JPKI** (My Number Card)
2.  **Driver's License** (DL)
3.  **ePassport** (EP)
4.  **Residence Card** (RC)

## 2. Implementation Status by Component

### 2.1. JPKI (My Number Card)
*   ✅ **AP Selection**: Implemented (JPKI AP).
*   ✅ **PIN Verification**: Implemented (User Auth PIN).
*   ❌ **Sign**: Broken/Unfinished (Compute Digital Signature functionality is not working).
*   ✅ **Read Cert**: Implemented (Read User Auth Cert).
*   ✅ **My Number / Attributes**: Implemented (via "Input Support AP").
*   ⚠️ **Secure Messaging**: Not required for basic JPKI (Basic 4 info uses PIN only).
*   **Remaining**: Signing with "Digital Signature" key (requires 6-16 digit PIN handling).

### 2.2. Driver's License (DL)
*   ✅ **AP Selection**: Implemented.
*   ✅ **PIN Verification**: Implemented (PIN1, PIN2).
*   ✅ **Read Common Data (EF01)**: Implemented.
*   ✅ **Parsing**: Implemented (Shift-JIS TLV parser).
*   ⚠️ **Read Sensitive Data (EF02)**: Implemented but parser not fully detailed.
*   **Remaining**: External character mapping (Gaiji) handling if needed.

### 2.3. ePassport (EP)
*   ✅ **AP Selection**: Implemented.
*   ✅ **BAC Key Derivation**: Implemented (SHA-1 from MRZ).
*   ✅ **Secure Messaging (SM)**: Implemented for BAC (3DES).
    *   ISO 7816-4 Secure Messaging wrapper: DO87/DO97/DO8E/DO99, MAC
        validation, encrypted APDUs, and response decryption.
    *   AES-based SM for PACE remains pending.
*   **Remaining**: PACE (Password Authenticated Connection Establishment) support
    for newer passports (replacing BAC). Active Authentication (AA) / Chip
    Authentication (CA).

### 2.4. Residence Card (RC)
*   ✅ **AP Selection**: Implemented.
*   ✅ **Access Control**: Implemented (Card Number verification).
*   ✅ **Read Info**: Implemented.
*   ✅ **Parsing**: Implemented (TLV Parser, encoding TBD).
*   **Remaining**: Verify specific encoding (UTF-8 vs Shift-JIS) on real cards.

### 2.5. US PIV (Personal Identity Verification)
*   ✅ **AP Selection**: Implemented.
*   ✅ **CHUID Read**: Implemented (GET DATA).
*   ✅ **Parsing**: Implemented (Expiry Date extraction).
*   ✅ **Read Cert**: Implemented (Authentication Key 9A, Sign Key 9C, etc.).
*   ✅ **PIN Verification**: Implemented (Verify 0x80).
*   ✅ **General Authenticate**: Implemented (Sign/Internal Auth).
*   ✅ **Key Management**: Implemented (KeyReference & Algorithm enums).

### 2.6. European Identity Card (EuId)
*   ✅ **AP Selection**: Implemented (Reuse ICAO AID).
*   ✅ **Access Control**: Implemented (BAC supported, PACE pending).
*   ✅ **Read MRZ**: Implemented (DG1).
*   ✅ **Read Photo**: Implemented (DG2).
*   ✅ **Read Details**: Implemented (DG11 - Address, etc.).
*   **Note**: Wraps ICAO ePassport logic as most EU IDs are compliant MRTDs.

## 3. Security Hardening & Next Steps

### 3.1. Secure Messaging (Priority: High)
*   **Target**: Passport (BAC/PACE) & potentially Residence Card.
*   **Task**: Implement the `SecureChannel` trait.
    *   `encrypt_apdu(apdu, session_keys) -> encrypted_apdu`
    *   `decrypt_response(response, session_keys) -> decrypted_data`
*   **Progress**: BAC 3DES Secure Messaging wrapper implemented; AES-based PACE
    remains pending.

### 3.2. Zeroization (Priority: Medium)
*   **Target**: All PINs and Private Keys.
*   **Task**: Ensure `zeroize` crate is applied to all structs holding PINs or session keys to prevent memory dumps.

### 3.3. Error Handling (Priority: Low)
*   **Refinement**: Convert generic `anyhow` errors to specific `CivError` enum (e.g., `PinLocked`, `CardRemoved`, `AuthFailed`).

### 3.4. Testing (Priority: High)
*   **Mocking**: Currently using `mockall`. Need more comprehensive APDU traces for regression testing.
*   **Real Card**: CI integration with physical readers is difficult; need a "Virtual Card" simulator or recorded session replay.
