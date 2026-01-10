# Residence Card / Special Permanent Resident Certificate Specification

## 1. System Overview
- **Standards:** ISO/IEC 14443 Type B (NFC), ISO/IEC 7816-4 (APDU)
- **Encoding:** UTF-8 (Text), MMR TIFF / JPEG2000 (Images)
- **Crypto:** TDES (2-key) for Secure Messaging, SHA-1 for Key Derivation, RSA-2048 for Signature
- **Protocol:** ISO-DEP (Type B)

## 2. Application Identifiers (AID) & DFs
All DFs share the same prefix `D3 92 F0 00 4F`.

| DF | AID (Hex) | Description |
|---|---|---|
| **MF** | (Root) | Master File |
| **DF1** | `D3 92 F0 00 4F 02 00 00 00 00 00 00 00 00 00 00` | Front Image & Photo |
| **DF2** | `D3 92 F0 00 4F 03 00 00 00 00 00 00 00 00 00 00` | Back Side Info (Address) |
| **DF3** | `D3 92 F0 00 4F 04 00 00 00 00 00 00 00 00 00 00` | Digital Signature |

## 3. APDU Command Reference
**CLA**: `00` (ISO) or `08`/`0C` (Secure Messaging).

| Command | INS | P1 | P2 | Data | Le | Description |
|---|---|---|---|---|---|---|
| **SELECT** | `A4` | `04` | `0C` | `[AID]` | - | Select DF |
| **SELECT** | `A4` | `02` | `0C` | `[FID]` | - | Select EF |
| **VERIFY** | `20` | `00` | `86` | `[Data]` | - | Verify Card ID (with SM) |
| **GET CHALLENGE**| `84` | `00` | `00` | - | `08` | Request Random (RND.ICC) |
| **MUTUAL AUTH** | `82` | `00` | `00` | `[Data]`| `00` | Exchange Session Keys |
| **READ BIN**| `B0` | `OfsH`| `OfsL`| - | `Len` | Read Binary Data |

## 4. File Structure & Access Rights

### 4.1 MF (Master File)
**Access:** Free
| FID | Name | Tag | Max Len | Desc |
|---|---|---|---|---|
| `EF 01` | Common Data | `C0` | 4 | Version (e.g. "0001") |
| `EF 02` | Card Type | `C1` | 1 | 1=Res. Card, 2=Spec. Perm. |

### 4.2 DF1 (Visual Info)
**Access:** Card ID Auth + SM required.
| FID | Name | Tag | Max Len | Desc |
|---|---|---|---|---|
| `EF 01` | Front Image | `D0` | 7000 | MMR Compressed TIFF (Binary) |
| `EF 02` | Photo | `D1` | 3000 | JPEG2000 Color (Binary) |

### 4.3 DF2 (Back Side / Address)
**Access:** Card ID Auth required (SM recommended).
| FID | Name | Tag | Max Len | Desc |
|---|---|---|---|---|
| `EF 01` | Address | `D2`..`D4`| 342 | Date(D2), Code(D3), Addr(D4) |
| `EF 02` | Ext. Permit (Global)| `D5` | 120 | Comprehensive Permission |
| `EF 03` | Ext. Permit (Indiv)| `D6` | 120 | Individual Permission |
| `EF 04` | Update Status | `D7` | 3 | Application Status Code |

### 4.4 DF3 (Signature)
**Access:** Card ID Auth required.
| FID | Name | Tag | Max Len | Desc |
|---|---|---|---|---|
| `EF 01` | Signature | `DA`,`DB`| 1464 | Check Code(DA), Cert(DB) |

## 5. Security & Flows

### 5.1 Card ID Authentication (Key Derivation)
The "PIN" is the **12-digit Card ID** printed on the card (e.g., "AB12345678CD").
- **Retry Count:** **Infinite**. The card does not track failures; it never locks due to wrong PINs.
- **Key Seed**: `SHA-1(CardID_Bytes)`.
- **Master Keys**: First 16 bytes of Hash = `Kenc` = `Kmac`.
   - Used for TDES 2-key CBC.

### 5.2 Secure Messaging Establishment
1. `SELECT DF` (e.g., DF1).
2. `GET CHALLENGE` -> Receive `RND.ICC` (8 bytes).
3. **Terminal**: Generate `RND.IFD` (8 bytes) and `K.IFD` (16 bytes).
4. **Calculate**: Encrypt `RND.IFD || RND.ICC || K.IFD` using `Kenc` (TDES).
5. `MUTUAL AUTHENTICATE` -> Send encrypted data.
6. **Verify**: Decrypt response (`RND.ICC || RND.IFD`) to confirm card identity.
7. **Session Keys**: Generate `KSenc`, `KSmac` via `SHA-1` of (`K.IFD XOR K.ICC` ...).

### 5.3 Verify Command
After Mutual Auth, `VERIFY` command is sent **wrapped in SM**.
- **Padding**: Append `80` then `00`... to the Card ID to make 16 bytes.
- **Encryption**: Encrypt the padded block using `KSenc` (TDES).
- **SW**: `90 00` (OK), `63 00` (Failed - No counter returned).

## 6. Data Verification & Exceptions

### 6.1 Data Formats
- **Text Strings**: UTF-8 (No BOM).
- **Dates**: `YYYYMMDD` (Numeric String, Tag `D2` etc).
- **Municipality Code**: 6-digit JIS X 0201 (e.g., "131016").
- **Images**:
    - Front: MMR Compressed TIFF (Tag `D0`)
    - Photo: JPEG2000 (Tag `D1`)

### 6.2 Under 16 Years Old Exception
For residents under 16, specific files are empty (filled with NULL `00` or Tag/Len only):
- **DF1/EF02 (Photo)**: Contains valid Tag/Len but data may be empty or header only.
- **DF3/EF01 (Signature)**: Contains Tag `DA`/`DB` with Length `0` or NULL values.
  - *Validation logic must handle these empty cases to avoid parsing errors.*

### 6.3 Digital Signature Verification
To detect forgery:
1. Read **Check Code** (`DA`) and **Certificate** (`DB`) from **DF3/EF01**.
2. Read **Front Image Data** (Value of `D0`) from **DF1/EF01**.
3. Read **Photo Data** (Value of `D1`) from **DF1/EF02**.
4. Concatenate: `FrontImage_Value || Photo_Value`.
5. Hash: `SHA-256(ConcatenatedData)`.
6. Verify: Decrypt `Check Code` using Public Key from `Certificate` and compare with Hash.

## 8. Codes & Values

### 8.1 Card Types (Tag `C1`)
- `1` (0x31): Residence Card
- `2` (0x32): Special Permanent Resident Certificate

### 8.2 Application Status (Tag `D7`)
Indicates if a renewal/change application is pending.
- `0` (0x30): None
- `1` (0x31): Application in Progress

### 8.3 Gender
Follows ISO 5218 / JIS X 0401 (Numeric string).
- `1`: Male
- `2`: Female

## 8. Codes & Values

### 8.1 Card Types (Tag `C1`)
- `1` (0x31): Residence Card
- `2` (0x32): Special Permanent Resident Certificate

### 8.2 Application Status (Tag `D7`)
Indicates if a renewal/change application is pending.
- `0` (0x30): None
- `1` (0x31): Application in Progress

### 8.3 Gender
Follows ISO 5218 / JIS X 0401 (Numeric string).
- `1`: Male
- `2`: Female

## 9. Reference
- [在留カード等仕様書 (Ver 1.5) - 出入国在留管理庁](https://www.moj.go.jp/isa/content/001414093.pdf)
