#!/usr/bin/env bun
/**
 * Test script for VP preview functionality
 *
 * Usage:
 *   bun scripts/test-vp-preview.ts <document-path> [fields...]
 *
 * Example:
 *   bun scripts/test-vp-preview.ts ./examples/juminhyo/juminhyo.cose name birthDate
 */

import { runUnifiedSigner, isErrorResponse, isSuccessResponse } from "../packages/mcp-server/src/unified-signer.js";
import { getNativeSignerPath } from "../packages/mcp-server/src/utils.js";
import * as fs from "fs/promises";

async function main() {
    const docPath = process.argv[2];
    const fields = process.argv.slice(3);

    if (!docPath) {
        console.error("Error: Document path required");
        console.error("Usage: bun scripts/test-vp-preview.ts <document-path> [fields...]");
        console.error("\nExample:");
        console.error("  bun scripts/test-vp-preview.ts ./examples/juminhyo/juminhyo.cose name address");
        process.exit(1);
    }

    // Check if file exists
    try {
        await fs.access(docPath);
    } catch {
        console.error(`Error: File not found: ${docPath}`);
        process.exit(1);
    }

    const signerPath = getNativeSignerPath();
    if (!signerPath) {
        console.error("Error: Native signer not found");
        process.exit(1);
    }

    console.log(`Document: ${docPath}`);
    console.log(`Fields to disclose: ${fields.length > 0 ? fields.join(", ") : "(all)"}`);
    console.log();

    try {
        // Step 1: Request preview
        console.log("=== Step 1: Requesting Preview ===\n");

        const previewResponse = await runUnifiedSigner(
            signerPath,
            "sign_presentation",
            {
                documentPath: docPath,
                disclosureFields: fields.length > 0 ? fields : undefined,
                verifierId: "test-verifier.example.com",
                nonce: "test-nonce-12345"
            },
            { preview: true }
        );

        if (isErrorResponse(previewResponse)) {
            console.error("✗ Preview failed!");
            console.error(`  Error: ${previewResponse.error.message}`);
            process.exit(1);
        }

        if (previewResponse.status !== "preview" || !previewResponse.preview) {
            console.error("✗ Unexpected response (not a preview)");
            process.exit(1);
        }

        console.log("✓ Preview generated successfully\n");
        console.log(`Summary: ${previewResponse.preview.summary}\n`);

        if (previewResponse.preview.fields) {
            console.log("Fields:");
            for (const field of previewResponse.preview.fields) {
                const icon = field.disclosed ? "✓" : "✗";
                const value = field.disclosed ? field.value : "(hidden)";
                console.log(`  ${icon} ${field.name}: ${value}`);
            }
            console.log();
        }

        const sessionId = previewResponse.preview.sessionId;
        console.log(`Session ID: ${sessionId}\n`);

        // Ask user for approval
        console.log("=== Step 2: Approval (simulated) ===\n");
        console.log("In production, the user would review this in a GUI and approve.");
        console.log("For this test, we'll automatically approve after 2 seconds...\n");

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 2: Approve and sign
        console.log("=== Step 3: Approving and Signing ===\n");

        const approveResponse = await runUnifiedSigner(
            signerPath,
            "approve_preview",
            { sessionId }
        );

        if (isErrorResponse(approveResponse)) {
            console.error("✗ Approval failed!");
            console.error(`  Error: ${approveResponse.error.message}`);
            process.exit(1);
        }

        if (isSuccessResponse(approveResponse)) {
            console.log("✓ Presentation signed successfully!\n");
            console.log("Result:");
            console.log(JSON.stringify(approveResponse.result, null, 2));
            console.log();

            // Show metadata
            if (approveResponse.result.metadata) {
                console.log("Metadata:");
                for (const [key, value] of Object.entries(approveResponse.result.metadata)) {
                    console.log(`  ${key}: ${value}`);
                }
            }
        } else {
            console.error("✗ Unexpected response status");
            console.error(JSON.stringify(approveResponse, null, 2));
        }

    } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main().catch(console.error);
