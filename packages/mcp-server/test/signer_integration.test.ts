import { test, expect, describe } from "bun:test";
import * as path from "path";
import * as fs from "fs/promises";
import { DEFAULT_SIGNER_MACOS_PATH, PROJECT_ROOT } from "../src/utils.js";
import { spawn } from "child_process";

describe("Signer-macOS & MCP Integration", () => {
    // Only run on macOS
    const isMac = process.platform === "darwin";

    test("Full ECIES Decryption Flow via signer-macos", async () => {
        if (!isMac) {
            console.log("Skipping macOS-specific test");
            return;
        }

        // Create a temporary key file for this test session
        const tmpKeyFile = path.join(PROJECT_ROOT, "packages/mcp-server/test/tmp_test_key.bin");

        const env = {
            ...process.env,
            TOBARI_SIGNER_USE_KEYCHAIN: "0",  // Don't use keychain (keys only in memory)
            TOBARI_SIGNER_SOFTWARE_KEY: "1",  // Use software key to avoid Touch ID prompts
            TOBARI_SIGNER_KEY_FILE: tmpKeyFile  // Use file-based key storage for test
        };

        // 1. Ensure signer-macos binary exists
        try {
            await fs.access(DEFAULT_SIGNER_MACOS_PATH);
        } catch {
            throw new Error(`signer-macos binary not found at ${DEFAULT_SIGNER_MACOS_PATH}. Please build it first.`);
        }

        // 2. Use unified interface to get public key and decrypt in a single session
        // This avoids the problem of different keys in different processes

        const plaintext = "Hello from Tobari Integration Test!";
        const plaintextBytes = new TextEncoder().encode(plaintext);

        // Helper to call signer-macos with unified request
        const callSigner = (command: string, params: any): Promise<any> => {
            return new Promise((resolve, reject) => {
                const request = JSON.stringify({ command, params });
                const proc = spawn(DEFAULT_SIGNER_MACOS_PATH, ["--request", request], { env });

                let stdout = "";
                let stderr = "";
                proc.stdout.on("data", (data) => stdout += data.toString());
                proc.stderr.on("data", (data) => stderr += data.toString());

                proc.on("close", (code) => {
                    if (code !== 0) {
                        reject(new Error(`Signer failed: ${stderr}`));
                    } else {
                        try {
                            const response = JSON.parse(stdout);
                            if (response.status === "success") {
                                resolve(response.result);
                            } else if (response.status === "error") {
                                reject(new Error(response.error?.message || "Unknown error"));
                            } else {
                                reject(new Error("Unexpected response status"));
                            }
                        } catch (e) {
                            reject(new Error(`Failed to parse response: ${e}`));
                        }
                    }
                });
            });
        };

        // Get encryption public key using register_device
        const registerResult = await callSigner("register_device", {});
        const encryptionPubKeyJson = JSON.parse(registerResult.data.encryptionPublicKey);
        const { x, y } = encryptionPubKeyJson;

        // Encrypt a test message
        const recipientKey = await crypto.subtle.importKey(
            "jwk",
            { kty: "EC", crv: "P-256", x, y, ext: true },
            { name: "ECDH", namedCurve: "P-256" },
            true,
            []
        );

        const { encryptTobariEcies } = await import("@tobari/crypto/tobari-ecies");
        const encrypted = await encryptTobariEcies(recipientKey, plaintextBytes);

        // Decrypt using the same signer process's key
        const decryptResult = await callSigner("decrypt_data", { components: encrypted });
        const decryptedBase64URL = decryptResult.data;

        // Decode from Base64URL
        const decryptedBytes = Buffer.from(decryptedBase64URL.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const resultText = new TextDecoder().decode(decryptedBytes);

        expect(resultText).toBe(plaintext);

        // Cleanup
        try {
            await fs.unlink(tmpKeyFile);
        } catch {}
    });
});
