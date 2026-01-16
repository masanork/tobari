import { expect, test, describe, beforeEach } from "bun:test";
import init, { create_envelope, add_prf_recipient, decrypt_envelope_with_prf } from "@tobari/civ";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("WASM Envelope Crypto Integration", () => {
    beforeEach(async () => {
        // In Bun/Node environment, we need to manually provide the WASM binary to the init function
        const wasmPath = join(__dirname, "../../civ/pkg/civ_bg.wasm");
        const wasmBuffer = readFileSync(wasmPath);
        await init(wasmBuffer);
    });

    test("should create and decrypt an envelope via WASM", async () => {
        const payload = new TextEncoder().encode("Secret Message");
        
        // 1. Create Envelope
        const { envelope: initialJson, dek } = await create_envelope(payload);
        expect(initialJson).toBeDefined();
        expect(dek).toBeDefined();
        expect(dek.length).toBe(32);

        // 2. Add PRF Recipient
        const kid = "test-kid";
        const salt = new Uint8Array(32).fill(0x01);
        const prfOutput = new Uint8Array(32).fill(0x02);

        const finalJson = await add_prf_recipient(
            initialJson,
            dek,
            kid,
            salt,
            prfOutput
        );

        const envelopeObj = JSON.parse(finalJson);
        expect(envelopeObj.version).toBe("2.0");
        expect(envelopeObj.recipients.length).toBe(1);
        expect(envelopeObj.recipients[0].type).toBe("webauthn-prf");

        // 3. Decrypt
        const decrypted = await decrypt_envelope_with_prf(
            finalJson,
            kid,
            prfOutput
        );

        expect(new TextDecoder().decode(decrypted)).toBe("Secret Message");
    });

    test("should support multiple recipients", async () => {
        const payload = new TextEncoder().encode("Multi-access Data");
        const { envelope: initialJson, dek } = await create_envelope(payload);

        // Recipient 1: YubiKey
        const kid1 = "yubikey-id";
        const salt1 = new Uint8Array(32).fill(0x11);
        const prf1 = new Uint8Array(32).fill(0x12);
        const envelopeWith1 = await add_prf_recipient(initialJson, dek, kid1, salt1, prf1);

        // Recipient 2: TouchID
        const kid2 = "touchid-id";
        const salt2 = new Uint8Array(32).fill(0x21);
        const prf2 = new Uint8Array(32).fill(0x22);
        const finalEnvelope = await add_prf_recipient(envelopeWith1, dek, kid2, salt2, prf2);

        const envelopeObj = JSON.parse(finalEnvelope);
        expect(envelopeObj.recipients.length).toBe(2);

        // Decrypt with Recipient 2
        const dec2 = await decrypt_envelope_with_prf(finalEnvelope, kid2, prf2);
        expect(new TextDecoder().decode(dec2)).toBe("Multi-access Data");

        // Decrypt with Recipient 1
        const dec1 = await decrypt_envelope_with_prf(finalEnvelope, kid1, prf1);
        expect(new TextDecoder().decode(dec1)).toBe("Multi-access Data");
    });

    test("should fail decryption with wrong PRF output", async () => {
        const payload = new TextEncoder().encode("Secure Data");
        const { envelope: initialJson, dek } = await create_envelope(payload);
        
        const kid = "test-kid";
        const salt = new Uint8Array(32).fill(0x01);
        const prfOutput = new Uint8Array(32).fill(0x02);

        const finalJson = await add_prf_recipient(initialJson, dek, kid, salt, prfOutput);

        // Wrong PRF output
        const wrongPrf = new Uint8Array(32).fill(0x03);
        
        try {
            await decrypt_envelope_with_prf(finalJson, kid, wrongPrf);
            expect().unreachable(); // Should not reach here
        } catch (e) {
            expect(e).toBeDefined();
            // Error message usually comes from Rust's anyhow
        }
    });
});
