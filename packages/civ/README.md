# CIV (Citizen Identity Verification) Library

A unified Rust library for accessing and verifying various Citizen Identity Cards.
Hardware access is powered by PC/SC (Native) or WebUSB (Web).

## [Status Update] 2026-01-07
- **JPKI (My Number Card)**: 
    - ✅ **Working**: Basic 4 Info (Name, Addr, DOB, Gender) and My Number retrieval.
    - ✅ **Working**: User Authentication and Digital Signature generation.
    - ✅ **Working**: PIN Retry count monitoring for all PIN types.
    - ✅ **Working**: **Face Photo** retrieval via Surface-AP.
- **Hardware**: Confirmed working with ACS ACR39U and similar PC/SC Type-B readers on macOS.

---

## 🛠 CLI Usage

### 🇯🇵 JPKI (My Number Card)

**⚠️ Safety First: Check PIN Retries**
```bash
cargo run -- jpki retries
```

**Read Card Attributes (including Face Photo)**
```bash
cargo run -- jpki attr --photo my_photo.jp2
```

**Read Individual Number (My Number)**
```bash
cargo run -- jpki num
```

**Digital Signature**
```bash
# Authenticate (4-digit PIN)
cargo run -- jpki sign --type auth --data "challenge"

# Sign Document (6-16 alphanum password)
cargo run -- jpki sign --type sign --data "document_hash"
```

---

## 📚 Technical Documentation

- [docs/mynacard.md](docs/mynacard.md): Compact technical specification (AIDs, FIDs, APDUs).
- [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md): Detailed progress report by card type.
- [docs/ROADMAP.md](docs/ROADMAP.md): Future plans for the CIV library.

## License
MIT / Apache-2.0
