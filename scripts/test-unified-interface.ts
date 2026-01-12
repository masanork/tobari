#!/usr/bin/env bun
/**
 * Test script for unified signer interface
 *
 * Usage:
 *   bun scripts/test-unified-interface.ts [command]
 *
 * Commands:
 *   get_public_key   - Get device public key
 *   register_device  - Register device keys
 *   read_jpki        - Read JPKI card (requires PIN)
 *   sign_data        - Sign test data
 */

import { runUnifiedSigner, isErrorResponse, isSuccessResponse } from "../packages/mcp-server/src/unified-signer.js";
import { getNativeSignerPath } from "../packages/mcp-server/src/utils.js";

async function main() {
    const command = process.argv[2] || "get_public_key";
    const signerPath = getNativeSignerPath();

    if (!signerPath) {
        console.error("Error: Native signer not found");
        console.error("Please build signer-macos first:");
        console.error("  cd packages/signer-macos && make");
        process.exit(1);
    }

    console.log(`Using signer: ${signerPath}`);
    console.log(`Testing command: ${command}\n`);

    try {
        let response;

        switch (command) {
            case "get_public_key":
                response = await runUnifiedSigner(signerPath, "get_public_key", {});
                break;

            case "register_device":
                response = await runUnifiedSigner(signerPath, "register_device", {
                    keyType: "secure_enclave",
                    exportPublicKey: true
                });
                break;

            case "read_jpki":
                const pin = process.argv[3];
                if (!pin) {
                    console.error("Error: PIN required");
                    console.error("Usage: bun scripts/test-unified-interface.ts read_jpki <PIN>");
                    process.exit(1);
                }

                response = await runUnifiedSigner(signerPath, "read_card", {
                    cardType: "jpki",
                    pin: pin
                });
                break;

            case "sign_data":
                const testData = "Hello, Tobari!";
                const challenge = Buffer.from(testData).toString("base64url");

                response = await runUnifiedSigner(signerPath, "sign_data", {
                    data: challenge,
                    algorithm: "ES256"
                });
                break;

            case "preview":
                // Test preview mode
                response = await runUnifiedSigner(
                    signerPath,
                    "sign_presentation",
                    {
                        disclosureFields: ["name", "birthDate"],
                        verifierId: "example.com"
                    },
                    { preview: true }
                );
                break;

            default:
                console.error(`Unknown command: ${command}`);
                console.error("Available commands: get_public_key, register_device, read_jpki, sign_data, preview");
                process.exit(1);
        }

        // Display response
        console.log("=== Response ===");
        console.log(JSON.stringify(response, null, 2));
        console.log();

        // Interpret response
        if (isSuccessResponse(response)) {
            console.log("✓ Success!");
            console.log(`  Type: ${response.result.type}`);
            console.log(`  Format: ${response.result.format}`);

            if (response.result.metadata) {
                console.log("  Metadata:", response.result.metadata);
            }

            // Show data preview
            if (typeof response.result.data === "string") {
                const preview = response.result.data.substring(0, 100);
                console.log(`  Data: ${preview}${response.result.data.length > 100 ? "..." : ""}`);
            } else {
                console.log("  Data:", response.result.data);
            }

        } else if (isErrorResponse(response)) {
            console.log("✗ Error!");
            console.log(`  Type: ${response.error.type}`);
            console.log(`  Message: ${response.error.message}`);

            if (response.error.details) {
                console.log("  Details:", response.error.details);
            }

        } else if (response.status === "preview") {
            console.log("◉ Preview Mode");
            console.log(`  Summary: ${response.preview?.summary}`);
            console.log(`  Session ID: ${response.preview?.sessionId}`);

            if (response.preview?.fields) {
                console.log("  Fields:");
                for (const field of response.preview.fields) {
                    const disclosed = field.disclosed ? "✓" : "✗";
                    console.log(`    ${disclosed} ${field.name}: ${field.value}`);
                }
            }
        }

    } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main().catch(console.error);
