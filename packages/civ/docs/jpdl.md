# Drivers License APDU specs

## 1. System Overview
- **Standards:** ISO/IEC 14443 Type B (NFC), ISO/IEC 7816-4 (APDU)
- **Encoding:** Shift-JIS (JIS X 0208 & 0201), JPEG2000 (Photo)
- **Crypto:** TDES (2-key), SHA-256 (Hash), RSA-2048 (Signature)
- **Protocol:** ISO-DEP (Type B)

## 2. Application Identifiers (AID) & DFs
All DFs share the same prefix `A0 00 00 02 31`.

| DF | AID (Hex) | Description |
|---|---|---|
| **MF** | (Root) | Master File |
| **DF1** | `A0 00 00 02 31 01 00 00 00 00 00 00 00 00 00 00` | Main Data (Text, Gaiji) |
| **DF2** | `A0 00 00 02 31 02 00 00 00 00 00 00 00 00 00 00` | Photo Data |
| **DF3** | `A0 00 00 02 48 03 00 00 00 00 00 00 00 00 00 00` | RFU (ISO/IEC 18013-2) |

## 3. APDU Command Reference
**CLA**: `00` (ISO).

| Command | INS | P1 | P2 | Data | Le | Description |
|---|---|---|---|---|---|---|
| **SELECT** | `A4` | `04` | `0C` | `[AID]` | - | Select DF |
| **SELECT** | `A4` | `02` | `0C` | `[FID]` | - | Select EF |
| **VERIFY** | `20` | `00` | `80` | `[PIN]` | - | Verify PIN1 or PIN2 |
| **READ BIN**| `B0` | `OfsH`| `OfsL`| - | `Len` | Read Binary Data |

## 4. File Structure & Access Rights

### 4.1 MF (Master File)
**Access:** Free
| FID | Name | Tag | Max Len | Desc |
|---|---|---|---|---|
| `EF 01` | Common Data | `45` | 17 | Issuer Data, Expiry, etc. |
| `EF 02` | PIN Settings | `05` | 3 | PIN1/PIN2 Enabled Flags |
| `IEF 01`| PIN 1 | - | - | 4-digit numeric (Retries: 3) |
| `IEF 02`| PIN 2 | - | - | 4-digit numeric (Retries: 3) |

### 4.2 DF1 (License Info)
**Access:**
- **PIN 1**: Common info (Name, Addr, DOB, License Date, Conditions, etc.)
- **PIN 1 & PIN 2**: Registered Domicile (Honseki), Photo (DF2)

| FID | Name | Tag | Max Len | Access | Desc |
|---|---|---|---|---|---|
| `EF 01` | Main Info | `11`.. | 880 | **PIN 1** | Name, Addr, DOB, Lic. #, etc. |
| `EF 02` | Honseki | `41` | 82 | **PIN 1+2** | Registered Domicile |
| `EF 03` | Gaiji | `48` | 264 | **PIN 1** | External Characters (Bitmap) |
| `EF 04` | Cond. Changes| `50`.. | 640 | **PIN 1** | Updated Conditions |
| `EF 05` | Gaiji Changes| `A0`.. | 663 | **PIN 1** | External Chars for Changes |
| `EF 06` | Addr Changes | `AB`.. | 256 | **PIN 1** | Updated Honseki (Requires PIN2?) |
| `EF 07` | Signature | `B1`.. | 578 | **PIN 1** | Digital Signature |

### 4.3 DF2 (Photo)
**Access:** PIN 1 & PIN 2 required.
| FID | Name | Tag | Max Len | Desc |
|---|---|---|---|---|
| `EF 01` | Photo | `5F40` | 2000 | JPEG2000 |

## 5. Security & Flows

### 5.1 PINs
- **PIN 1**: 4 digits. Protects name, address, date of birth, license number, etc.
- **PIN 2**: 4 digits. Protects "Registered Domicile" (Honseki) and Face Photo.
- **Retries**: 3 times each. **Hard lock** after 3 failures (requires police station visit).

### 5.2 Access Flow
1. `SELECT DF`: MF (`...02 31`)
2. `VERIFY` PIN 1:
   - **Command:** `00 20 00 80 <Len> <PIN>` (P2=`80` indicates "Current DF's Password").
   - **Note:** Standard practice is to Select IEF (`0001` for PIN1, `0002` for PIN2) if needed, but `80` targets the implicit key for the scope.
   - **Unlocks:** `EF 01` (Main), `EF 03` (Gaiji), etc.
3. `VERIFY` PIN 2:
   - **Command:** `00 20 00 80 <Len> <PIN>` (After `SELECT IEF02` or relying on impl).
   - **Unlocks:** `EF 02` (Honseki) and enables DF2 access.
4. `READ BINARY` target EFs.

### 5.3 Data Encoding
- **Text**: JIS X 0208 (Shift-JIS compatible for Kanji).
- **Date**: JIS X 0201 (ASCII) in Era format (e.g., `3050101` = Heisei 30, Jan 1).
    - **Eras:** 1=Meiji, 2=Taisho, 3=Showa, 4=Heisei, 5=Reiwa.
- **Gaiji**:
    - **Format:** Uncompressed Bitmap.
    - **Grid:** Typically 16x16 or similar (variable).
    - **Structure:** `[Header 128 bytes] [Pattern Data]`.
    - **Usage:** Referenced by custom JIS codes in text fields (e.g., `FFxx`).

## 6. Digital Signature
To verify data integrity:
1. Read **Signature** (`B1`) from **DF1/EF07**.
2. Hash relevant data from DF1 (`EF01`, `EF02`) and DF2 (`EF01`).
3. Verify using RSA-2048 Public Key (Certificate not stored on card; Public Key must be obtained from authorities).

## 8. Codes & Values

### 8.1 Era Codes (Dates)
Used in Date fields (e.g., `3050101`).
- `1`: Meiji (1868-1912)
- `2`: Taisho (1912-1926)
- `3`: Showa (1926-1989)
- `4`: Heisei (1989-2019)
- `5`: Reiwa (2019-)

### 8.2 Color Classification (Tag `1A`)
Indicates the license band color.
- `優良`: Gold (Excellent driver)
- `新規`: Green (New driver)
- `一般`: Blue (General)
- `その他`: Blue (Violation/First renewal)

### 8.3 Note on Gender
Gender is **not** recorded in the IC chip `DF1/EF01` (Common Data), unlike the physical card face.

## 9. Reference
- [運転免許証及び運転免許証作成システム等仕様書 (仕様書バージョン番号: 010)](https://www.npa.go.jp/laws/notification/koutuu/menkyo/menkyo20240719_145.pdf)
