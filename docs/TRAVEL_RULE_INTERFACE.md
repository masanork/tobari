# Travel Rule Interface Specification (Draft)

**Status:** Draft
**Protocol:** OID4VP (OpenID for Verifiable Presentations)
**Context:** VASP to Unhosted Wallet Interaction

## 1. Overview

This document specifies the minimal interface for a Virtual Asset Service Provider (VASP) to request and receive compliance data (SCAC + Identity) from a user interacting via a self-hosted wallet.

The interaction follows the **ISO 18013-7 (OID4VP)** standard, ensuring compatibility with mobile wallets and future digital identity infrastructure.

## 2. Interaction Flow

### Phase 1: Initiation (Transaction Request)
The user initiates a transaction (e.g., withdraw funds to external address) on the VASP's interface.

### Phase 2: Requirement Check
The VASP determines the Risk Tier (see [FATF_OPERATIONS_MAP.md](./FATF_OPERATIONS_MAP.md)) and constructs an Authorization Request.

### Phase 3: Authorization Request (OID4VP)
The VASP presents a QR Code or Deep Link (`openid4vp://...`) containing the request parameters.

**Key Parameters:**
*   `client_id`: VASP's identifier (DID or URL).
*   `nonce`: Random challenge to prevent replay.
*   `response_uri`: VASP's callback endpoint.
*   `presentation_definition`: A JSON structure describing exactly what data is needed.

**Example Presentation Definition (Tier 2: Medium Risk):**
```json
{
  "id": "travel-rule-tier-2",
  "input_descriptors": [
    {
      "id": "scac",
      "name": "Wallet Ownership",
      "purpose": "Verify wallet ownership",
      "schema": [ { "uri": "https://tobari.io/schemas/scac" } ],
      "constraints": {
        "fields": [
          { "path": ["$.mdoc.org.jaopp.scac.wallet_address"] },
          { "path": ["$.mdoc.org.jaopp.scac.blockchain"] }
        ]
      }
    },
    {
      "id": "identity",
      "name": "Personal Identity",
      "purpose": "Compliance check",
      "schema": [ { "uri": "https://iso.org/18013/5/1/mDL" } ],
      "constraints": {
        "fields": [
          { "path": ["$.mdoc.org.iso.18013.5.1.family_name"] },
          { "path": ["$.mdoc.org.iso.18013.5.1.given_name"] },
          { "path": ["$.mdoc.org.iso.18013.5.1.birth_date"] }
        ]
      }
    }
  ]
}
```

### Phase 4: User Consent & Response
1.  User scans QR with Tobari-compatible wallet.
2.  Wallet displays requested fields: "VASP X wants to see your Name, DoB, and Wallet Address 0x..."
3.  User approves.
4.  Wallet sends a **Authorization Response** to `response_uri`.
    *   Payload contains the VP (Verifiable Presentation) with the requested mDoc elements.

### Phase 5: Verification & Execution
1.  VASP receives the VP.
2.  VASP verifies:
    *   **Issuer Trust**: Is the SCAC/mDL issued by a trusted entity (Government/JAOPP)?
    *   **Device Binding**: Is the signature valid and bound to the session?
    *   **Data Integrity**: Are the values consistent?
3.  If valid, VASP executes the blockchain transaction.

## 3. IVMS 101 Mapping

For inter-VASP communication (when sending to another VASP), the data extracted from the SCAC/mDL must be mapped to the **IVMS 101** data model.

| IVMS 101 Field | mDL / SCAC Source |
|---|---|
| `naturalPerson.name.primaryIdentifier` | `org.iso.18013.5.1.family_name` |
| `naturalPerson.name.secondaryIdentifier` | `org.iso.18013.5.1.given_name` |
| `naturalPerson.dateAndPlaceOfBirth.dateOfBirth` | `org.iso.18013.5.1.birth_date` |
| `naturalPerson.geographicAddress` | `org.iso.18013.5.1.resident_address` |
| `accountNumber` | `org.jaopp.scac.wallet_address` |

## 4. Error Handling

*   **User Rejection**: If user denies consent, transaction MUST fail or fall back to a manual (slower) review process.
*   **Verification Failure**: If signatures are invalid, prompt user to re-register or use a different device.
