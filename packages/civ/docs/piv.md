# PIV (Personal Identity Verification) APDU specs

## 1. System Overview
- **Standards:** NIST SP 800-73-5, ISO/IEC 7816-4
- **Encoding:** BER-TLV (Binary), X.509 (Certificates)
- **Crypto:** RSA-2048, ECC P-256/P-384, 3DES
- **Protocol:** T=1 (Contact), T=CL (Contactless)

## 2. Application Identifiers (AID)
| Application | AID (Hex) | Description |
|---|---|---|
| **PIV Card App** | `A0 00 00 03 08 00 00 10 00 01 00` | NIST PIV Application |

## 3. APDU Command Reference
**CLA**: `00` (ISO) or `80` (Proprietary).

| Command | INS | P1 | P2 | Data | Le | Description |
|---|---|---|---|---|---|---|
| **SELECT** | `A4` | `04` | `0C` | `[AID]` | - | Select Application |
| **GET DATA** | `CB` | `3F` | `FF` | `[Tag List]` | `Len` | Read Data Object |
| **VERIFY** | `20` | `00` | `80` | `[PIN]` | - | Verify PIN |
| **GEN AUTH** | `87` | `Alg` | `Key`| `[Data]` | `Len` | General Authenticate |

## 4. Data Objects (Containers)
Accessed via `GET DATA` with Tag `5C` + [Container Tag].
The response is wrapped in a Template Tag (`7E` or similar) containing the data object.

| Name | Tag | Container ID | Description |
|---|---|---|---|
| **CCC** | `5F C1 07` | `DB 00` | Card Capability Container |
| **CHUID** | `5F C1 02` | `30 00` | Card Holder Unique Identifier |
| **Auth Cert** | `5F C1 05` | `01 01` | X.509 Certificate for PIV Auth (9A) |
| **Sign Cert** | `5F C1 0A` | `01 00` | X.509 Certificate for Digital Signature (9C) |
| **Card Auth Cert** | `5F C1 01` | `05 00` | X.509 Certificate for Card Auth (9E) |
| **Key Mgmt Cert** | `5F C1 0B` | `01 02` | X.509 Certificate for Key Management (9D) |
| **Security Object**| `5F C1 06` | `90 00` | Security Object (Signed Hashes) |
| **Discovery Obj** | `5F C1 07` | `60 00` | PIV Discovery Object |

## 5. Key References & Algorithms

### Key References (P2 in GEN AUTH / VERIFY)
| Key Ref | Usage | Description |
|---|---|---|
| `00` | Global PIN | Global Card PIN |
| `80` | App PIN | PIV Application PIN (Verification required for 9A/9C usage) |
| `96` | Global PIN | PIV Card Application Global PIN |
| `9A` | Auth | PIV Authentication Key (Internal Auth) |
| `9C` | Sign | Digital Signature Key (Internal Auth / Signing) |
| `9D` | Key Mgmt | Key Management Key (External Auth / Decryption) |
| `9E` | Card Auth | Card Authentication Key (Physical Access) |

### Algorithms (P1 in GEN AUTH)
| Alg ID | Description |
|---|---|
| `00` | 3DES (3 Key) |
| `07` | RSA 2048 |
| `11` | ECC P-256 |
| `14` | ECC P-384 |

## 6. Authentication Flows

### 6.1 PIN Verification
1. **SELECT** PIV App (`A0...00`).
2. **VERIFY** (`00 20 00 80`) with 8-byte padded PIN (0xFF padding).
   - SW `9000`: Success.
   - SW `63Cx`: Failure (x retries remaining).

### 6.2 Internal Authenticate (Signing)
Used for SSH / mTLS.
1. **SELECT** PIV App.
2. **VERIFY** PIN (`80`).
3. **GEN AUTH** (`00 87 <Alg> 9A`) with Dynamic Auth Template (`7C`).
   - Input: Challenge / Hash.
   - Output: Signature.

## 7. Verification Implementation (Rust)
The `PivController` now supports high-level user authentication:
- **`authenticate_user(pin)`**:
  1. Selects PIV App.
  2. Verifies PIN.
  3. Reads Authentication Certificate (Tag `5F C1 05`).
  4. Parses the X.509 certificate to extract the Public Key (RSA or ECC P-256).
  5. Generates a random 32-byte challenge.
  6. Signs the challenge using the card's private key (`GEN AUTH`).
  7. Verifies the signature against the extracted public key.
