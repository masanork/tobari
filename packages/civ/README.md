# CIV (Citizen Identity Verification) Library

A unified Rust library for accessing and verifying various Citizen Identity Cards.
Hardware access is powered by PC/SC (Native) or WebUSB (Web).

## [Status Update] 2026-01-07
- **JPKI (My Number Card)**: 
    - Full support for **Face Photo** retrieval (direct access via Input Assistance AP).
    - Strict **BER-TLV** parsing for Basic 4 Info and My Number.
    - Safe PIN input (interactive prompt without echo).
    - PIN retry count check implemented.
    - High-level signing API for Auth and Digital Signature.
- **Hardware**: Confirmed working with standard PC/SC Type-B readers on macOS and Linux.

---

## 🛠 CLI Usage

The `civ` command-line tool provides a direct way to interact with cards.

### 🇯🇵 JPKI (My Number Card)

**⚠️ Safety First: Check PIN Retries**
Before entering PINs, check how many attempts are left to avoid locking the card.
```bash
cargo run -- jpki retries
```

**Read Card Attributes (Basic 4 Info & Photo)**
If you omit `--pin`, it will prompt you interactively.
```bash
# Read name, address, DOB, gender
cargo run -- jpki attr

# Read attributes and save face photo to a file
cargo run -- jpki attr --photo face.jp2
```

**Read Individual Number (My Number)**
```bash
cargo run -- jpki num
```

**Digital Signature**
- `auth`: User Authentication (4-digit PIN)
- `sign`: Digital Signature (6-16 alphanumeric password)
```bash
# Authenticate (Challenge-Response)
cargo run -- jpki sign --type auth --data "challenge_string"

# Sign Document
cargo run -- jpki sign --type sign --data "document_hash_or_string"
```

**Read Certificates**
```bash
cargo run -- jpki cert --type auth
cargo run -- jpki cert --type sign --output sign_cert.der
```

---

### 🪪 Other Cards

- **Driver's License**: `cargo run -- dl --command common`
- **Passport**: `cargo run -- ep --mrz "P<JPN..."`
- **Residence Card**: `cargo run -- rc --number "AB123456CD"`
- **US PIV**: `cargo run -- piv`

---

## 📚 Technical Documentation

For deep dives into implementation details:
- [mynacard.md](docs/mynacard.md): Compact technical specification of the My Number Card (AIDs, FIDs, APDUs).
- [implementation_insights.md](docs/implementation_insights.md): Key lessons learned regarding security models and reverse engineering.

## 🏗 Architecture

*   **`civ::apdu`**: Low-level APDU command builders.
*   **`civ::jpki`, `civ::piv`, etc.**: High-level controllers for specific card types.
*   **`civ::reader`**: Abstraction layer for PC/SC (Native) and WebUSB (Browser) readers.
*   **`civ::utils`**: Common utilities including a robust BER-TLV parser.

## License
MIT / Apache-2.0