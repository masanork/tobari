#!/usr/bin/env bun
/**
 * Test script for unified JPKI interface
 *
 * Usage:
 *   bun scripts/test-jpki-unified.ts <command> <pin>
 *
 * Commands:
 *   basic          - Read basic info only
 *   with_mynumber  - Read basic info + My Number
 *   with_photo     - Read basic info + face photo
 *   full           - Read everything
 */

import { runUnifiedSigner, isErrorResponse, isSuccessResponse } from "../packages/mcp-server/src/unified-signer.js";
import { getNativeSignerPath } from "../packages/mcp-server/src/utils.js";

async function main() {
    const command = process.argv[2] || "basic";
    const pin = process.argv[3];

    if (!pin) {
        console.error("Error: PIN required");
        console.error("Usage: bun scripts/test-jpki-unified.ts <command> <PIN>");
        process.exit(1);
    }

    const signerPath = getNativeSignerPath();
    if (!signerPath) {
        console.error("Error: Native signer not found");
        process.exit(1);
    }

    console.log(`Testing JPKI unified interface: ${command}\n`);

    try {
        let params: any = {
            cardType: "jpki",
            pin: pin
        };

        switch (command) {
            case "basic":
                // Default: basic info + certificates
                break;

            case "with_mynumber":
                params.includeMyNumber = true;
                break;

            case "with_photo":
                params.includeFacePhoto = true;
                break;

            case "full":
                params.includeMyNumber = true;
                params.includeFacePhoto = true;
                params.includeCertificates = true;
                break;

            default:
                console.error(`Unknown command: ${command}`);
                process.exit(1);
        }

        const response = await runUnifiedSigner(
            signerPath,
            "read_card",
            params
        );

        console.log("=== Response ===");
        console.log(JSON.stringify(response, null, 2));
        console.log();

        if (isSuccessResponse(response)) {
            console.log("✓ Success!");
            console.log(`  Card Type: ${response.result.metadata?.cardType}`);

            if (response.result.metadata?.includedFields) {
                console.log("  Included Fields:");
                const fields = response.result.metadata.includedFields as any;
                console.log(`    Basic Info: ${fields.basicInfo ? "✓" : "✗"}`);
                console.log(`    My Number: ${fields.myNumber ? "✓" : "✗"}`);
                console.log(`    Face Photo: ${fields.facePhoto ? "✓" : "✗"}`);
                console.log(`    Certificates: ${fields.certificates ? "✓" : "✗"}`);
            }

            if (typeof response.result.data === "object") {
                const data = response.result.data as any;
                console.log("\n  Data Summary:");
                console.log(`    Name: ${data.name || "N/A"}`);
                console.log(`    Address: ${data.address || "N/A"}`);
                console.log(`    Birth Date: ${data.birthDate || "N/A"}`);
                console.log(`    Gender: ${data.gender || "N/A"}`);

                if (data.myNumber) {
                    console.log(`    My Number: ${data.myNumber}`);
                }

                if (data.facePhoto) {
                    const photoSize = data.facePhoto.length;
                    console.log(`    Face Photo: ${photoSize} bytes (Base64)`);
                }

                if (data.authCert) {
                    console.log(`    Auth Cert: ${data.authCert.length} bytes`);
                }
            }

        } else if (isErrorResponse(response)) {
            console.log("✗ Error!");
            console.log(`  Type: ${response.error.type}`);
            console.log(`  Message: ${response.error.message}`);

            if (response.error.details) {
                console.log("  Details:", response.error.details);
            }
        }

    } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main().catch(console.error);
