# Myna Card (Individual Number Card) Technical Specification

## 1. System Overview
- **Standards:** ISO/IEC 14443 Type B (NFC), ISO/IEC 7816-4 (APDU)
- **Encoding:** UTF-8, ASN.1 DER (X.690)
- **Crypto:** RSA-2048, SHA-256
- **Protocol:** ISO-DEP (Block Transmission), T=1 (Contact) / T=CL (Contactless)

## 2. Application Identifiers (AID)
| Application | AID (Hex) | Description |
|---|---|---|
| **JPKI-AP** | `D3 92 F0 00 26 01 00 00 00 01` | Public Certification (Auth/Sign) |
| **Card-AP** | `D3 92 10 00 31 00 01 01 04 08` | Input Assistance (4-Info, Photo*) |
| **Expansion** | `D3 92 10 00 31 00 01 01 01 00` | Empty/Custom Area |
| **PinStatus** | `D3 92 10 00 31 00 01 01 04 01` | PIN Status Check |

*> Note: `mynacard.ja.md` states Card-AP contains Basic4Info (0001), Photo (0002), MyNumber (0003). Real-world implementations often find Photo in Visual AP (similar AID ending in `02` or different FID structure). This doc follows `mynacard.ja.md`.*

## 3. APDU Command Reference
**CLA**: `00` (ISO) or `80` (Proprietary/JPKI).

| Command | INS | P1 | P2 | Data | Le | Description |
|---|---|---|---|---|---|---|
| **SELECT** | `A4` | `04` | `0C` | `[AID]` | - | Select Application (DF) |
| **SELECT** | `A4` | `02` | `0C` | `[FID]` | - | Select File (EF) |
| **VERIFY** | `20` | `00` | `80` | `[PIN]` | - | Verify PIN (`80` is JPKI specific) |
| **READ BIN**| `B0` | `OfsH`| `OfsL`| - | `Len` | Read Binary Data |
| **COMPUTE** | `2A` | `00` | `80` | `[Data]`| `00` | Compute Dig. Sig. (CLA=`80`) |

## 4. JPKI Application (`JPKI-AP`)
**AID:** `D3 92 F0 00 26 01 00 00 00 01`

### 4.1 Files (EFs)
| FID | Name | Access | Desc |
|---|---|---|---|
| `00 18` | **Auth PIN IEF** | - | 4-digit numeric (Retries: 3) |
| `00 1B` | **Sign PIN IEF** | - | 6-16 alphanumeric (Retries: 5) |
| `00 0A` | Auth Cert | Free | X.509 User Auth Cert |
| `00 01` | Sign Cert | Free | X.509 Signature Cert |
| `00 1A` | Sign PrivKey | **PIN** | Ref to Private Key (Sign) |
| `00 17` | Auth PrivKey | **PIN** | Ref to Private Key (Auth) |

### 4.2 Flows

#### A. PIN Verification
1. `SELECT DF`: JPKI-AP
2. `SELECT EF`: `00 18` (Auth) or `00 1B` (Sign)
3. `VERIFY`: `00 20 00 80 <Len> <PIN_Bytes>`
   - **SW 9000**: Success
   - **SW 63Cx**: Failure (x retries left). **STOP if x<=1.**
   - **SW 63C0**: Locked (Requires municipal reset).

#### B. Digital Signature (Sign)
1. **Hash Data**: Calculate SHA-256 of target data.
2. **Format**: Wrap in ASN.1 `DigestInfo` (see §6).
3. **Session**:
   - Select JPKI-AP.
   - Select Sign PIN IEF (`00 1B`) -> `VERIFY`.
   - Select Sign Key EF (`00 17`).
4. **Sign**: `80 2A 00 80 <Len> <DigestInfo> 00`
   - Returns: 256 bytes RSA signature.

## 5. Input Assistance App (`Card-AP`)
**AID:** `D3 92 10 00 31 00 01 01 04 08`

### 5.1 Files (EFs)
| FID | Name | Access | Desc |
|---|---|---|---|
| `00 11` | **PIN IEF** | - | 4-digit Auth PIN (Same as JPKI Auth PIN) |
| `00 01` | My Number | **PIN+** | 12-digit ID (Strict Access) |
| `00 02` | Basic 4 Info | **PIN** | ASN.1: Name, Addr, DOB, Sex |
| `00 03` | Face Photo | **PIN** | ASN.1 wrapped JPEG/JP2 |

### 5.2 Flows
1. `SELECT DF`: Card-AP
2. `SELECT EF`: `00 11` (PIN IEF)
3. `VERIFY`: `00 20 00 80 04 <PIN>` (4 digits)
4. `SELECT EF`: `00 01` (Attributes) or `00 02` (Photo)
5. `READ BIN`: `00 B0 <P1> <P2> 00` (Loop for full data)

## 6. Data Structures

### 6.1 DigestInfo (for `COMPUTE SIGNATURE`)
SHA-256 DigestInfo (DER encoded):
```hex
30 31 30 0D 06 09 60 86 48 01 65 03 04 02 01 05 00 04 20 [32-byte-Hash]
```
- Structure: `Seq( Seq( OID(sha256), NULL ), OctetString(Hash) )`

### 6.2 Basic 4 Info (ASN.1)
Stored in `EF 00 01`.
```asn1
Sequence {
  header: [Tag]...,
  name:   UTF8String (Tag DF22?),
  addr:   UTF8String (Tag DF23?),
  dob:    NumericString (YYYYMMDD),
  sex:    NumericString (1=Male, 2=Female, ...)
}
```
*Note: Tags vary. Parse TLV structure dynamically.*

### 6.3 Face Photo
Stored in `EF 00 02`.
- **Wrapper:** ASN.1 Octet String (Tag `04` or similar).
- **Content:** JPEG (`FF D8 ...`) or JPEG2000 (`00 00 00 0C 6A 50 ...` / `FF 4F ...`).
- **Action:** Strip ASN.1 header to find image magic bytes.

## 7. Implementation Notes
1. **Type B Stability:** Shallow modulation (10% ASK). Requires precise antenna/polling (WTX handling mandatory for RSA ops).
2. **Transaction:** Always `SELECT` correct AP before operations.
3. **Response Chaining:** If data > 256 bytes and no Ext-APDU, use loop with `P1/P2` offsets.
4. **Status Words (SW):**
   - `90 00`: OK
   - `63 Cx`: Verify Fail (x retries)
   - `6B 00`: Wrong Parameter (Offset out of range / EOF)
   - `6D 00`: INS invalid (Check CLA `00` vs `80`)

## 8. Reference
- Source: `docs/mynacard.ja.md`
- J-LIS Guidelines / OpenSC / TRETJapanNFCReader
