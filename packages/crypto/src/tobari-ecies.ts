
import { base64url } from './utils';

// Helper functions to match original implementation usage
const bytesToBase64Url = (b: Uint8Array) => base64url.encode(b);
const base64UrlToBytes = (s: string) => base64url.decode(s);

/**
 * Custom ECIES implementation compatible with Tobari signer-macos
 * 
 * Scheme:
 * 1. Generate Ephemeral Key Pair (P-256)
 * 2. ECDH(Ephemeral Private, Recipient Public) -> Shared Secret
 * 3. HKDF-SHA256(Secret, Salt="tobari-ecies-salt", Info="tobari-ecies-info") -> AES Key (32 bytes)
 * 4. AES-GCM-256(Key, Random IV, Plaintext)
 */

export interface EncryptedMessage {
    ephemeralPublicKey: string; // Base64URL
    ciphertext: string;         // Base64URL
    iv: string;                 // Base64URL
    tag: string;                // Base64URL
}

const SALT = new TextEncoder().encode("tobari-ecies-salt");
const INFO = new TextEncoder().encode("tobari-ecies-info");

export async function encryptTobariEcies(
    recipientPublicKey: CryptoKey,
    plaintext: Uint8Array
): Promise<EncryptedMessage> {
    // 1. Generate Ephemeral Key Pair
    const ephemeralKeyPair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"]
    );

    // 2. Derive Shared Secret
    const sharedSecretBits = await crypto.subtle.deriveBits(
        { name: "ECDH", public: recipientPublicKey },
        ephemeralKeyPair.privateKey,
        256
    );

    // 3. HKDF Derivation
    const hkdfKey = await crypto.subtle.importKey(
        "raw",
        sharedSecretBits,
        { name: "HKDF" },
        false,
        ["deriveBits"]
    );

    const aesKeyBits = await crypto.subtle.deriveBits(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: SALT as unknown as BufferSource,
            info: INFO as unknown as BufferSource
        },
        hkdfKey,
        256 // 32 bytes for AES-256
    );

    const aesKey = await crypto.subtle.importKey(
        "raw",
        aesKeyBits,
        { name: "AES-GCM" },
        false,
        ["encrypt"]
    );

    // 4. Encrypt with AES-GCM
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96 bits
    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv, tagLength: 128 },
        aesKey,
        plaintext as unknown as BufferSource
    );

    const encryptedBytes = new Uint8Array(encryptedBuffer);
    const tagLength = 16;
    const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - tagLength);
    const tag = encryptedBytes.slice(encryptedBytes.length - tagLength);

    // 5. Export Ephemeral Public Key
    const ephemeralPubJwk = await crypto.subtle.exportKey("jwk", ephemeralKeyPair.publicKey);
    // Convert JWK to Raw uncompressed format (0x04 || x || y)
    const x = base64UrlToBytes(ephemeralPubJwk.x!);
    const y = base64UrlToBytes(ephemeralPubJwk.y!);
    const rawPub = new Uint8Array(65);
    rawPub[0] = 0x04;
    rawPub.set(x, 1);
    rawPub.set(y, 33);

    return {
        ephemeralPublicKey: bytesToBase64Url(rawPub),
        ciphertext: bytesToBase64Url(ciphertext),
        iv: bytesToBase64Url(iv),
        tag: bytesToBase64Url(tag)
    };
}

export async function decryptTobariEcies(
    recipientPrivateKey: CryptoKey,
    encrypted: EncryptedMessage
): Promise<Uint8Array> {
    // 1. Import Ephemeral Public Key
    const rawPub = base64UrlToBytes(encrypted.ephemeralPublicKey);
    if (rawPub[0] !== 0x04 || rawPub.length !== 65) {
        throw new Error("Invalid ephemeral public key format (expected raw uncompressed)");
    }
    const x = rawPub.slice(1, 33);
    const y = rawPub.slice(33, 65);
    const jwk = {
        kty: "EC",
        crv: "P-256",
        x: bytesToBase64Url(x),
        y: bytesToBase64Url(y)
    };
    const ephemeralPublicKey = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        []
    );

    // 2. Derive Shared Secret
    const sharedSecretBits = await crypto.subtle.deriveBits(
        { name: "ECDH", public: ephemeralPublicKey },
        recipientPrivateKey,
        256
    );

    // 3. HKDF Derivation
    const hkdfKey = await crypto.subtle.importKey(
        "raw",
        sharedSecretBits,
        { name: "HKDF" },
        false,
        ["deriveBits"]
    );

    const aesKeyBits = await crypto.subtle.deriveBits(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: SALT as unknown as BufferSource,
            info: INFO as unknown as BufferSource
        },
        hkdfKey,
        256
    );

    const aesKey = await crypto.subtle.importKey(
        "raw",
        aesKeyBits,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
    );

    // 4. Decrypt with AES-GCM
    const ciphertext = base64UrlToBytes(encrypted.ciphertext);
    const iv = base64UrlToBytes(encrypted.iv);
    const tag = base64UrlToBytes(encrypted.tag);

    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext);
    combined.set(tag, ciphertext.length);

    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as unknown as BufferSource, tagLength: 128 },
        aesKey,
        combined as unknown as BufferSource
    );

    return new Uint8Array(decryptedBuffer);
}
