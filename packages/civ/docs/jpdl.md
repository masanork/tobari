# Drivers License (IC Card) Specification

## 1. System Overview
*   **Standards:** ISO/IEC 14443 Type B (NFC), ISO/IEC 7816-4.
*   **Encoding:**
    *   Text: Shift-JIS (JIS X 0208 & JIS X 0201).
    *   Photo: JPEG2000.
    *   Gaiji (External Char): MMR Compressed Bitmap.
*   **Cryptography:**
    *   Hash: SHA-256.
    *   Signature: RSA-2048 (PKCS #1 v1.5).

## 2. Application Identifiers (AID)

| DF | AID | PIX | Description |
|---|---|---|---|
| **DF1** | `A0 00 00 02 31 01 00 00 00 00 00 00 00 00 00 00` | Start `01` | Main Data |
| **DF2** | `A0 00 00 02 31 02 00 00 00 00 00 00 00 00 00 00` | Start `02` | Photo Data |
| **DF3** | `A0 00 00 02 48 03 00 00 00 00 00 00 00 00 00 00` | Start `03` | RFU (ISO/IEC 18013-2) |

## 3. File Structure & Access Control

| Parent | EF | EF-ID | Type | Content | Size | Read Access | Write Access |
|---|---|---|---|---|---|---|---|
| **MF** | EF01 | `2F 01` | WEF | Common Data | 17 | FREE | - |
| **MF** | EF02 | `00 0A` | WEF | PIN Settings | 3 | FREE | - |
| **MF** | IEF01 | `00 01` | IEF | PIN 1 | 6 | - | - |
| **MF** | IEF02 | `00 02` | IEF | PIN 2 | 6 | - | - |
| **DF1** | EF01 | `00 01` | WEF | License Info | 880 | **PIN 1** | - |
| **DF1** | EF02 | `00 02` | WEF | Registered Domicile | 82 | **PIN 1 & 2** | - |
| **DF1** | EF03 | `00 03` | WEF | Gaiji | 264 | **PIN 1** | - |
| **DF1** | EF04 | `00 04` | WEF | Condition Changes | 640 | **PIN 1** | Forbidden |
| **DF1** | EF05 | `00 05` | WEF | Gaiji Changes | 663 | **PIN 1** | Forbidden |
| **DF1** | EF06 | `00 06` | WEF | Domicile Changes | 256 | **PIN 1 & 2** | Forbidden |
| **DF1** | EF07 | `00 07` | WEF | Electronic Signature | 578 | **PIN 1** | - |
| **DF2** | EF01 | `00 01` | WEF | Face Photo | 2005 | **PIN 1 & 2** | - |
| **DF3** | EF01 | `00 01` | WEF | RFU | 512 | **PIN 1** | - |

**Access Rights Note:**
*   If **MF/EF02** Byte 1 Bit 1 is `0` (PIN not set), verification is treated as using a Default PIN (`****`) or skipped.
*   "Condition Changes" (EF04) Read is **Forbidden** (or treated as PIN1) if PIN is not set.

## 4. Data Content Details

### 4.1 Common Data Element (MF/EF01)
| Tag | Len | Content | Encoding |
|---|---|---|---|
| `45` | 11 | Card Issuer Data (Ver + IssueDate + ExpDate) | 0201 + HEX |
| `46` | 2 | Pre-issue Data (ManufID + CryptoID) | HEX |

### 4.2 License Information (DF1/EF01) - Tag `00 01`
| Tag | Len | Content |
|---|---|---|
| `11` | 1 | JIS X 0208 Version |
| `12` | 72 | Name (Use `2121` space between Last/First) |
| `13` | 32 | Kana Name |
| `14` | 32 | Alias Name (Tsusho-mei) |
| `15` | 16 | Unified Kana Name |
| `16` | 7 | Date of Birth (EraYYMMDD) |
| `17` | 80 | Address |
| `18` | 7 | Date of Issue (EraYYMMDD) |
| `19` | 5 | Inquiry Number (Ref #) |
| `1A` | 6 | Color Class (優良, 新規, その他) |
| `1B` | 7 | Expiration Date (EraYYMMDD) |
| `1C` | 80 | Condition 1 |
| `1D` | 80 | Condition 2 |
| `1E` | 80 | Condition 3 |
| `1F` | 80 | Condition 4 |
| `20` | 24 | PSC (Public Safety Commission) Name |
| `21` | 12 | License Number |
| `22` | 7 | Date: Motorcycle/Small Special/Moped |
| `23` | 7 | Date: Others |
| `24` | 7 | Date: Class 2 |
| `25`..`32` | 7 | Date: Individual Categories (Large, Ord, LargeSpec, etc.) |
| `33` | 7 | Date: Semi-Medium |
| `34`..`3F` | - | RFU |

### 4.3 Registered Domicile (DF1/EF02) - Tag `00 02`
| Tag | Len | Content |
|---|---|---|
| `41` | 80 | Registered Domicile (Honseki) |

### 4.4 Gaiji (DF1/EF03)
Contains bitmap data for characters not in JIS X 0208.
*   **Encoding:** MMR Compressed Bitmap.
*   **Header:** 1 byte (Structure/size).
*   **Tags:** `48` (Gaiji 1), `49` (Gaiji 2).

### 4.5 Condition Changes (DF1/EF04)
Updates to address, name, or conditions.
*   **Tags:** `50` (Updated Flag), `51`..`5F` (PSC Change), `60`..`97` (New Address/Name/Conditions).

### 4.6 Electronic Signature (DF1/EF07)
*   **Hash Input:** All data in DF1/EF01, DF1/EF02, and DF2/EF01.
*   **Algorithm:** SHA-256 hash + RSA-2048 signature.
*   **Tag `B1`**: Signature Value (256 bytes).

### 4.7 Face Photo (DF2/EF01)
*   **Tag:** `5F 40`
*   **Format:** JPEG2000 (Monochrome).
*   **Max Size:** 2000 bytes.

## 5. Command Reference

### SELECT FILE (`00 A4`)
*   **P1:** `04` (AID) or `02` (EF-ID).
*   **P2:** `0C` (First/Next).

### VERIFY (`00 20`)
*   **P1:** `00`
*   **P2:** `80` (Current EF / Implicit).
    *   *Note:* The spec implies selecting the IEF or using a Short EF-ID in P2 is possible, but `80` targets the PIN associated with the current context (DF).
*   **Data:** 4-digit numeric PIN.
*   **Retry:** 3 times each for PIN1 and PIN2.

### READ BINARY (`00 B0`)
*   **P1:** `8x` (EF-ID MSB) or `00` (Current EF).
*   **P2:** `xx` (EF-ID LSB) or `Offset`.

## 6. Reference
- [運転免許証及び運転免許証作成システム等仕様書 (仕様書バージョン番号: 010)](https://www.npa.go.jp/laws/notification/koutuu/menkyo/menkyo20240719_145.pdf)
