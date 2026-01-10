# Design Policy for Encryption and User Consent

This document outlines the principles for protecting credential data within the `civ` library and the presentation flow involving explicit user consent (Unlock).

## 1. Core Principles

### Strong Device Binding
- Credential data is encrypted using keys tied to the device's hardware security module (HSM) such as Secure Enclave, StrongBox, or FIDO Keys.
- We adopt a "Destructive Loss" design: **"If the device is lost or broken, the data is lost."** This approach prevents unauthorized cloning of credentials and tightly couples physical "possession" with digital proof.

### Adoption of HPKE (Hybrid Public Key Encryption)
- We fully adopt the HPKE (RFC 9180) standard for a interoperable and secure hybrid encryption.
- HPKE is used for both storage protection (Encryption at Rest) and communication channels during presentation (Encryption in Transit).

### Consent via Explicit Unlock
- Decryption and signing of data are impossible unless the user performs a biometric check (FaceID/TouchID) or enters a PIN to release (Unlock) the private key within the HSM.
- This Unlock action is defined as "Explicit Consent for Presentation."

## 2. Recommended Workflow

### A. Encryption at Rest (Issuance/Storage)
1. Generate an HPKE key pair ($SK_{holder}, PK_{holder}$) within the device.
2. Configure $SK_{holder}$ to be protected by the HSM, requiring user authentication (e.g., FIDO) for every use.
3. Encrypt the credential data $M$ received from the Issuer using $PK_{holder}$ before saving it to local storage.

### B. Presentation / Transfer
1. **Unlock**: The user authenticates, temporarily allowing the HSM to use $SK_{holder}$.
2. **Decrypt**: Use $SK_{holder}$ to decrypt the stored data and expand the raw credential into memory.
3. **VP Creation**: Construct a Verifiable Presentation (VP) from the decrypted data. Attach a device signature (Holder Binding) as required.
4. **Target Encryption**: Obtain the Verifier's public key $PK_{verifier}$ and encrypt the VP using HPKE.
5. **Send**: Transmit the encrypted VP to the Verifier.

## 3. Future Considerations

- **Leveraging FIDO2 HMAC-Secret Extension**: Implementing key derivation via WebAuthn/FIDO2 for cross-platform hardware-backed encryption.
- **Memory Safety**: Minimizing the duration raw decrypted data exists in memory and ensuring immediate zeroization after use.
- **Protocol Alignment**: Compatibility with existing protocols like OID4VP (OpenID for Verifiable Presentations).