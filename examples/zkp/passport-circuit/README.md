# Passport Age Verification ZK Circuit

This project demonstrates a Zero-Knowledge Proof (ZKP) circuit that proves a user is over a certain age using their Passport's Machine Readable Zone (MRZ) data, without revealing the actual birth date or passport number.

## Features

- **Privacy Preserving**: Proves `Age >= Threshold` (e.g., 18) while keeping the exact birth date hidden.
- **Integrity Bound**: Binds the proof to a specific Passport by checking the SHA-256 hash of the MRZ.
- **Automatic Century Handling**: Correct外部ly handles the 2-digit year format in MRZ (YYMMDD) based on the current date.
- **Sybil Resistance (Nullifier)**: Generates a unique, deterministic nullifier from the Passport Number and a user secret, allowing for duplicate detection without revealing the identity.

## Circuit Logic (`passport.circom`)

1.  **SHA-256 Verification**: Verifies that the provided raw MRZ bits match the public `mrz_hash`.
2.  **Attribute Extraction**: Extracts Birth Date digits from the correct offsets in the TD3 MRZ format (Line 2, characters 14-19).
3.  **Age Verification**:
    -   Converts ASCII bits to numeric YY, MM, DD.
    -   Determines the full birth year (e.g., `80` -> `1980`, `05` -> `2005`) relative to the `current_date`.
    -   Compares the calculated age against the `age_threshold`.
    -   Outputs a single boolean signal `is_older_than_threshold`.
4.  **Nullifier Generation**: Computes `Hash(PassportNumber + UserSecret)` to produce a persistent but private identifier.

## How to Run

### 1. Install Dependencies

```bash
bun install
```

### 2. Generate Input

This script generates a dummy MRZ (Taro Tobari, born 1980) and calculates the necessary bits and hashes for the circuit.

```bash
bun run index.js
```

This will create `input.json`.

### 3. Compile and Prove (Requires `circom` and `snarkjs`)

Note: You need to have `circom` installed on your system.

```bash
# Compile circuit
circom passport.circom --r1cs --wasm --sym

# (Optional) Generate Witness using the generated Wasm
node passport_js/generate_witness.js passport_js/passport.wasm input.json witness.wtns
```

## Security Note

In a real-world scenario, the `mrz_hash` would be verified against the **Signed Data (SOD)** of the passport, which is signed by the Issuing State's CSCA. This circuit focuses on the *data minimization* aspect (Selective Disclosure / Predicate Proof) once the integrity of the MRZ is established.