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

## 5. Security Requirements

- **No Key Export**: The private root key $SK_{dev}$ MUST NEVER leave the hardware security boundary.
- **Memory Protection**: Decrypted raw data MUST be handled with `Zeroize` traits in Rust to ensure memory is cleared.
- **Domain Separation**: HPKE `info` strings MUST be used to separate different use cases (e.g., "Storage" vs "Transfer").
