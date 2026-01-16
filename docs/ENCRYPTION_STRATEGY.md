# Design Policy for Encryption and User Consent

This document outlines the principles for protecting credential data within the `civ` library and the presentation flow involving explicit user consent (Unlock).

## 1. Core Principles

### Strong Device Binding
- Credential data is encrypted using keys tied to the device's hardware security module (HSM) such as Secure Enclave, StrongBox, or FIDO Keys.
- We adopt a "Destructive Loss" design: **"If the device is lost or broken, the data is lost."** This approach prevents unauthorized cloning of credentials and tightly couples physical "possession" with digital proof.

### Hybrid Strategy: Portability & Security
To balance strong hardware binding with cross-device portability (e.g., using a single YubiKey across Mac and Windows), we adopt a hybrid strategy supporting two key derivation methods:
1.  **WebAuthn PRF (Portable)**: Deriving keys from FIDO2/WebAuthn authenticators using the PRF (Pseudo-Random Function) extension. This allows "Roaming Authenticators" (like YubiKeys) to decrypt data on any supported platform.
2.  **Platform Native (Device-Bound)**: Using platform-specific hardware keys (Secure Enclave on macOS/iOS, StrongBox on Android) via HPKE/ECIES.

### Consent via Explicit Unlock
- Decryption and signing of data are impossible unless the user performs a biometric check (FaceID/TouchID) or enters a PIN to release (Unlock) the private key within the HSM.
- This Unlock action is defined as "Explicit Consent for Presentation."

## 2. Encryption Architecture (The Envelope)

We utilize a **Key Wrapping** architecture. The credential data is encrypted with a random **Document Encryption Key (DEK)**, which is then encrypted (wrapped) by one or more **Key Encryption Keys (KEK)** derived from different sources.

### Data Structure (Concept)
```json
{
  "alg": "AES-256-GCM",      // Algorithm for DEK -> Payload
  "iv": "...",               // IV for DEK
  "ciphertext": "...",       // Encrypted Credential Payload
  "recipients": [            // Array of wrapped DEKs
    {
      "type": "webauthn-prf",
      "kid": "YubiKey-5C-NFC",
      "salt": "random-salt", // Used in PRF input
      "encrypted_key": "..." // DEK wrapped with KEK_prf
    },
    {
      "type": "hpke-p256",   // Platform Native
      "kid": "MacBook-Local",
      "enc": "...",          // Ephemeral Public Key
      "encrypted_key": "..." // DEK wrapped with KEK_ecdh
    }
  ]
}
```

## 3. Recommended Workflow

### A. Encryption at Rest (Issuance/Storage)
1. **Generate DEK**: Create a random 256-bit symmetric key.
2. **Encrypt Payload**: Encrypt the credential data using the DEK (AES-GCM).
3. **Wrap DEK (Method 1: WebAuthn PRF)**:
   - Generate a random `salt`.
   - Request PRF output from the authenticator using the `salt`.
   - Derive $KEK_{prf}$ from the PRF output (via HKDF).
   - Encrypt DEK with $KEK_{prf}$.
4. **Wrap DEK (Method 2: Native HPKE)**:
   - Obtain the device's public key $PK_{device}$.
   - Encrypt DEK using HPKE ($PK_{device}$).
5. **Save**: Store the "Envelope" (ciphertext + recipients) locally.

### B. Decryption (Unlock)
1. **User Consent**: The user authenticates (Biometrics/PIN).
2. **Unwrap DEK**:
   - **If PRF**: Replay the PRF request with the stored `salt` to get the same output -> derive $KEK_{prf}$ -> decrypt DEK.
   - **If HPKE**: Use the device private key to decrypt the encapsulated key -> get DEK.
3. **Decrypt Payload**: Use the restored DEK to decrypt the credential data.

## 4. Cross-Platform & Code Sharing

To ensure security consistency across Tauri (macOS/Windows/Linux) and Native (iOS/macOS) apps:

- **Core Logic (Rust/Wasm)**:
  - Encryption formats (Envelope parsing/creation).
  - Key derivation (HKDF).
  - Symmetric encryption (AES-GCM).
- **Platform Layer (Swift/TS)**:
  - Interfacing with WebAuthn API (Browser/OS).
  - Interfacing with Secure Enclave / Keychain.

## 5. Future Considerations

- **Multi-Device Sync**: Allowing users to add new "Recipients" (e.g., adding a new iPhone's key to an existing document) without re-issuance, by decrypting and re-wrapping the DEK.
- **Post-Quantum Readiness**: The Envelope structure allows adding PQC-based recipients (e.g., `hpke-mlkem768`) seamlessly in the future.
