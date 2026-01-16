# Encryption and Key Management Specification

This document defines the technical implementation details for encryption and hardware-backed security in the `civ` library, supporting both WebAuthn PRF and Native HPKE.

## 1. Cryptographic Primitives

### Symmetric Encryption (Payload)
- **Algorithm**: `AES-256-GCM`
- **Purpose**: Encrypting the actual credential data (Document Encryption Key - DEK).
- **IV**: Random 96-bit (12 bytes).
- **Tag**: 128-bit (16 bytes) authentication tag.

### Key Derivation & Wrapping
We use a **Key Wrapping** scheme where the DEK is encrypted by a Key Encryption Key (KEK).

#### Method A: WebAuthn PRF (Portable)
- **Input**: Random `salt` (32 bytes).
- **Primitive**: `HMAC-SHA-256` (PRF extension output).
- **KDF**: `HKDF-SHA256`
  - Input Keying Material (IKM): PRF Output.
  - Salt: (None or specific context).
  - Info: "tobari-prf-kek-v1".
- **Wrapping**: `AES-256-GCM` (Key Wrap).

#### Method B: HPKE (Platform Native)
- **Algorithm**: `DHKEM(P-256, HKDF-SHA256)` + `AES-256-GCM`.
- **Wrapping**: The DEK is encrypted directly as the HPKE plaintext.

## 2. Data Structure (The Envelope)

Encrypted credentials MUST be stored in the following JSON format:

```json
{
  "version": "2.0",
  "alg": "AES-256-GCM",
  "iv": "<base64url_iv>",
  "ciphertext": "<base64url_payload>",
  "tag": "<base64url_tag>",
  "recipients": [
    {
      "type": "webauthn-prf",
      "kid": "<credential_id>",
      "salt": "<base64url_salt>",
      "iv": "<base64url_wrap_iv>",
      "encrypted_key": "<base64url_wrapped_dek>",
      "tag": "<base64url_wrap_tag>"
    },
    {
      "type": "hpke-p256",
      "kid": "<device_key_id>",
      "enc": "<base64url_ephemeral_pubkey>",
      "encrypted_key": "<base64url_wrapped_dek>",
      "tag": "<base64url_wrap_tag>" 
      // Note: In standard HPKE, 'tag' is part of ciphertext, 
      // but we may separate it depending on the library used. 
      // Standard HPKE output is just 'enc' and 'ciphertext'.
    }
  ]
}
```

## 3. Operational Flows

### 3.1. WebAuthn PRF Flow

#### Registration (Key Generation)
1. Call `navigator.credentials.create` with `extensions: { prf: {} }`.
2. Store the `credentialId`.

#### Wrapping (Encryption)
1. Generate `DEK` (32 bytes) and `salt` (32 bytes).
2. Call `navigator.credentials.get` with `extensions: { prf: { eval: { first: salt } } }`.
3. Receive `prfOutput` (32 bytes).
4. `KEK` = `HKDF(ikm=prfOutput, info="tobari-prf-kek-v1")`.
5. `encrypted_key` = `AES-GCM-Encrypt(key=KEK, plaintext=DEK)`.
6. Store `salt`, `iv`, `encrypted_key`, `tag` in the recipient block.

#### Unwrapping (Decryption)
1. Load `salt` from recipient block.
2. Call `navigator.credentials.get` with `extensions: { prf: { eval: { first: salt } } }`.
3. Receive `prfOutput` (32 bytes).
4. `KEK` = `HKDF(ikm=prfOutput, info="tobari-prf-kek-v1")`.
5. `DEK` = `AES-GCM-Decrypt(key=KEK, ciphertext=encrypted_key)`.

### 3.2. Native HPKE Flow (macOS/iOS)

#### Registration
1. Generate P-256 Key Pair in Secure Enclave.
2. Store Public Key.

#### Wrapping
1. Generate `DEK`.
2. `(enc, ciphertext)` = `HPKE.Seal(pk=DevicePubKey, info="tobari-hpke-kek-v1", plaintext=DEK)`.
3. Store `enc` and `ciphertext` (as `encrypted_key`) in the recipient block.

## 4. Crypto Agility

This "Envelope" structure allows adding Post-Quantum algorithms (e.g., `hpke-mlkem768`) as new recipient types without changing the payload encryption logic.