# Malaysia MyKad Specification

## 1. System Overview
- **Standards:** ISO/IEC 7816-4, ISO 14443-3A (Contactless/Touch 'n Go)
- **Platform:** Multipurpose Smart Card (Government, Driving License, Payment)
- **Encoding:** ASCII / Proprietary
- **Protocol:** T=0 / T=1

## 2. Application Identifiers (AID)
MyKad hosts multiple applications.

| Application | AID (Hex) | Description |
|---|---|---|
| **JPN (Identity)**| `A0 00 00 00 74 4A 50 4E 00 10` | National Registration Dept (Identity) |
| **JPJ (Driving)** | `A0 00 00 00 74 4A 50 4A 00 10` | Road Transport Dept (Driving License) |
| **IMM (Passport)**| `A0 00 00 00 74 49 4D 4D 00 10` | Immigration (Passport Info) - *Restricted?* |

## 3. APDU Command Reference (JPN App)
Commands appear to use a proprietary flow involving "Set Length" before reading.

| Command | INS | P1 | P2 | Data | Le | Description |
|---|---|---|---|---|---|---|
| **SELECT** | `A4` | `04` | `00` | `[AID]` | - | Select Application |
| **GET RESP** | `C0` | `00` | `00` | - | `Len` | Get Response Data |
| **SET LENGTH**| `C1` | `00` | `00` | `[Len]`| - | Define length for next read |
| **SELECT INFO**| `A1` | `00` | `00` | `[FileID+Offset]` | - | Select internal file/offset |
| **READ INFO** | `B1` | `00` | `00` | - | `Len` | Read Data |

## 4. Reading Flow (JPN Identity)
1. **SELECT** JPN AID.
2. **GET RESPONSE** (`00 C0...`) to verify.
3. **READ** Specific Fields (Chain: Set Length -> Select Info -> Read Info).

### 4.1 JPN File Structure (Partial)
Based on open-source observations (unofficial).

| Field | File ID | Offset | Length |
|---|---|---|---|
| **IC Number** | `01 11` | `00 1A` | 13 |
| **Name** | `01 11` | `00 E9` | 40 |
| **Religion** | `01 11` | `01 11` | 11 |
| **Gender** | `01 11` | `01 1C` | 1 |
| **Address 1** | `01 11` | `02 03` | 30 |
| **Postcode** | `01 11` | `02 5D` | 5 |
| **City** | `01 11` | `02 62` | 25 |
| **Photo** | `01 01` | ... | 4000+ |

## 5. Notes
- **Touch 'n Go**: The contactless interface (MiFare) is separate and used for transit/toll payments.
- **Access Control**: Some fields or applications (like Immigration) may require secure messaging or SAM (Secure Access Module) authentication, not publicly documented. Basic ID info (JPN) has been reverse-engineered.
