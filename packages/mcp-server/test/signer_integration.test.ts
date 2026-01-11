import { test, expect, describe } from "bun:test";
import * as path from "path";
import * as fs from "fs/promises";
import { readTobariFileAsBuffer, DEFAULT_SIGNER_MACOS_PATH, PROJECT_ROOT } from "../src/utils.js";
import { encryptHpkeWithAlg, HPKE_ALG_CLASSIC } from "@tobari/crypto/hpke";

describe("Signer-macOS & MCP Integration", () => {
    // Only run on macOS
    const isMac = process.platform === "darwin";

        test("Full ECIES Decryption Flow via signer-macos", async () => {
            if (!isMac) {
                console.log("Skipping macOS-specific test");
                return;
            }
    
            const env = { ...process.env, TOBARI_SIGNER_USE_KEYCHAIN: "1" };
    
            // 1. Ensure signer-macos binary exists
            try {
                await fs.access(DEFAULT_SIGNER_MACOS_PATH);
            } catch {
                throw new Error(`signer-macos binary not found at ${DEFAULT_SIGNER_MACOS_PATH}. Please build it first.`);
            }
    
            // 2. Get Public Key from Device
            const { spawnSync } = await import("child_process");
            const pubKeyResult = spawnSync(DEFAULT_SIGNER_MACOS_PATH, ["--get-encryption-public-key"], { env });
            expect(pubKeyResult.status).toBe(0);
            const pubKeyJson = JSON.parse(pubKeyResult.stdout.toString());
            const { x, y } = pubKeyJson.publicKey;
            
            const rawRecipientPub = new Uint8Array(65);
            rawRecipientPub[0] = 0x04;
            rawRecipientPub.set(Buffer.from(x, 'base64url'), 1);
            rawRecipientPub.set(Buffer.from(y, 'base64url'), 33);
    
            // 3. Encrypt a test message
            const plaintext = "Hello from Tobari Integration Test!";
            const data = new TextEncoder().encode(plaintext);
            
            // We'll use subtle crypto to generate a test-compatible ECIES
            const ephemeralKeyPair = await crypto.subtle.generateKey(
                { name: "ECDH", namedCurve: "P-256" },
                true,
                ["deriveKey", "deriveBits"]
            );
            
            const recipientKey = await crypto.subtle.importKey(
                "jwk",
                { kty: "EC", crv: "P-256", x, y },
                { name: "ECDH", namedCurve: "P-256" },
                true,
                []
            );
            
            const sharedSecret = await crypto.subtle.deriveBits(
                { name: "ECDH", public: recipientKey },
                ephemeralKeyPair.privateKey,
                256
            );
            const sharedSecretHash = Buffer.from(await crypto.subtle.digest("SHA-256", sharedSecret)).toString('hex');
            console.log(`Test Debug: Shared Secret SHA256: ${sharedSecretHash}`);
            
            // HKDF (matching Swift's salt and info)
            const hkdfSalt = new TextEncoder().encode("tobari-ecies-salt");
            const hkdfInfo = new TextEncoder().encode("tobari-ecies-info");
            const baseKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
            const aesKey = await crypto.subtle.deriveKey(
                { 
                    name: "HKDF", 
                    hash: "SHA-256", 
                    salt: hkdfSalt,
                    info: hkdfInfo 
                },
                baseKey,
                { name: "AES-GCM", length: 256 },
                true, // extractable for debugging
                ["encrypt"]
            );
            
            // Debug: Print derived key hash
            const exportedKey = await crypto.subtle.exportKey("raw", aesKey);
            const keyHashBuffer = await crypto.subtle.digest("SHA-256", exportedKey);
            const keyHashHex = Buffer.from(keyHashBuffer).toString('hex');
            console.log(`Test Debug: Derived Key SHA256: ${keyHashHex}`);
            
            const iv = crypto.getRandomValues(new Uint8Array(12));
            console.log(`Test Debug: IV Hex: ${Buffer.from(iv).toString('hex')}`);
            
            const encrypted = await crypto.subtle.encrypt(
                { name: "AES-GCM", iv },
                aesKey,
                data
            );
            
            const encryptedBytes = new Uint8Array(encrypted);
            const ciphertext = encryptedBytes.slice(0, -16);
            const tag = encryptedBytes.slice(-16);
            console.log(`Test Debug: Tag Hex: ${Buffer.from(tag).toString('hex')}`);
            
            const ephemPubRaw = await crypto.subtle.exportKey("raw", ephemeralKeyPair.publicKey);
    
            // 4. Create a temporary Tobari-Encrypted JSON file
            const wrapper = {
                tobari_enc: true,
                alg: HPKE_ALG_CLASSIC,
                ephemeralPublicKey: Buffer.from(ephemPubRaw).toString('base64url'),
                iv: Buffer.from(iv).toString('base64url'),
                tag: Buffer.from(tag).toString('base64url'),
                data: Buffer.from(ciphertext).toString('base64')
            };
            
            const tmpFilePath = path.join(PROJECT_ROOT, "packages/mcp-server/test/tmp_encrypted_signer.json");
            await fs.writeFile(tmpFilePath, JSON.stringify(wrapper));
    
            // 5. Attempt to read and decrypt via readTobariFileAsBuffer
            const decryptedBuffer = await readTobariFileAsBuffer(tmpFilePath, {
                hpkeInfo: "tobari-storage-v1"
            });
            
            const resultText = new TextDecoder().decode(decryptedBuffer);
            expect(resultText).toBe(plaintext);
    
            // Cleanup
            await fs.unlink(tmpFilePath);
        });});
