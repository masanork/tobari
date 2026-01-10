# Encryption and Key Management Specification

This document defines the technical implementation details for encryption and hardware-backed security in the `civ` library.

## 1. Cryptographic Primitives

We adopt **HPKE (Hybrid Public Key Encryption - RFC 9180)** as the primary mechanism for asynchronous encryption.

### Recommended Ciphersuite
| Component | Algorithm | Reason |
|-----------|-----------|--------|
| **KEM**   | `DHKEM(P-256, HKDF-SHA256)` | Native support in Secure Enclave, StrongBox, and FIDO2. |
| **KDF**   | `HKDF-SHA256` | Standardized and high-performance. |
| **AEAD**  | `AES-128-GCM` | Hardware acceleration support on most modern CPUs. |

## 2. Key Management Tiers

### A. Hardware-Backed Root Key (Long-term)
- **Type**: NIST P-256 (secp256r1)
- **Location**: Hardware Security Module (HSM) / Secure Enclave.
- **Access Control**: Biometric (FaceID/TouchID), User Presence (FIDO2), or PIN.
- **Capability**: Can perform ECDH (for HPKE decryption) and ECDSA (for Holder Binding).

### B. Ephemeral Keys (Transaction-specific)
- **Type**: Matching the KEM of the HPKE suite.
- **Location**: Generated in memory for a single encryption/decryption task.
- **Capability**: Used to derive the shared secret for symmetric encryption.

## 3. Storage Format (At-Rest)

Encrypted credentials MUST be stored in a format that encapsulates HPKE parameters:

```json
{
  "version": "1.0",
  "alg": "HPKE-Base-P256-SHA256-AES128GCM",
  "kid": "device-key-id-001",
  "enc": "<ephemeral_public_key_bytes>",
  "ciphertext": "<encrypted_payload>",
  "tag": "<auth_tag_bytes>"
}
```

## 4. Operational Flows

### 4.1. Secure Storage (Issuance)
1. Request a hardware-backed Public Key ($PK_{dev}$) from the device.
2. The Issuer encrypts the credential $M$ using $PK_{dev}$ via `HPKE.SetupBaseI`.
3. The resulting ciphertext and ephemeral key `enc` are stored locally.

### 4.2. Authorization and Presentation (Unlock)
1. **Challenge**: The Verifier sends a random challenge and their Public Key ($PK_{verifier}$).
2. **User Consent**: The app triggers a biometric prompt to unlock $SK_{dev}$.
3. **Internal Decryption**:
   - $SK_{dev}$ is used inside the HSM to derive the shared secret.
   - The credential $M$ is decrypted into memory (temporary).
4. **Presentation Construction**:
   - Apply Selective Disclosure (e.g., SD-CBOR) to $M$.
   - Create a `DeviceSigned` object containing the selected fields.
5. **Targeted Re-encryption**:
   - Encrypt the final presentation for $PK_{verifier}$ using HPKE.
6. **Zeroization**: Immediately clear raw $M$ from memory.

## 5. Crypto Agility and Post-Quantum Readiness

To ensure the long-term viability of the `civ` library, we must account for the transition to **Post-Quantum Cryptography (PQC)**. While NIST P-256 is the current standard for hardware compatibility, we will design the system to be "Agile."

### 5.1. Hybrid Encryption (Classical + PQC)
We aim to support a hybrid KEM approach, combining a classical elliptic curve (P-256 or X25519) with a post-quantum algorithm (e.g., ML-KEM / Kyber).

- **Current Goal**: P-256 only (Hardware-backed).
- **PoC Goal**: Implement a software-based hybrid KEM (`X25519 + ML-KEM-768`) to measure overhead.
- **Data Size Evaluation**: We will evaluate the impact of PQC on:
    - **Public Key Size**: P-256 (65 bytes) vs ML-KEM-768 (~1184 bytes).
    - **Encapsulated Key (Ciphertext)**: ~32 bytes vs ~1088 bytes.
    - **Performance**: Latency of key generation and encapsulation in WASM/Mobile environments.

### 5.2. Pluggable KEM Interface
The implementation should wrap HPKE logic in a trait that allows switching ciphersuites based on credential metadata or verifier requirements.

## 6. Security Requirements

- **No Key Export**: The private root key $SK_{dev}$ MUST NEVER leave the hardware security boundary.
- **Memory Protection**: Decrypted raw data MUST be handled with `Zeroize` traits in Rust to ensure memory is cleared.
- **Domain Separation**: HPKE `info` strings MUST be used to separate different use cases (e.g., "Storage" vs "Transfer").
