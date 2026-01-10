# civ (Citizen Identity Verification)

**civ** is a universal Rust library for interacting with government-issued smart cards (National Designators, ePassports, etc.). It abstracts the complexity of ISO 7816-4 APDUs, PC/SC, Secure Messaging (SM), and cryptographic verification into a unified, high-level API.

It is designed to be the foundational "driver layer" for building Digital Identity Wallets, Authentication Services, and KYC tools.

## ✨ Features

- **Unified Identity Model**: Access data from different card types (JPKI, Driver's License, Residence Card, ePassport) through a single, consistent `CitizenIdentity` interface.
- **Secure Messaging**: Implements robust secure channels including **BAC** (Basic Access Control), **PACE** (Password Authenticated Connection Establishment), and card-specific protocols (e.g., JPKI, JPDL).
- **Verification**: Built-in support for **Passive Authentication** (Integrity Check via Hash/Signature) to ensure data authenticity.
- **Cross-Platform**: Built on pure Rust, works on `macOS`, `Linux`, `Windows` (PC/SC) and `Web` (WebAssembly/WebUSB - Experimental).
- **Standards Compliant**: Implements **ISO 7816-4 APDUs** over **ISO 14443** (NFC), ICAO 9303, and national specifications (e.g., NPA Japan).

## 💳 Supported Cards

| Card Type | Region | Standard | Features | Verification |
|---|---|---|---|---|
| **JPKI (My Number Card)** | 🇯🇵 Japan | ISO 7816-4 (APDU) | Auth, Sign, Face Photo, MyNumber | ✅ |
| **Driver's License (JPDL)** | 🇯🇵 Japan | NPA Spec (ISO 7816-4) | Common Data, PIN Verify, Photo | ⚠️ *(Partial)* |
| **MyNa-Menkyo** | 🇯🇵 Japan | NPA Spec (Modified) | License Info on MyNumber Card | ⚠️ *(Untested)* |
| **Residence Card** | 🇯🇵 Japan | ISO 7816-4 (APDU) | Address, Period of Stay | ⚠️ *(Partial)* |
| **ePassport** | 🌏 Global | ICAO 9303 | BAC (Basic Access Control), PACE | ⚠️ *(Partial)* |
| **Thai National ID** | 🇹🇭 Thailand | Custom APDU | Personal Info, Photo | ⚠️ *(Untested)* |
| **MyKad** | 🇲🇾 Malaysia | Custom APDU | Personal Info, Photo, Fingerprint | ⚠️ *(Untested)* |
| **PIV (Gov ID)** | 🇺🇸 USA | FIPS 201 | Auth, Sign | 🚧 |

> **Note**: Currently, only **JPKI (My Number Card)** has been extensively verified with physical cards. Other card types (Driver's Licenses, Passports, etc.) are implemented based on specifications and tested against **Mock Cards**, but real hardware verification is still in progress or insufficient. Contributions and testing reports are welcome!

## 📦 Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
civ = "0.1"
```

## 📖 Usage (Library)

**Unified Identity Reading:**

The core of `civ` is the `IdentityController` trait, which allows you to read identity information regardless of the underlying card technology.

```rust
use civ::{PcscReader, CardReader, IdentityController};
use civ::{JpkiController, DriversLicenseController, PassportController};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 1. Detect and connect to a reader
    let mut reader = PcscReader::new()?;
    reader.connect()?;

    // 2. Select Controller based on Card Type (Simplified detection)
    // In a real app, you might auto-detect based on AID selection.
    let mut controller: Box<dyn IdentityController> = if /* condition */ {
        Box::new(JpkiController::new(reader))
    } else {
        Box::new(PassportController::new(reader))
    };

    // 3. Provide Credentials (if needed)
    // JPKI: 4-digit PIN for basic info
    // Passport: MRZ or CAN for BAC/PACE
    controller.provide_pin("auth", "1234").await?; 
    // or
    controller.provide_pin("mrz", "123456...").await?;

    // 4. Verify (Passive Authentication)
    if controller.verify().await? {
        println!("Card Integrity Verified!");
    }

    // 5. Read Identity
    let identity = controller.read_identity().await?;
    
    println!("Name: {}", identity.full_name);
    println!("DOB:  {}", identity.birth_date);
    println!("ID:   {}", identity.identity_number);

    Ok(())
}
```

## 🛠 Usage (CLI)

`civ` provides a powerful CLI for testing, debugging, and demonstrating card interactions. It includes a **Mock Mode** for development without physical cards.

### Unified Identity Command

Read identity from any supported card (auto-detected or forced):

```bash
# Read from real card (JPKI, DL, Passport...)
civ id --pin 1234

# Read from Passport (using MRZ/CAN)
civ id --type passport --mrz "123456..."
```

### Demo / Mock Mode

You can try the library features without a card reader using the `--demo` flag.

```bash
# Demo JPKI (Mock)
civ --demo id --type jpki
# Output: Name: Taro, DOB: 1990-01-01...

# Demo Driver's License (Mock) with Integrity Verification
civ --demo id --type dl --verify
# Output: ... Verified: YES

# Demo Passport (Mock) using BAC
civ --demo id --type passport
```

### Card-Specific Commands

Low-level commands are also available for specific operations.

```bash
# JPKI: Read Certificate
civ jpki cert --type sign --output sign_cert.der

# JPKI: Check PIN Retry Counters
civ jpki retries
```

## 📚 Documentation

- **[Identity Scheme Analysis](docs/IDENTITY_SCHEME_ANALYSIS.md)**: Deep dive into global ID architectures (RSA vs ECC vs PQC).
- **[JPKI Spec](docs/jpki.md)**: Details on Japanese Public Key Infrastructure.
- **[JPDL Spec](docs/jpdl.md)**: Japanese Driver's License structure.
- **[MyNa-Menkyo Spec](docs/jpdlmnc.md)**: My Number Driver's License structure.
- **[JPRC Spec](docs/jprc.md)**: Japanese Residence Card structure.
- **[Passport Spec](docs/icao9303.md)**: ePassport (ICAO 9303) implementation details.
- **[Thai ID Spec](docs/thai.md)**: Thai National ID Card structure.
- **[MyKad Spec](docs/mykad.md)**: Malaysian Identity Card structure.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under either of

 * Apache License, Version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
 * MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.