# My Number Drivers License (MyNa-Menkyo) Specification

## 1. System Overview
The "My Number Drivers License" (MyNa-Menkyo) records driver's license information in the expansion area of the My Number Card (Individual Number Card). It acts as a valid driver's license for public identification.

### AIDs (Application Identifiers)
| Type | AID | PIX |
|---|---|---|
| **ELF-AID** | `A0 00 00 02 31 04 00 00 00 00 00 00 00 00 00 00` | Starts with `04` |
| **Executable Module AID** | `A0 00 00 02 31 05 00 00 00 00 00 00 00 00 00 00` | Starts with `05` |
| **Instance AID** | `A0 00 00 02 31 06 00 00 00 00 00 00 00 00 00 00` | Starts with `06` |

*Standards:* JIS X 6308 (ISO/IEC 7816-5).

## 2. File Structure (EFs)

| File Name | EF-ID | Type | Content | Max Size | Access (Read/Write) |
|---|---|---|---|---|---|
| **IEF01** | `00 06` | IEF | PIN (4 digits) | 4 | - / - |
| **WEF01** | `00 1A` | WEF | PIN Setting | 3 | FREE / - |
| **WEF02** | `00 1B` | WEF | License Information | 5845 | PIN / Forbidden |
| **WEF03** | `00 1C` | WEF | Electronic Signature | 584 | PIN / - |

### Access Control Notes
- **PIN:** 4 digits (numeric).
- **Retry Limit:** 10 times.
- **Lockout:** Requires resetting by Prefectural Public Safety Commission.
- **PIN Setting (WEF01):**
  - If Byte 1 Bit 1 is `1`: PIN is set.
  - If Byte 1 Bit 1 is `0`: PIN is not set (No Verification required / treated as verified).
- **Default PIN (DPIN):** `****` (ASCII `2A 2A 2A 2A`). Used when PIN is not set.

## 3. Data Content (WEF02: License Information)
**SFI:** `00 1B`  
**Encoding:** BER-TLV  
**Hash Scope:** All data in this file is covered by the Electronic Signature in WEF03.

### Data Elements
| Tag | Length | Format | Description |
|---|---|---|---|
| `C2` | 7 | 0201 | Driver History Info Record Date (EraYYMMDD) |
| `C3` | 1 | HEX | Driver Category (Excellent/General/Violation) |
| `C4` | 6 | 0208 | License Color (Gold/Blue/Green etc.) |
| `C5` | 7 | 0201 | License Info Expiration Date (EraYYMMDD) |
| `C6` | 80 | 0208 | License Condition 1 |
| `C7` | 80 | 0208 | License Condition 2 |
| `C8` | 80 | 0208 | License Condition 3 |
| `C9` | 80 | 0208 | License Condition 4 |
| `CA` | 256 | - | Missing Characters (Gaiji/Ketsuji) 1 |
| `CB` | 256 | - | Missing Characters (Gaiji/Ketsuji) 2 |
| `CC` | 80 | 0208 | License Condition 5 |
| `CD` | 80 | 0208 | License Condition 6 |
| `CE` | 80 | 0208 | License Condition 7 |
| `CF` | 80 | 0208 | License Condition 8 |
| `D0` | 80 | 0208 | License Condition 9 |
| `D1` | 80 | 0208 | License Condition 10 |
| `D2` | 80 | 0208 | License Condition 11 |
| `D3` | 80 | 0208 | License Condition 12 |
| `D4` | 256 | - | Missing Characters 3 |
| `D5` | 256 | - | Missing Characters 4 |
| `D6` | 256 | - | Missing Characters 5 |
| `D7` | 80 | 0208 | Remarks 1 |
| `D8` | 80 | 0208 | Remarks 2 |
| `D9` | 80 | 0208 | Remarks 3 |
| `DA` | 80 | 0208 | Remarks 4 |
| `DB` | 80 | 0208 | Remarks 5 |
| `DC` | 80 | 0208 | Remarks 6 |
| `DD` | 80 | 0208 | Remarks 7 |
| `DE` | 80 | 0208 | Remarks 8 |
| `DF` | 80 | 0208 | Spare 1 |
| `E0` | 80 | 0208 | Spare 2 |
| `E1` | 80 | 0208 | Spare 3 |
| `E2` | 80 | 0208 | Spare 4 |
| `E3` | 80 | 0208 | Spare 5 |
| `E4` | 80 | 0208 | Spare 6 |
| `E5` | 80 | 0208 | Spare 7 |
| `E6` | 80 | 0208 | Spare 8 |
| `E7` | 12 | 0201 | License Information Record Number |
| `E8` | 12 | 0201 | Driver History Information Record Number |
| `E9` | 7 | 0201 | License Date: Motorcycle / Small Special / Moped |
| `EA` | 7 | 0201 | License Date: Others |
| `EB` | 7 | 0201 | License Date: Class 2 (Commercial) |
| `EC` | 1 | HEX | License Type: Large (大型) |
| `ED` | 1 | HEX | License Type: Ordinary (普通) |
| `EE` | 1 | HEX | License Type: Large Special (大特) |
| `EF` | 1 | HEX | License Type: Large Motorcycle (大自二) |
| `F0` | 1 | HEX | License Type: Ordinary Motorcycle (普自二) |
| `F1` | 1 | HEX | License Type: Small Special (小特) |
| `F2` | 1 | HEX | License Type: Moped (原付) |
| `F3` | 1 | HEX | License Type: Towing (け引) |
| `F4` | 1 | HEX | License Type: Large Class 2 (大二) |
| `F5` | 1 | HEX | License Type: Ordinary Class 2 (普二) |
| `F6` | 1 | HEX | License Type: Large Special Class 2 (大特二) |
| `F7` | 1 | HEX | License Type: Towing Class 2 (け引二) |
| `F8` | 1 | HEX | License Type: Medium (中型) |
| `F9` | 1 | HEX | License Type: Medium Class 2 (中二) |
| `FA` | 1 | HEX | License Type: Semi-Medium (準中型) |
| `FB` | 7 | - | RFU 1 |
| `FC` | 7 | - | RFU 2 |
| `FD` | 7 | - | RFU 3 |
| `FE` | 7 | - | RFU 4 |
| `FF` | 7 | - | RFU 5 |
| `100` | 7 | - | RFU 6 |
| `101` | 7 | - | RFU 7 |
| `102` | 7 | - | RFU 8 |
| `103` | 7 | - | RFU 9 |
| `104` | 7 | - | RFU 10 |
| `105` | 7 | - | RFU 11 |
| `106` | 7 | - | RFU 12 |
| `107` | 2000 | JPEG2000 | Face Photo (Monochrome) |

*Note: All Date formats are "Era (1 byte) + YYMMDD (6 bytes)". Era: 1=Meiji, 2=Taisho, 3=Showa, 4=Heisei, 5=Reiwa.*

## 4. Electronic Signature (WEF03: Signature)
**SFI:** `00 1C`  
**Encoding:** BER-TLV

Contains the digital signature generated over the **entire content of WEF02**.

### Data Elements
| Tag | Length | Format | Description |
|---|---|---|---|
| `108` | 256 | BINARY | Signature Value |
| `109` | 16 | 0201 | Serial Number |
| `10A` | 48 | 0201 | RFU |
| `10B` | 80 | 0201 | Issuer Name |
| `10C` | 130 | 0201 | Subject Name |
| `10D` | 32 | BINARY | Subject Key Identifier |

### Algorithm
- **Hash:** SHA-256 (over all data in WEF02, in stored order).
- **Signature:** RSA-2048.
- **Padding:** PKCS #1 Version 1.5.

## 5. Command Reference

### SELECT FILE
- **CLA:** `00`
- **INS:** `A4`
- **P1:** `04` (Select by AID)
- **P2:** `0C`
- **Data:** `A0 00 00 02 31 06 00 00 00 00 00 00 00 00 00 00` (Instance AID)

### VERIFY (PIN)
- **CLA:** `00`
- **INS:** `20`
- **P1:** `00`
- **P2:** `82` (Specific to this AP)
- **Data:** 4-digit PIN (ASCII)

### READ BINARY
- **CLA:** `00`
- **INS:** `B0`
- **P1:** `8x` (EF-ID MSB or 00)
- **P2:** `xx` (EF-ID LSB or Offset)

## 6. Reference
- [運転免許証及び運転免許証作成システム等仕様書 (仕様書バージョン番号: 010)](https://www.npa.go.jp/laws/notification/koutuu/menkyo/menkyo20240719_145.pdf)
