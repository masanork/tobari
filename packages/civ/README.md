# CIV (Citizen Identity Verification) Library

A unified Rust library for accessing and verifying various Citizen Identity Cards.
Originally focused on Japanese JPKI (My Number Card), it has expanded to support:

> [!WARNING]
> **Experimental Status**: This library is in an experimental stage. Implementation is based on specifications and simulator-bound testing; **testing with actual hardware (NFC readers/smart cards) has not yet been performed.** Using this for real-world identity verification requires extreme caution and physical validation.


*   **JPKI (Japan My Number Card)**
    *   Auth/Sign Certificates
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
