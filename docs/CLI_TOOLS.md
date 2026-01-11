# CLI Tools

Tobari provides powerful command-line tools for development and operations.

## Overview

The toolkit includes the following main components:

### 1. `civ` (Citizen Identity Verification)
A Rust-based CLI for reading and verifying various hardware identity cards.
- **Hardware Support**: JPKI (My Number), ePassport (ICAO 9303), MyKad, Thai ID, etc.
- **Demo Mode**: Simulate card reading without physical hardware.
- **Output**: Detailed identity information in text or JSON format.

### 2. `tobari` (Form & Credential Processor)
The primary CLI for processing schema-driven forms and generating machine-readable documents.
- **Form Generation**: Generate interactive HTML forms from YAML schemas.
- **Signing**: Sign form data using ECDSA (P-384) or BBS+ signatures.
- **Selective Disclosure**: Create SD-CBOR presentations from signed documents.

## Installation

### From Source
```bash
# Install civ
cd packages/civ
cargo install --path .

# Install tobari processor
bun install
# (Linking/Alias configuration)
```

## Basic Usage

### Verify an Identity Card (Demo Mode)
```bash
civ --demo id --type jpki --pin 1234
```

### Generate a Form
```bash
tobari gen --schema examples/ininjo/ininjo.yaml --output ininjo.html
```

### Process and Sign Data
```bash
tobari sign --data data.json --key private.key --output signed.cbor
```

### Generate COSE with PQC Countersign
```bash
bun run tobari:gen \
  --schema examples/juminhyo/juminhyo.yaml \
  --data examples/juminhyo/juminhyo-data.yaml \
  --out examples/juminhyo/juminhyo.cose \
  --issuer-private-key examples/juminhyo/issuer-private-key.json \
  --pqc
```
