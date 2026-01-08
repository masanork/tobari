# civ (Citizen Identity Verification)

**civ** is a universal Rust library for interacting with government-issued smart cards (National Designators, ePassports, etc.). It abstracts the complexity of ISO 7816-4 APDUs, PC/SC, and cryptographic protocols into a unified, high-level API.

It is designed to be the foundational "driver layer" for building Digital Identity Wallets, Authentication Services, and KYC tools.

## ✨ Features

- **Unified API**: access different card types (JPKI, Driver's License, ePassport) through a consistent interface.
- **Cross-Platform**: Built on pure Rust, works on `macOS`, `Linux`, `Windows` (PC/SC) and `Web` (WebUSB - WIP).
- **Standards Compliant**: Implements ISO 7816-4, ICAO 9303 (BAC/PACE), and various national specifications.
- **Type-Safe**: Leverages Rust's type system to prevent common errors in APDU construction and parsing.

## 💳 Supported Cards

| Card Type | Region | Standard | Features |
|---|---|---|---|
| **JPKI (My Number Card)** | 🇯🇵 Japan | ISO 7816 | Auth, Sign, 4 attributes, Face Photo, MyNumber |
| **Driver's License** | 🇯🇵 Japan | ISO 7816 | Data Reading, PIN Verify, PIN Unblock (WIP) |
| **Residence Card** | 🇯🇵 Japan | ISO 7816 | Read Address, Period of Stay |
| **ePassport** | 🌏 Global | ICAO 9303 | BAC (Basic Access Control), PACE (Planned) |
| **PIV (Gov ID)** | 🇺🇸 USA | NIST FIPS 201 | Auth, Sign (Planned) |

## 📦 Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
civ = "0.1"
```

## 📖 Usage (Library)

**Reading basic information from a Japanese My Number Card:**

```rust
use civ::{CardReader, PcscReader, JpkiController};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Detect and connect to a reader
    let mut reader = PcscReader::new()?;
    reader.connect()?;

    // 2. Initialize JPKI Controller
    let mut jpki = JpkiController::new(reader);

    // 3. Read specific data (e.g., My Number) with PIN
    let pin = "1234"; // User input
    let my_number = jpki.read_mynumber(pin).await?;
    
    println!("My Number: {}", my_number);

    Ok(())
}
```

## 🛠 Usage (CLI)

`civ` comes with a handy CLI tool for testing and debugging cards.

```bash
# Read My Number (requires 4-digit PIN)
civ jpki num --pin 1234

# Read Face Photo to a file
civ jpki attr --photo face.jp2

# Check ID Card PIN retry counter
civ jpki retries
```

## 📚 Documentation

- **[Identity Scheme Analysis](docs/IDENTITY_SCHEME_ANALYSIS.md)**: Deep dive into global ID architectures (RSA vs ECC vs PQC).
- **[JPKI Spec](docs/jpki.md)**: Details on Japanese Public Key Infrastructure.
- **[JPDL Spec](docs/jpdl.md)**: Japanese Driver's License structure.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under either of

 * Apache License, Version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
 * MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.
