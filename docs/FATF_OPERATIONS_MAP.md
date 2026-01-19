# FATF Operations Mapping: Risk Tiers & Data Elements

**Status:** Draft
**Context:** FATF Travel Rule Compliance for Unhosted Wallets
**Standard:** ISO/IEC 18013-5 (mDoc)

## 1. Overview

This document defines the operational mapping between FATF Risk Tiers (based on transaction amount, jurisdiction, and counterparty analysis) and the specific Identity Data Elements required to be disclosed via SCAC (Self-hosted Crypto Account Ownership Credential).

The goal is to implement **Data Minimization**: sharing only the necessary information for a given risk level, rather than a full KYC dump for every transaction.

## 2. Risk Tiers

Risk levels are determined by the VASP based on their internal compliance policies. This specification defines the *standard data profiles* expected for each tier.

| Tier | Context | Description | Required Verification |
|---|---|---|---|
| **Tier 1 (Low)** | Small tx, Domestic | Minimal risk. Sanction screening only. | Proof of Non-Sanctioned Nationality / Residence. |
| **Tier 2 (Medium)** | Standard tx | Standard due diligence. | Name matching & Age verification. |
| **Tier 3 (High)** | Large tx, Cross-border | Enhanced due diligence (EDD). | Full Identity (Name, Address, DoB). |

## 3. Data Profile Mapping (mDoc)

Responses usually consist of two documents:
1.  **`org.jaopp.scac`**: Proof of wallet ownership.
2.  **`org.iso.18013.5.1.mDL`** (or equivalent Identity mDoc): Proof of real-world identity.

### Tier 1: Low Risk (Sanction Screening)
**Goal:** Ensure the user is not from a sanctioned jurisdiction and owns the wallet.

| Namespace | Element | Purpose |
|---|---|---|
| `org.jaopp.scac` | `wallet_address` | Bind VP to the specific crypto transaction. |
| `org.jaopp.scac` | `blockchain` | Network context. |
| `org.iso.18013.5.1.mDL` | `resident_country` | Confirm jurisdiction (e.g., "JP"). |
| `org.iso.18013.5.1.mDL` | `nationality` | Confirm nationality (optional if residence is sufficient). |

### Tier 2: Medium Risk (Identity Matching)
**Goal:** Verify the name matches the account holder or beneficiary expectations, and ensure legal age.

| Namespace | Element | Purpose |
|---|---|---|
| `org.jaopp.scac` | *(All Tier 1 items)* | |
| `org.iso.18013.5.1.mDL` | `family_name` | Name matching (Katakana/Alphabet). |
| `org.iso.18013.5.1.mDL` | `given_name` | Name matching. |
| `org.iso.18013.5.1.mDL` | `birth_date` | Age verification (or use `age_over_18` if supported). |

### Tier 3: High Risk (Full KYC / Travel Rule)
**Goal:** Full identification for regulatory reporting (Travel Rule) and deep background checks.

| Namespace | Element | Purpose |
|---|---|---|
| `org.jaopp.scac` | *(All Tier 2 items)* | |
| `org.iso.18013.5.1.mDL` | `resident_address` | Full address for Travel Rule mandate. |
| `org.iso.18013.5.1.mDL` | `document_number` | Unique ID for record keeping. |
| `org.iso.18013.5.1.mDL` | `portrait` | Face image (optional, for manual review). |

## 4. Operational Flow (OID4VP)

1.  **VASP** determines the transaction risk (e.g., sending 10 BTC).
2.  **VASP** creates an OID4VP Authorization Request specifying the required fields for **Tier 3**.
    *   `presentation_definition` includes input descriptors for both `org.jaopp.scac` and `mDL`.
3.  **User's Wallet** receives the request.
4.  **User** reviews the requested data ("This VASP is asking for your Full Name and Address").
5.  **User** approves. The Wallet generates a VP containing the requested fields, signed by the Device Key.
6.  **VASP** verifies the VP and proceeds with the transaction.

## 5. SCAC Data Structure Refinement

To support this flow, the SCAC definition (`docs/CWOC_SPEC.md`) must be finalized to work alongside standard Identity mDocs.

### Updated `org.jaopp.scac` Namespace

| Element | Type | Notes |
|---|---|---|
| `wallet_address` | tstr | **Mandatory**. The address being verified. |
| `blockchain` | tstr | **Mandatory**. e.g. "Bitcoin", "Ethereum". |
| `chain_id` | tstr | Optional. EIP-155 Chain ID or similar. |
| `verification_method` | tstr | "jpki", "passport_nfc", etc. |
| `assurance_level` | tstr | "high", "substantial", "low". |
