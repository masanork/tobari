# Holder Binding (Device Signature)

Tobari supports **Holder Binding**, a security mechanism that binds a Verifiable Presentation (VP) to the holder's device. This prevents **replay attacks** (where a stolen credential file is presented by an attacker) and **phishing attacks** (where a user is tricked into presenting to a malicious verifier).

This implementation mimics the **ISO 18013-5 mdoc** standard (Device Authentication) and **ISO 18013-7 (OID4VP)** for session handling.

## How it Works

1.  **Issuance (Registration)**:
    - The holder generates a key pair (Device Key) on their device (e.g., via Passkey).
    - The **Public Key** is sent to the Issuer and embedded into the **Mobile Security Object (MSO)** of the credential.
    - The MSO is signed by the Issuer. Now the credential "knows" its legitimate owner's device.

2.  **Presentation (Handover)**:
    - When presenting to a Verifier, the Verifier provides a **Nonce**, **Client ID**, and **Response URI**.
    - The Holder constructs a `SessionTranscript` containing these values (hashed for privacy).
    - The Holder signs a `DeviceAuthentication` structure (containing the SessionTranscript) using their **Private Device Key**.
    - This signature is attached to the VP as `deviceSigned`.

3.  **Verification**:
    - The Verifier parses the MSO to retrieve the Device Public Key.
    - The Verifier verifies the `deviceSigned` signature using the Device Public Key.
    - The Verifier confirms that the signed `SessionTranscript` matches the current session (Nonce, ClientID, URI).

## Usage via CLI

### 1. Generate Credential (Issuance)
When generating a Tobari credential, a Device Key is automatically generated (simulating a device registration). The private key is saved to `device-key.json`.

```bash
bun run examples/juminhyo/gen-tobari.ts
# Output: 
# - examples/juminhyo/juminhyo.cose (Credential with embedded public key)
# - device-key.json (Holder's private key)
```

### 2. Present Credential (VP Generation)
Use `present-cli` to create a Verifiable Presentation. You can selectively disclose fields and bind the VP to a specific session.

```bash
bun run present:cli <input.cose> <output.cose> \
  --fields=世帯主氏名,交付年月日 \
  --nonce=xyz123random \
  --audience=verifier.example.com \
  --response-uri=https://verifier.example.com/callback
```

- `--fields`: Comma-separated list of fields to disclose.
- `--nonce`: Random challenge from the verifier.
- `--audience`: Client ID of the verifier.
- `--response-uri`: The URI where the response is being sent (OID4VP).

### 3. Verify VP
Use `verify-cli` to verify the VP, including the Holder Binding signature.

```bash
bun run verify:cli <vp.cose> [issuer-public-key.json]
```

Output example:
```
------------------------------------------
🔒 Holder Binding Verification (Device Signed)
✅ Device Signature: VALID

   [OID4VP Session Data]
   Nonce: xyz123random
   ClientID Hash (SHA-256): ...
   ResponseURI Hash (SHA-256): ...
------------------------------------------
```
