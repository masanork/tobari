# Estonian ID Card (EstEID) Specification

## 1. System Overview
- **Standards:** ISO/IEC 7816-4, EstEID Spec v3.5/v3.6
- **Encoding:** UTF-8
- **Crypto:** RSA-2048 / ECC-P384 (Newer cards), SHA-256/384/512
- **Protocol:** T=0 / T=1 (Contact), T=CL (Contactless - Newer cards)

## 2. Application Identifiers (AID)
EstEID uses a dedicated AID, distinct from the ICAO 9303 ePassport application.

| Application | AID (Hex) | Description |
|---|---|---|
| **EstEID v3.5/3.6** | `D2 33 00 00 00 45 73 74 45 49 44 20 76 33 36` | "EE EstEID v36" |
| **EstEID (Older)** | `D2 33 00 00 00 45 73 74 45 49 44 20 76 33 35` | "EE EstEID v35" |

> **Note:** Many Estonian ID cards also host an ICAO 9303 ePassport app (`A0 00 00 02 47 10 01`) for travel document functionality.

## 3. APDU Command Reference
**CLA**: `00` (ISO) or `80` (Proprietary).

| Command | INS | P1 | P2 | Data | Le | Description |
|---|---|---|---|---|---|---|
| **SELECT** | `A4` | `04` | `0C` | `[AID]` | - | Select Application |
| **SELECT** | `A4` | `01`/`02` | `0C` | `[FID]` | - | Select DF/EF |
| **READ BIN** | `B0` | `OfsH`| `OfsL`| - | `Len` | Read File Data |
| **VERIFY** | `20` | `00` | `01`/`02` | `[PIN]` | - | Verify PIN1 (Auth) or PIN2 (Sign) |
| **INT AUTH** | `88` | `00` | `00` | `[RND]` | `Len` | Internal Authenticate (Auth) |
| **COMPUTE SIG**| `2A` | `9E` | `9A` | `[Hash]`| `Len` | Compute Digital Signature (Sign) |

## 4. File Structure (EstEID App)
Files are accessed by selecting the EstEID App, then selecting the specific EF by File ID (FID).

| FID | Name | Access | Description |
|---|---|---|---|
| `00 13` | **Personal Data** | Free | 16 records of text data (Surname, Given Names, ID Code, etc.) |
| `00 16` | **Auth Cert** | Free | X.509 Certificate for Authentication (PIN1) |
| `00 18` | **Sign Cert** | Free | X.509 Certificate for Digital Signatures (PIN2) |
| `00 19` | **CA Cert** | Free | CA Certificate |

### 4.1 Personal Data Records (EF `00 13`)
Data is stored in 16 fixed-length records.

| Rec # | Field | Description |
|---|---|---|
| 1 | Surname | User's Surname |
| 2 | Given Name1 | First Name |
| 3 | Given Name2 | Middle Name(s) |
| 4 | Sex | 'M' or 'F' |
| 5 | Citizenship | e.g., "EST" |
| 6 | DOB | Date of Birth (DD.MM.YYYY) |
| 7 | Personal ID | Estonian Personal ID Code (Isikukood) |
| ... | ... | Document Number, Expiry, etc. |

## 5. Security Flows

### 5.1 Authentication (Web / TLS)
1. **SELECT** EstEID App.
2. **READ** Auth Cert (`00 16`) to get Public Key.
3. **VERIFY** PIN1 (`00 20 00 01`).
   - Retries: 3. Blocked if 0.
4. **INTERNAL AUTHENTICATE** (`00 88 00 00`) with Challenge.
   - Signs the challenge using the Auth Private Key.

### 5.2 Digital Signature (DigiDoc)
1. **SELECT** EstEID App.
2. **READ** Sign Cert (`00 18`).
3. **VERIFY** PIN2 (`00 20 00 02`).
   - Retries: 3. Blocked if 0.
4. **COMPUTE SIGNATURE** (`80 2A` or ISO `00 2A`).
   - Input: Hash of the document (SHA-256/384 etc).
   - Output: Raw Signature (RSA/ECC).
