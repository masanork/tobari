import { expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import init, { get_version, sha256_wasm } from "./pkg/tobari_crypto_wasm.js";

test("WASM Load and SHA256", async () => {
    // Specify path to wasm file
    const wasmPath = path.resolve(import.meta.dir, "./pkg/tobari_crypto_wasm_bg.wasm");
    const wasmBuffer = fs.readFileSync(wasmPath);

    // Initialize WASM module
    await init(wasmBuffer);

    // Test version
    const version = get_version();
    console.log("WASM Version:", version);
    expect(version).toContain("Web/A Crypto WASM");

    // Test SHA256
    const data = new TextEncoder().encode("hello");
    const hash = sha256_wasm(data);
    const hashHex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');

    // SHA-256("hello")
    expect(hashHex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});
