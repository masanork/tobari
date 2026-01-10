# Implementation & Specification Status

This document summarizes the current status of research and implementation for various digital identity schemes within the `civ` package.

## 1. Supported / Documented Schemes

| Region | Scheme | Spec Document | Implementation Status | Notes |
|---|---|---|---|---|
| **International** | **ICAO 9303** | `docs/icao9303.md` | **Partial** | ePassport, UNLP, EU eID. Support for BAC/PACE. |
| **USA** | **PIV** | `docs/piv.md` | **Partial** | NIST SP 800-73-5. Support for Auth/Sign/Certs. |
| **Japan** | **JPKI** | `docs/jpki.md` | **Implemented** | My Number Card (Auth/Sign). |
| **Japan** | **JPDL** | `docs/jpdl.md` | **Implemented** | Driving License (PIN1/PIN2). |
| **Japan** | **JPRC** | `docs/jprc.md` | **Implemented** | Residence Card. |
| **Estonia** | **EstEID** | `docs/esteid.md` | Documented | Unique AID, file-based records, PIN1/PIN2. |
| **Germany** | **PQC PoC** | `docs/german_pqc_poc.md`| Documented | Hybrid PQC (Kyber/Dilithium) extensions. |
| **Thailand** | **Thai ID** | `docs/thai.md` | **Implemented** | Proprietary AID, fixed-offset reading. |
| **Malaysia** | **MyKad** | `docs/mykad.md` | **Implemented** | Proprietary AID (JPN), length-based reading. |

## 2. Research Findings for Other Schemes

### 2.1 International Organizations
- **UN Laissez-Passer (UNLP):** Fully compliant with **ICAO 9303**. Covered by `PassportController`.
- **NATO:** Likely based on PIV (FIPS 201) or similar ISO 7816 smart cards. No public proprietary spec found; PIV driver may work.

### 2.2 East Asia
- **China (Resident Identity Card):** Uses ISO 14443 Type B but is **NOT ICAO 9303 compliant**. Requires a proprietary Secure Access Module (SAM) for data decryption. Public implementation is not feasible.
- **Hong Kong (Smart ID):** Newest generation (2018+) supports RFID. While the ePassport app is ICAO compliant, the HKID-specific applet remains proprietary with limited public documentation.
- **South Korea:** IC-based ID cards exist, but detailed APDU specifications are not widely published in English/International standards.

### 2.3 Others
- **Indonesia (e-KTP):** Biometric-focused, APDU specifications are restricted and not publicly documented.
- **India (Aadhaar):** Smart cards were based on SCOSTA specs, but the ecosystem has shifted heavily towards QR/Online-API (UIDAI) rather than offline chip reading.

## 3. Future Expansion Plan
- [ ] Enhance `PassportController` to support EAC (Extended Access Control) for sensitive DGs.
- [ ] Add PACE (ECDH) support for EU eIDs and newer Passports.
