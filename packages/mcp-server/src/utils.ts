import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { decryptHpkeWithAlg, deriveHPKEKeyPair, HPKE_ALG_HYBRID, type HpkeAlg } from "@tobari/crypto/hpke";

export const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
export const DEFAULT_MYNA_PATH = path.join(PROJECT_ROOT, "packages/civ/target/debug/civ");
export const DEFAULT_SIGNER_MACOS_PATH = path.join(PROJECT_ROOT, "packages/signer-macos/bin/tobari-signer-macos");

/**
 * Find the best available native signer binary based on current platform and environment.
 */
export function getNativeSignerPath(): string | undefined {
    const platform = os.platform();
    const arch = os.arch();
    
    // 1. Check environment variable (highest priority override)
    const envPath = process.env.TOBARI_SIGNER_PATH;
    if (envPath) return envPath;

    // 2. Check for npm-installed platform-specific packages (future-proof)
    const binaryName = platform === "win32" ? "tobari-signer.exe" : (platform === "darwin" ? "tobari-signer-macos" : "tobari-signer");
    const packageName = `@tobari/signer-${platform}-${arch}`;
    
    // Try to resolve within node_modules relative to the current script
    const possibleInstalledPaths = [
        path.join(PROJECT_ROOT, "node_modules", packageName, "bin", binaryName),
        path.join(PROJECT_ROOT, "..", "node_modules", packageName, "bin", binaryName), // Monorepo root
    ];

    for (const p of possibleInstalledPaths) {
        try { if (require.resolve(p)) return p; } catch {}
    }

    // 3. Fallback to local development paths
    const devPaths = [
        DEFAULT_SIGNER_MACOS_PATH,
        path.join(PROJECT_ROOT, "packages/signer/src-tauri/target/release/tobari-signer"),
        path.join(PROJECT_ROOT, "packages/signer/src-tauri/target/release/tobari-signer.exe"),
        path.join(PROJECT_ROOT, "packages/signer/src-tauri/target/debug/tobari-signer"),
        path.join(PROJECT_ROOT, "packages/signer/src-tauri/target/debug/tobari-signer.exe")
    ];

    for (const p of devPaths) {
        try {
            // Using synchronous check for path resolution in initialization helpers
            const { existsSync } = require("fs");
            if (existsSync(p)) return p;
        } catch { }
    }
    
    return undefined;
}

const DEMO_HPKE_SECRET = "tobari-demo-secret-key-32-bytes-long!!";
const DEMO_HPKE_INFO = "tobari-storage-v1";
const DEMO_PQC_PRIVATE_KEY_PATH = path.join(PROJECT_ROOT, "examples/juminhyo/recipient-pqc-private-key.json");

export type TobariDecryptOptions = {
    hpkeSecret?: string;
    hpkeInfo?: string;
    pqcPrivateKeyPath?: string;
};

/**
 * Helper to read a Tobari file (HTML or COSE) and return its binary buffer.
 */
export async function readTobariFileAsBuffer(
    filePath: string,
    options: TobariDecryptOptions = {}
): Promise<Uint8Array> {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html") {
        const htmlContent = await fs.readFile(filePath, "utf-8");

        // Faster lookup than regex matchAll for large files
        const marker = "window.__TOBARI_DATA__ = \"";
        const startIdx = htmlContent.indexOf(marker);
        if (startIdx === -1) {
            throw new Error("Could not find embedded Tobari data in HTML file.");
        }

        const dataStart = startIdx + marker.length;
        const endIdx = htmlContent.indexOf("\"", dataStart);
        if (endIdx === -1) {
            throw new Error("Could not find end of Tobari data in HTML file.");
        }

        let b64 = htmlContent.substring(dataStart, endIdx).replace(/\s/g, '');
        if (b64.startsWith("data:")) {
            const commaIdx = b64.indexOf(",");
            if (commaIdx !== -1) {
                b64 = b64.substring(commaIdx + 1);
            }
        }

        // Use native Buffer for fast base64 decoding
        const decoded = new Uint8Array(Buffer.from(b64, 'base64'));
        return await decryptIfNeeded(decoded, options);
    } else {
        const raw = await fs.readFile(filePath);
        return await decryptIfNeeded(raw, options);
    }
}

export function decodeSignatureInput(signature: string, encoding: "base64" | "base64url"): Uint8Array {
    return new Uint8Array(Buffer.from(signature, encoding));
}

export function rawEcdsaToDer(rawSignature: Uint8Array): Uint8Array {
    if (rawSignature.length % 2 !== 0) {
        throw new Error("Invalid raw ECDSA signature length");
    }
    const partLen = rawSignature.length / 2;
    const r = rawSignature.slice(0, partLen);
    const s = rawSignature.slice(partLen);

    const toInteger = (bytes: Uint8Array) => {
        let start = 0;
        while (start < bytes.length - 1 && bytes[start] === 0) start++;
        let trimmed = bytes.slice(start);
        if (trimmed[0] & 0x80) {
            const prefixed = new Uint8Array(trimmed.length + 1);
            prefixed[0] = 0x00;
            prefixed.set(trimmed, 1);
            trimmed = prefixed;
        }
        return trimmed;
    };

    const rInt = toInteger(r);
    const sInt = toInteger(s);
    const totalLen = 2 + rInt.length + 2 + sInt.length;
    const der = new Uint8Array(2 + totalLen);
    let offset = 0;
    der[offset++] = 0x30;
    der[offset++] = totalLen;
    der[offset++] = 0x02;
    der[offset++] = rInt.length;
    der.set(rInt, offset);
    offset += rInt.length;
    der[offset++] = 0x02;
    der[offset++] = sInt.length;
    der.set(sInt, offset);
    return der;
}

async function decryptIfNeeded(input: Uint8Array, options: TobariDecryptOptions = {}): Promise<Uint8Array> {
    const trimmed = trimLeadingWhitespace(input);
    if (trimmed.length === 0 || trimmed[0] !== 0x7b) {
        return input;
    }

    const text = new TextDecoder().decode(trimmed);
    let wrapper: any;
    try {
        wrapper = JSON.parse(text);
    } catch {
        return input;
    }

    if (!wrapper || wrapper.tobari_enc !== true || typeof wrapper.data !== "string") {
        return input;
    }

    // New: Support for Device-bound Decryption (ECIES via signer-macos)
    if (wrapper.ephemeralPublicKey && process.platform === 'darwin') {
        const { spawn } = await import("child_process");
        const signerPath = DEFAULT_SIGNER_MACOS_PATH;
        try {
            await fs.access(signerPath);
            const decryptInput = JSON.stringify({
                ephemeralPublicKey: wrapper.ephemeralPublicKey,
                ciphertext: wrapper.data,
                iv: wrapper.iv,
                tag: wrapper.tag
            });

            const signerProcess = spawn(signerPath, ["--decrypt", "--input", decryptInput], {
                env: { ...process.env, TOBARI_SIGNER_USE_KEYCHAIN: process.env.TOBARI_SIGNER_USE_KEYCHAIN || "1" }
            });
            const outputPromise = new Promise<string>((resolve, reject) => {
                let stdout = "";
                let stderr = "";
                signerProcess.stdout.on("data", (data) => stdout += data);
                signerProcess.stderr.on("data", (data) => stderr += data);
                signerProcess.on("close", (code) => {
                    if (code === 0) resolve(stdout);
                    else reject(new Error(`Signer decryption failed: ${stderr}`));
                });
            });

            const outputStr = await outputPromise;
            const output = JSON.parse(outputStr);
            if (output.plaintext) {
                return new TextEncoder().encode(output.plaintext);
            } else if (output.plaintextBase64) {
                return new Uint8Array(Buffer.from(output.plaintextBase64, 'base64'));
            }
        } catch (e: any) {
            console.warn(`Device-bound decryption failed or signer not found: ${e.message}. Falling back to standard HPKE.`);
        }
    }

    const ciphertext = new Uint8Array(Buffer.from(wrapper.data, "base64"));
    const infoText = options.hpkeInfo ?? process.env.TOBARI_HPKE_INFO ?? DEMO_HPKE_INFO;
    const secretText = options.hpkeSecret ?? process.env.TOBARI_HPKE_SECRET ?? DEMO_HPKE_SECRET;
    if (!secretText) {
        throw new Error("Missing HPKE secret for Tobari decryption.");
    }

    const info = new TextEncoder().encode(infoText);
    const secret = new TextEncoder().encode(secretText);
    const keyPair = await deriveHPKEKeyPair(secret);

    let pqcPrivateKey: Uint8Array | undefined;
    if (wrapper.alg === HPKE_ALG_HYBRID) {
        const pqcKeyPath = options.pqcPrivateKeyPath
            ?? process.env.TOBARI_PQC_PRIVATE_KEY_PATH
            ?? DEMO_PQC_PRIVATE_KEY_PATH;
        if (!pqcKeyPath) {
            throw new Error("Missing PQC private key path for hybrid decryption.");
        }
        try {
            const pqcContent = await fs.readFile(pqcKeyPath, "utf-8");
            const pqcJson = JSON.parse(pqcContent);
            pqcPrivateKey = new Uint8Array(Buffer.from(pqcJson.privateKey, "base64url"));
        } catch (e: any) {
            throw new Error(`Missing or invalid PQC private key for hybrid decrypt: ${e.message}`);
        }
    }

    const plaintext = await decryptHpkeWithAlg({
        alg: wrapper.alg as HpkeAlg,
        privateKey: keyPair!.privateKey,
        pqcPrivateKey,
        data: ciphertext,
        info
    });
    return new Uint8Array(plaintext);
}

function trimLeadingWhitespace(input: Uint8Array): Uint8Array {
    let i = 0;
    while (i < input.length && (input[i] === 0x20 || input[i] === 0x0a || input[i] === 0x0d || input[i] === 0x09)) {
        i++;
    }
    return input.slice(i);
}

export async function loadAllTrustedIssuers(): Promise<Record<string, CryptoKey | { classic: CryptoKey; pqcPublicKey?: Uint8Array }>> {
    const examplesDir = path.join(PROJECT_ROOT, "examples");
    const issuerKeys: Record<string, CryptoKey | { classic: CryptoKey; pqcPublicKey?: Uint8Array }> = {};

    const entries = await fs.readdir(examplesDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(examplesDir, entry.name);

        // Look for issuer-key.json
        const keyPath = path.join(dir, "issuer-key.json");
        try {
            await fs.access(keyPath);
        } catch {
            continue;
        }

        // Look for YAML to get docType
        let docType: string | null = null;
        const subEntries = await fs.readdir(dir);
        for (const f of subEntries) {
            if (f.endsWith(".yaml") && f !== "docker-compose.yaml") {
                // Heuristic: read the yaml and look for "id: ..."
                const content = await fs.readFile(path.join(dir, f), "utf-8");
                const match = content.match(/^id:\s*["']?([^"'\n]+)["']?/m);
                if (match) {
                    docType = match[1];
                    break;
                }
            }
        }

        if (docType) {
            try {
                const keyContent = await fs.readFile(keyPath, "utf-8");
                const jwk = JSON.parse(keyContent);
                const key = await crypto.subtle.importKey(
                    "jwk",
                    jwk,
                    { name: "ECDSA", namedCurve: jwk.crv || "P-384" },
                    true,
                    ["verify"]
                );
                const pqcPath = path.join(dir, "issuer-pqc-public-key.json");
                try {
                    await fs.access(pqcPath);
                    const pqcContent = await fs.readFile(pqcPath, "utf-8");
                    const pqcJson = JSON.parse(pqcContent);
                    const pqcPublicKey = new Uint8Array(Buffer.from(pqcJson.publicKey, "base64url"));
                    issuerKeys[docType] = { classic: key, pqcPublicKey };
                } catch {
                    issuerKeys[docType] = key;
                }
                // Also support "io.github.masanork.tobari.credit-card-statement.v1" etc.
            } catch (e) {
                console.warn(`Failed to load key for ${docType}:`, e);
            }
        }
    }
    return issuerKeys;
}
