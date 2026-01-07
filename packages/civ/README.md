# CIV (Citizen Identity Verification) Library

A unified Rust library for accessing and verifying various Citizen Identity Cards.
Hardware access is powered by PC/SC (Native) or WebUSB (Web).

## [Status Update] 2026-01-07
- **JPKI (My Number Card)**: 
    - ✅ **Working**: Basic 4 Info (Name, Addr, DOB, Gender) and My Number retrieval.
    - ✅ **Working**: User Authentication and Digital Signature generation.
    - ✅ **Working**: PIN Retry count monitoring for all PIN types.
    - ❌ **In Progress**: **Face Photo** retrieval. Encountering authentication hurdles in "Visual AP". Password A (12-digit) and Password B (14-digit) flows are implemented but pending real-world success.
- **Hardware**: Confirmed working with ACS ACR39U and similar PC/SC Type-B readers on macOS.

---

## 🛠 CLI Usage

### 🇯🇵 JPKI (My Number Card)

**⚠️ Safety First: Check PIN Retries**
```bash
cargo run -- jpki retries
```

**Read Card Attributes**
```bash
cargo run -- jpki attr
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

- [mynacard.md](docs/mynacard.md): Compact technical specification (AIDs, FIDs, APDUs).
- [implementation_insights.md](docs/implementation_insights.md): Lessons learned regarding security models and the "Password A/B" structure.
- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md): Detailed progress report by card type.

## License
MIT / Apache-2.0
