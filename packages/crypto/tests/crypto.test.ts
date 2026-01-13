import { describe, it, expect } from 'bun:test';
import { createFormToken, verifyFormToken, COSE_ALG } from '../src';

describe('Crypto Package', () => {
    it('should sign and verify a form payload using ES256', async () => {
        // 1. Generate Key Pair
        const keyPair = await crypto.subtle.generateKey(
            {
                name: "ECDSA",
                namedCurve: "P-256"
            },
            true,
            ["sign", "verify"]
        );

        const payload = {
            userName: "test-user",
            answers: [1, 2, 3],
            meta: { timestamp: 123456789 }
        };

        // 2. Sign
        const token = await createFormToken(payload, keyPair.privateKey, {
            alg: COSE_ALG.ES256,
            kid: "key-1"
        });

        console.log("Generated Token:", token);
        expect(token).toBeString();
        expect(token.length).toBeGreaterThan(10);

        // 3. Verify
        const decoded = await verifyFormToken(token, keyPair.publicKey);

        // 4. Check content
        expect(decoded).toEqual(payload);
    });

    it('should perform ECIES encryption/decryption roundtrip', async () => {
        const { encryptTobariEcies, decryptTobariEcies } = await import('../src/tobari-ecies');

        // Recipient Key Pair (P-256 for ECDH)
        const recipientKeyPair = await crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveBits"]
        );

        const plaintext = new TextEncoder().encode("Hello, ECIES!");

        // 1. Encrypt
        const encrypted = await encryptTobariEcies(recipientKeyPair.publicKey, plaintext);
        expect(encrypted.ephemeralPublicKey).toBeDefined();
        expect(encrypted.ciphertext).toBeDefined();

        // 2. Decrypt
        const decrypted = await decryptTobariEcies(recipientKeyPair.privateKey, encrypted);
        expect(new TextDecoder().decode(decrypted)).toBe("Hello, ECIES!");
    });

    it('should fail verification with wrong key', async () => {
        const keyPair = await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            true, ["sign", "verify"]
        );
        const otherKeyPair = await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            true, ["sign", "verify"]
        );

        const token = await createFormToken({ foo: "bar" }, keyPair.privateKey, {
            alg: COSE_ALG.ES256
        });

        // Expect promise to reject
        expect(verifyFormToken(token, otherKeyPair.publicKey)).rejects.toThrow();
    });
});
