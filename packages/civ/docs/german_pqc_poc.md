# German eID PQC PoC (Speculative Specs)

> **Note:** This document is based on public research (Bundesdruckerei, BSI, Infineon) regarding the Post-Quantum Cryptography (PQC) Proof of Concept for the German eID. Official APDU specifications for PQC extensions to BSI TR-03110 are not yet public.

## 1. System Overview
- **Objective:** Migration to Quantum-Safe Cryptography for the German National ID Card (Personalausweis).
- **Approach:** **Hybrid Scheme** (Classical + PQC).
  - Maintains backward compatibility.
  - Mitigates risk if one algorithm is broken.
- **Crypto Algorithms:**
  - **Classical:** ECC (Brainpool curves) as defined in BSI TR-03110.
  - **PQC (KEM):** **Kyber** (ML-KEM) for key encapsulation (PACE/Key Agreement).
  - **PQC (Sign):** **Dilithium** (ML-DSA) or **Falcon** for digital signatures (Document Signer, Terminal Auth).
- **Hardware:** Infineon SECORA™ ID (security controllers with PQC hardware acceleration).

## 2. Application Identifiers (AID)
The PoC likely utilizes the existing eID AID or a specific variant for testing.

| Application | AID (Hex) | Description |
|---|---|---|
| **eID App** | `A0 00 00 02 47 10 01` | Standard ICAO/BSI eID Application |

## 3. Protocol Extensions (Speculative)

### 3.1 Extended Length APDUs
PQC keys and signatures are significantly larger than ECC/RSA.
- **Requirement:** Support for **Extended Length APDUs** (ISO/IEC 7816-4) is mandatory.
- **Data Sizes:**
  - Kyber-768 Public Key: ~1184 bytes
  - Dilithium3 Signature: ~3293 bytes
  - *Contrast:* ECC-256 Public Key is only ~64 bytes.

### 3.2 Hybrid PACE (Password Authenticated Connection Establishment)
The standard PACE protocol (v2) enables secure channel establishment using a weak password (CAN/PIN). The PoC extends this to a Hybrid PACE.

**Hypothetical Flow:**
1.  **Step 1:** Standard PACE (ECC-based) to establish an initial secure channel.
2.  **Step 2:** PQC Key Exchange (Kyber) tunneled through the initial channel.
3.  **Step 3:** Key mixing to derive final Hybrid Session Keys.

**APDU Implications:**
- **MSE: SET KAT** (`00 22 C1 A4`) would support new Algorithm Object Identifiers (OIDs) for PQC.
- **GENERAL AUTHENTICATE** (`00 86 00 00`) would carry larger payloads (Kyber encapsulation/decapsulation blobs).

### 3.3 Extended Terminal Authentication (EACv2)
Used for accessing sensitive data (Fingerprints, eID function). Terminal certificates (CVCA/DV/IS) must contain PQC public keys.

- **Certificates:** Card Verifiable Certificates (CVC) extended to include PQC public keys (OID + Key Data).
- **Challenge-Response:** The card generates a challenge, and the terminal signs it using a PQC Private Key (Dilithium).

## 4. APDU Command Reference (Standard & Expected Extensions)

| Command | INS | P1 | P2 | Data (Input/Output) | Description |
|---|---|---|---|---|---|
| **MSE: SET** | `22` | `C1` | `A4` | `[OID]` (e.g., id-PACE-Kyber) | Set crypto mechanism (Algorithm selection) |
| **GEN AUTH** | `86` | `00` | `00` | `[Hybrid Data / PQC Blob]` | Perform mutual auth / Key Agreement |
| **READ BIN** | `B0` | `OfsH`| `OfsL`| - | Read large PQC Certificates (Extended Length) |

## 5. Key Challenges addressed by PoC
1.  **Performance:** PQC operations (especially Dilithium verification) are computationally intensive. Hardware acceleration is used.
2.  **Transmission Time:** Larger keys increase APDU transmission time (NFC bandwidth limits).
3.  **Memory:** Storing PQC keys and larger certificates requires more non-volatile memory (NVM).
