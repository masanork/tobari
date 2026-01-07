# Global Digital Identity Schemes: Technical & Historical Analysis

**Date:** 2026-01-08
**Author:** Civ Implementation Team

## 1. Introduction
This report analyzes the technical specifications and historical evolution of major digital identity schemes globally. The goal is to provide architectural guidance for the `civ` package, ensuring it supports current standards and future cryptographic transitions.

## 2. Classification of Identity Schemes

We categorize national ID cards into three primary groups based on their technical architecture.

### 2.1. ICAO 9303 Compliant (ePassports & Derived IDs)
**Scope:** Worldwide Passports, **UN Laissez-Passer**, **EU National ID Cards** (since 2019), Hong Kong (ePassport app).
- **Structure:** Logical Data Structure (LDS) with Data Groups (DG1-DG16).
- **Access Control:**
  - **BAC (Basic Access Control):** Legacy, uses 3DES/SHA-1 derived from MRZ.
  - **PACE (Password Authenticated Connection Establishment):** Modern standard, uses ECC/AES with MRZ/CAN/PIN. Mandatory for EU eIDs.
- **Interoperability:** High. Standardized APDUs (`SELECT`, `READ BINARY` with SM).

### 2.2. ISO 7816 File-System Based (PKI Smart Cards)
**Scope:** **Japan (JPKI/JPDL)**, **USA (PIV)**, **Estonia (EstEID)**.
- **Structure:** Hierarchy of Dedicated Files (DF) and Elementary Files (EF).
- **Access Control:**
  - **PIN:** Primary method (e.g., JPKI 4-digit PIN, PIV PIN).
  - **Certificates:** X.509 certificates stored in EFs for offline validation.
- **Interoperability:** Moderate. Conforms to ISO 7816-4 but AID and File IDs are country-specific.

### 2.3. Proprietary / Legacy Architectures
**Scope:** **Thailand (National ID)**, **Malaysia (MyKad)**, **China (Resident ID)**.
- **Structure:** Often flat memory models or proprietary applets.
- **Access Control:**
  - **Proprietary Commands:** e.g., Thai ID uses fixed offsets; MyKad uses `SET LENGTH`.
  - **Closed Systems:** China requires a proprietary SAM (Secure Access Module) to decrypt data.
- **Interoperability:** Low. Requires reverse-engineered or vendor-specific drivers.

---

## 3. Historical Evolution of Cryptography

The transition of cryptographic standards in ID cards reflects the global race against increasing computing power and cryptanalysis.

### Phase 1: RSA 1024 / TDES (2000s - Early 2010s)
*   **Standards:** RSA 1024-bit for signatures, 3DES for encryption. SHA-1 for hashing.
*   **Estonia (EstEID):** First generation (2002-2011) used RSA 1024.
*   **Malaysia (MyKad):** Introduced in 2001, updated to 64kb PKI in 2002.
*   **ICAO:** BAC (Basic Access Control) established using 3DES.
*   **Status:** **Deprecated / Insecure.**

### Phase 2: RSA 2048 / SHA-256 (2010s - Present)
*   **Standards:** RSA 2048-bit becomes the baseline. SHA-256 replaces SHA-1.
*   **Japan (JPKI):** Current specification uses RSA 2048 for User Auth and Signatures.
*   **Estonia (EstEID):** Migrated to RSA 2048 in 2011. (Note: 2014-2017 Infineon chips suffered ROCA vulnerability).
*   **USA (PIV):** Mandated RSA 2048 (or higher).
*   **Status:** **Current Standard**, but facing deprecation by 2030 (NIST).

### Phase 3: ECC / AES (Late 2010s - Present)
*   **Standards:** Elliptic Curve Cryptography (P-256, P-384, Brainpool). AES-128/256 for encryption.
*   **Estonia (EstEID):** Transitioned to **ECC P-384** in 2018 (post-ROCA).
*   **ICAO:** **PACE** protocol uses ECC (ECDH) for strong session keys. Mandatory for EU eIDs from 2021.
*   **USA (PIV):** Prefers ECC P-256/P-384 for new authentication keys.
*   **Status:** **Recommended** for performance and security.

### Phase 4: Post-Quantum Cryptography (Future)
*   **Standards:** Lattice-based cryptography (Kyber/ML-KEM, Dilithium/ML-DSA).
*   **Germany:** Conducting **PQC PoC** for eID cards (2024+).
*   **USA:** NIST roadmap mandates deprecation of classical RSA/ECC by **2035**.
*   **Challenge:** Large key sizes require Extended Length APDUs and faster hardware interfaces (VHBR).

---

## 5. Comparative Analysis of Cryptographic Transitions

Comparing the migration timelines reveals significant regional disparities.

| Algorithm Transition | Estonia (EstEID) | USA (PIV) | EU (eID/Passport) | Japan (JPKI) | Lag (Japan vs Leaders) |
|---|---|---|---|---|---|
| **RSA 1024 → 2048** | 2011 | 2013 (FIPS 201-2) | ~2010-2012 | 2016 (My Number Card) | **3-5 Years** |
| **RSA → ECC** | 2018 (Gen 3) | 2013 (Option) | 2021 (Mandatory) | ~2026 (Planned) | **5-8 Years** |
| **PQC (Post-Quantum)**| Watching | 2035 (Target) | 2024 (German Pilot) | TBD | **Unknown** |

### 5.1. The "Japan Lag" Hypothesis
There is a concern that Japan is "10 years behind." The data suggests a **5-8 year lag** in adopting the latest cryptographic primitives (ECC), rather than a full decade.
- **Factor 1: Conservative Lifecycle:** JPKI adheres strictly to ISO 7816 with RSA 2048, favoring stability over agility.
- **Factor 2: Mobile Integration:** While Estonia and the US moved to ECC to support mobile/contactless performance, Japan's "Smartphone JPKI" (2023) currently emulates the existing RSA 2048 card structure.

**Official Roadmap: The 2030 Critical Sunset**
According to the **Digital Priority Plan 2024** (released June 2024), Japan is officially aligning its cryptographic migration with the lifecycle of cards issued during the 2020 mass-issuance campaign:
- **2026:** Introduction of the **Next-Gen My Number Card** (supporting ECC P-256/384).
- **2029-2030:** **Mass Expiration Era.** Millions of cards issued in 2020 reach their 10-year limit. The government aims to replace these directly with Next-Gen ECC cards rather than renewing RSA certificates.
- **Jan 1, 2031:** **The Hard Deadline.** Current RSA 2048 algorithms are scheduled to be disallowed for JPKI usage.

**Conclusion:** Japan is executing a "Just-in-Time" migration. While the 5-8 year lag behind Europe is now a matter of public record, the strategy is to leverage the 2030 mass-expiration event to force a nationwide jump to ECC. The margin for error is extremely thin; any logistical delay in the 2026 launch will directly impact national security readiness as the 2031 sunset approaches.

## 6. Regional Deep Dive & Recommendations for Civ

### 6.1. Europe (The "PACE" Standard)
Europe is converging on **ICAO 9303 + PACE**.
- **Observation:** The "National ID" and "Passport" technologies are merging.
- **Civ Action:** Prioritize **PACE implementation** in `PassportController`. This single feature unlocks support for almost all modern European ID cards.

### 6.2. Japan (JPKI)
Japan remains on **RSA 2048** (ISO 7816 based).
- **Observation:** Solid, proven, but lagging behind the global ECC trend.
- **Civ Action:** Monitor JPKI spec revisions for ECC adoption. Current `JpkiController` is stable but should prepare for the "Next Gen" card (c. 2026).

### 6.3. Southeast Asia (The "Fragmentation" Zone)
Thailand and Malaysia use distinct, older architectures.
- **Thailand:** Simple structure. High value due to tourism/expat use cases.
- **Malaysia:** Complex (multi-app).
- **Civ Action:** Implement dedicated `ThaiController` (Simple) and `MyKadController`. These cannot share logic with ICAO/JPKI drivers.

### 6.4. USA (PIV)
PIV is a robust standard (FIPS 201).
- **Observation:** Widely used in government/defense.
- **Civ Action:** `PivController` is a high-value addition for enterprise/gov use cases.

## 7. Summary Timeline

| Era | Crypto | Representative Schemes | Civ Support |
|---|---|---|---|
| **2000-2010** | RSA 1024, 3DES, SHA-1 | EstEID (Gen1), MyKad (Gen1), ICAO BAC | Legacy (BAC supported) |
| **2011-2015** | RSA 2048, SHA-256 | EstEID (Gen2), US PIV (RSA), **Juki-Card (Legacy)** | **Good** |
| **2016-2020** | RSA 2048, SHA-256 | **JPKI (Current)**, ICAO PACE (Early) | **Good (JPKI)** |
| **2021-2025** | ECC P-256/384, AES | **EU eID (PACE)**, EstEID (Gen3), US PIV (ECC) | **Needs PACE** |
| **2026+** | PQC (Kyber), Next-Gen ECC | German PQC Pilot, **Next-Gen JPKI** | Future Research |
