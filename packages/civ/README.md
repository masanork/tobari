# CIV (Citizen Identity Verification) Library

A unified Rust library for accessing and verifying various Citizen Identity Cards.
Originally focused on Japanese JPKI (My Number Card), it has expanded to support:

> [!NOTE]
> **Status Update**:
> *   **Working**: JPKI Card Info Input Support AP (Reading My Number, Basic 4 Attributes).
> *   **Working**: JPKI Signing (Both User Authentication and Digital Signature) is now functional.
> *   **Hardware**: Confirmed working with standard PC/SC readers on macOS.

*   **JPKI (Japan My Number Card)**
    *   Auth/Sign Certificates
    *   Auth with PIN (4 digits) / Sign with PIN (6-16 alphanum)
    *   My Number / 4 Attributes (Name, Address, DOB, Gender)
    *   My Number / 4 Attributes (Name, Address, DOB, Gender)
*   **Driver's License (Japan)**
    *   Common Data (PIN1) with Shift-JIS (Gaiji) parser
    *   Sensitive Data (PIN2)
*   **Residence Card (Japan)**
    *   Card Number validation
    *   Common Info parsing
*   **ePassport (ICAO 9303)**
    *   BAC (Basic Access Control) Key Derivation
    *   MRZ / Common Data Access
*   **US PIV (Personal Identity Verification)**
    *   CHUID (Card Holder Unique ID)
    *   Authentication Certificate

## Usage

This library is primarily designed to be used via the `civ` CLI tool or as a dependency in the `folio-core` application.

### CLI

```bash
# JPKI
civ jpki info
civ jpki cert --type auth
# Sign with Auth key (4-digit PIN)
civ jpki sign --type auth --pin 1234 --data "Hello"
# Sign with Signature key (6-16 alphanum PIN)
civ jpki sign --type sign --pin MYPASS123 --data "ImportantContract"

# Driver's License
civ dl --command common --pin1 1234

# Passport
civ ep --mrz "P<JPN..."

# Residence Card
civ rc --number "AB123456CD"

# US PIV
civ piv
```

## Architecture

*   **`civ::apdu`**: Low-level APDU command builders.
*   **`civ::controller`**: High-level logic for each card type (JpkiController, PivController, etc.).
*   **`civ::reader`**: Abstraction for PC/SC (Native) and WebUSB (Browser) readers.

## License

MIT / Apache-2.0
