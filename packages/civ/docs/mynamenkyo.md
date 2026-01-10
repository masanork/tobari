# My Number Drivers License (MyNa-Menkyo) Specification

> **Status:** Draft (Based on standard JPDL and 2024 Integration Guidelines)
> **Reference:** `menkyo20240719_145.pdf` (NPA / Digital Agency)

## 1. System Overview
The "My Number Drivers License" integrates the Driver's License application onto the IC chip of the Individual Number Card (My Number Card).

- **Platform:** JPKI (LSI) hosting multiple applets.
- **Co-existence:** The DL Applet exists alongside the JPKI Applet (Identity/Sign) and the Surface Input Support Applet.
- **Standards:** ISO/IEC 7816-4, NPA Proprietary Spec (JPDL).

## 2. Application Identifiers (AID)
The AID is identical to the standalone Driver's License IC card.

| Application | AID (Hex) | Description |
|---|---|---|
| **Drivers License (DL)** | `A0 00 00 02 31 01 00 00 00 00 00 00 00 00 00 00` | Main DL Application |
| **DL Photo** | `A0 00 00 02 31 02 00 00 00 00 00 00 00 00 00 00` | Face Photo Application (Restricted) |

## 3. Access Control & PINs
Authentication logic remains consistent with the standalone card, using 4-digit numeric PINs. **These are distinct from the JPKI 4-digit PIN.**

| Key Ref (P2) | Name | Description | Access Rights |
|---|---|---|---|
| `80` (Local) | **PIN 1** | Common Data PIN (4 digits) | Read EF01 (Common Data), EF07 (Sign) |
| `80` (Local) | **PIN 2** | Sensitive Data PIN (4 digits) | Read EF02 (Honseki), Photo (DF2) |

> **Note:** Failed attempts are counted separately from JPKI PINs. Lockout usually occurs after 3 consecutive failures.

## 4. File Structure
The file structure under `DF_DL` follows the NPA specification.

| EF ID | Description | Size/Encoding | Access |
|---|---|---|---|
| `00 01` | **Common Data Element** | ~800 bytes (Shift-JIS/Gaiji) | PIN 1 |
| `00 02` | **Registered Domicile** (Honseki) | Variable (Shift-JIS/Gaiji) | PIN 2 |
| `00 03` | **External Characters** (Gaiji) | Bitmap/Vector data for names | PIN 1 |
| `00 04` | **Condition Changes** | Updates to conditions (glasses, etc.) | PIN 1 |
| `00 07` | **Electronic Signature** | P-256 / SHA-256 (NPA Key) | PIN 1 |

### 4.1 Common Data Element (EF01) Structure
BER-TLV encoded tags within the file.

- **Tag 11:** Name (Shift-JIS)
- **Tag 12:** Kana (Shift-JIS)
- **Tag 13:** Birth Date (Gengou)
- **Tag 14:** Address
- **Tag 15:** Issue Date
- **Tag 16:** Reference Number
- **Tag 17:** License Number
- **Tag 18:** Expiration Date
- **Tag 19:** Conditions (Code)
- **Tag 1A:** Commission (Public Safety Commission name)
- **Tag 1B:** Photo Number
- **Tag 1C-1F:** Condition Text

## 5. Gaiji (External Characters)
Japanese names and addresses often contain characters not in standard Shift-JIS (JIS X 0208).
- **Gaiji Area:** `F040` - `F9FC` (in CP932 mapping).
- **Resolution:**
  - **Standard:** Use `EF03` to read the bitmap/glyph for the specific Gaiji code found in `EF01`/`EF02`.
  - **Implementation:** `civ` library maps these codes to a lookup table (if static) or placeholder `□` if dynamic resolution is not implemented.

## 6. Integration Differences (2024+)
- **Physical Layout:** The chip is now on the My Number Card.
- **Card Reader:** Standard PC/SC readers can access both JPKI and DL APs by switching AIDs (`SELECT FILE`).
- **Surface Printing:** The reverse side of the My Number Card now has a space for the "Drivers License" endorsement, but the chip data is the primary legal verification source.
