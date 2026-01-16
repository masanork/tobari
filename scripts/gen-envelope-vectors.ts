import init, { create_envelope, add_prf_recipient } from "../packages/civ/pkg/civ.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
    // Initialize WASM
    const wasmPath = join(__dirname, "../packages/civ/pkg/civ_bg.wasm");
    const wasmBuffer = readFileSync(wasmPath);
    await init(wasmBuffer);

    const vectors: any[] = [];

    // Vector 1: Simple payload with one PRF recipient
    {
        const payloadStr = "Hello from Tauri to macOS";
        const payload = new TextEncoder().encode(payloadStr);
        const { envelope: initialJson, dek } = await create_envelope(payload);

        const kid = "test-key-01";
        const salt = new Uint8Array(32).fill(0xAA);
        const prfOutput = new Uint8Array(32).fill(0xBB); // Mock PRF output

        const finalJson = await add_prf_recipient(
            initialJson,
            dek,
            kid,
            salt,
            prfOutput
        );

        vectors.push({
            name: "Simple PRF",
            payload: payloadStr,
            kid,
            salt: Buffer.from(salt).toString('base64url'),
            prfOutput: Buffer.from(prfOutput).toString('base64url'),
            envelope: JSON.parse(finalJson)
        });
    }

    // Output
    const outputPath = join(__dirname, "../packages/signer-macos/Tests/envelope_vectors.json");
    writeFileSync(outputPath, JSON.stringify(vectors, null, 2));
    console.log(`Generated test vectors at ${outputPath}`);
}

main().catch(console.error);
