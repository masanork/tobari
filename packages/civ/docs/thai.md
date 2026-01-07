# Thai National ID Card APDU specs

## 1. System Overview
- **Standards:** ISO/IEC 7816-4
- **Encoding:** TIS-620 (Thai Character Set)
- **Crypto:** None for basic data reading (Plaintext access after selection)
- **Protocol:** T=0 / T=1 (Contact)

## 2. Application Identifiers (AID)
| Application | AID (Hex) | Description |
|---|---|---|
| **Thai ID App** | `A0 00 00 00 54 48 00 01` | Main ID Application |

## 3. APDU Command Reference
**CLA**: `80` (Proprietary) for Reading, `00` (ISO) for Selection.

| Command | INS | P1 | P2 | Data | Le | Description |
|---|---|---|---|---|---|---|
| **SELECT** | `A4` | `04` | `00` | `[AID]` | - | Select Application |
| **READ BIN** | `B0` | `OfsH`| `OfsL`| - | `Len` | Read Data from fixed offsets |
| **GET RESP** | `C0` | `00` | `00` | - | `Len` | Get Response (if SW=61xx) |

## 4. Data Offsets (Virtual File Structure)
The Thai ID card acts like a large binary file where different data fields are located at specific offsets.
Requires `SELECT` AID first.

| Field Name | Offset (Hex) | Length (Bytes) | Description |
|---|---|---|---|
| **Citizen ID** | `00 04` | 13 | 13-digit National ID Number (ASCII) |
| **Full Name (Thai)** | `00 11` | 100 | Thai Name (TIS-620) |
| **Full Name (En)** | `00 75` | 100 | English Name (ASCII) |
| **Date of Birth** | `00 D9` | 8 | YYYYMMDD (ASCII, often Buddhist Era?) |
| **Gender** | `00 E1` | 1 | '1'=Male, '2'=Female |
| **Issuer** | `00 F6` | 100 | Issuing Authority (Thai) |
| **Issue Date** | `01 67` | 8 | YYYYMMDD |
| **Expiry Date** | `01 6F` | 8 | YYYYMMDD |
| **Address** | `15 79` | 100 | Address (Thai) |
| **Photo** | `xxxx` | var | Split into multiple chunks (requires chaining) |

## 5. Reading Flow
1. **SELECT** Thai ID App (`00 A4 04 00 08 A0 00 00 00 54 48 00 01`).
   - Check SW `9000`.
2. **READ BINARY** specific offsets.
   - Example (Read CID): `80 B0 00 04 02 00 0D`.
   - Note: The `02` in P2 (or Lc field in some drivers) might be specific to certain readers/cards, but standard ISO `READ BINARY` uses P1/P2 as offset.
   - *Correction:* Some sources say command structure is `80 B0 P1 P2 02 00 Le`. The `02 00` bytes are peculiar to Thai ID structure.
3. **Decode** TIS-620 bytes to String.
