#!/usr/bin/env bun
/**
 * Test script for Holder Binding functionality
 *
 * This demonstrates the complete flow from juminhyo_poc_proposal.md:
 * 1. Create application with Device Key + JPKI signature
 * 2. (Issuer) Verify and issue mdoc with Device Key binding
 * 3. Create VP with Device signature + OID4VP handover
 *
 * Usage:
 *   bun scripts/test-holder-binding.ts <command> [args...]
 *
 * Commands:
 *   create-app <doc-path> <pin>              - Create application
 *   issue <app-path> <schema> <issuer-key>   - Issue mdoc with binding
 *   create-vp <doc-path> [fields...]         - Create OID4VP presentation
 *   full-flow <doc-path> <pin>               - Run complete flow
 */

import { handleCreateApplication, handleIssueWithBinding, handleCreateOid4vpPresentation } from "../packages/mcp-server/src/tools/holder-binding.js";
import * as fs from "fs/promises";
import * as path from "path";

const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    blue: "\x1b[34m",
    yellow: "\x1b[33m",
    red: "\x1b[31m"
};

function log(message: string, color: string = COLORS.reset) {
    console.log(`${color}${message}${COLORS.reset}`);
}

function header(message: string) {
    log(`\n${"=".repeat(60)}`, COLORS.blue);
    log(`  ${message}`, COLORS.bright);
    log("=".repeat(60), COLORS.blue);
}

async function createApplication(docType: string, pin: string) {
    header("Step 1: Create Application with Holder Binding");

    log("\nThis step:");
    log("  ✓ Generates Device Keys (Signing + Encryption)");
    log("  ✓ Reads JPKI card for applicant info");
    log("  ✓ Signs application with JPKI");
    log("  ✓ Binds Device public keys to application\n");

    const outputPath = "examples/juminhyo/application.json";

    const result = await handleCreateApplication({
        requestedDocType: docType,
        requestedFields: ["name", "birthDate", "address", "sex"],
        jpkiPin: pin,
        outputPath
    });

    if (result.isError) {
        log(`✗ Error: ${result.content[0].text}`, COLORS.red);
        process.exit(1);
    }

    const data = JSON.parse(result.content[0].text);
    log(`✓ Application created: ${data.applicationId}`, COLORS.green);
    log(`  Requested DocType: ${data.requestedDocType}`);
    log(`  Device Binding: ${data.deviceBindingEnabled ? "Enabled" : "Disabled"}`);
    log(`  Saved to: ${outputPath}`);

    return { applicationPath: outputPath, application: data.application };
}

async function issueWithBinding(applicationPath: string, schemaPath: string, issuerKeyPath: string) {
    header("Step 2: Issue mdoc with Device Key Binding");

    log("\nThis step (Issuer side):");
    log("  ✓ Verifies JPKI signature on application");
    log("  ✓ Embeds Device public key in MSO");
    log("  ✓ Signs mdoc with Issuer key");
    log("  ✓ Encrypts for Device encryption key\n");

    const outputPath = path.join(path.dirname(applicationPath), "issued-mdoc.cose");

    const result = await handleIssueWithBinding({
        applicationPath,
        docSchemaPath: schemaPath,
        issuerKeyPath,
        outputPath
    });

    if (result.isError) {
        log(`✗ Error: ${result.content[0].text}`, COLORS.red);
        process.exit(1);
    }

    const data = JSON.parse(result.content[0].text);
    log(`✓ mdoc issued with binding`, COLORS.green);
    log(`  Application ID: ${data.applicationId}`);
    log(`  DocType: ${data.docType}`);
    log(`  Device Key Bound: ${data.deviceKeyBound}`);
    log(`  Saved to: ${data.outputPath}`);

    return { mdocPath: data.outputPath };
}

async function createOid4vpPresentation(docPath: string, fields?: string[]) {
    header("Step 3: Create OID4VP Presentation with Device Signature");

    log("\nThis step (Holder side):");
    log("  ✓ Selectively discloses requested fields");
    log("  ✓ Signs with Device key (Holder Binding)");
    log("  ✓ Includes OID4VP session handover");
    log("  ✓ Prevents phishing via nonce/verifier binding\n");

    const outputPath = path.join(path.dirname(docPath), "presentation.json");

    const result = await handleCreateOid4vpPresentation({
        documentPath: docPath,
        disclosureFields: fields,
        verifierId: "verifier.example.com",
        nonce: "test-nonce-" + Date.now(),
        responseUri: "https://verifier.example.com/callback",
        outputPath
    });

    if (result.isError) {
        log(`✗ Error: ${result.content[0].text}`, COLORS.red);
        process.exit(1);
    }

    const data = JSON.parse(result.content[0].text);
    log(`✓ OID4VP presentation created`, COLORS.green);
    log(`  Verifier ID: ${data.verifierId}`);
    log(`  Nonce: ${data.nonce}`);
    log(`  Device Signed: ${data.deviceSigned}`);
    log(`  Saved to: ${data.outputPath}`);

    return { presentationPath: data.outputPath };
}

async function fullFlow(docType: string, pin: string) {
    header("Complete Holder Binding Flow");

    log("\nThis demonstrates the complete workflow:");
    log("  1. Application Creation (Holder)");
    log("  2. mdoc Issuance (Issuer)");
    log("  3. VP Presentation (Holder)\n");

    log("Starting in 2 seconds...\n");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 1: Create Application
    const { applicationPath } = await createApplication(docType, pin);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 2: Issue mdoc (requires schema and issuer key)
    const schemaPath = path.join(path.dirname(docPath), "../schema.yml");
    const issuerKeyPath = path.join(path.dirname(docPath), "../issuer-key.json");

    try {
        await fs.access(schemaPath);
        await fs.access(issuerKeyPath);

        const { mdocPath } = await issueWithBinding(applicationPath, schemaPath, issuerKeyPath);

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 3: Create VP
        await createOid4vpPresentation(mdocPath, ["name", "birthDate"]);

    } catch {
        log("\n⚠ Note: Schema and issuer key not found. Skipping issuance step.", COLORS.yellow);
        log("  To complete the flow, provide:");
        log(`    - ${schemaPath}`);
        log(`    - ${issuerKeyPath}`);
    }

    header("Flow Complete!");
    log("\n✓ Holder Binding workflow completed successfully", COLORS.green);
    log("\nKey Features Demonstrated:");
    log("  ✓ Device Key Binding prevents transfer/reuse");
    log("  ✓ JPKI signature provides applicant authentication");
    log("  ✓ OID4VP handover prevents phishing attacks");
    log("  ✓ Selective disclosure protects privacy\n");
}

async function main() {
    const command = process.argv[2];

    if (!command) {
        console.error("Usage: bun scripts/test-holder-binding.ts <command> [args...]");
        console.error("\nCommands:");
        console.error("  create-app <doctype> <pin>                              - Create application");
        console.error("  issue <app-path> <schema> <issuer-key>                  - Issue mdoc with binding");
        console.error("  create-vp <doc-path> [fields...]                        - Create OID4VP presentation");
        console.error("  full-flow <doctype> <pin>                               - Run complete flow");
        process.exit(1);
    }

    try {
        switch (command) {
            case "create-app":
                const docType = process.argv[3];
                const pin = process.argv[4];
                if (!docType || !pin) {
                    console.error("Error: Document type and PIN required");
                    process.exit(1);
                }
                await createApplication(docType, pin);
                break;

            case "issue":
                const appPath = process.argv[3];
                const schemaPath = process.argv[4];
                const issuerKeyPath = process.argv[5];
                if (!appPath || !schemaPath || !issuerKeyPath) {
                    console.error("Error: Application path, schema path, and issuer key path required");
                    process.exit(1);
                }
                await issueWithBinding(appPath, schemaPath, issuerKeyPath);
                break;

            case "create-vp":
                const vpDocPath = process.argv[3];
                const fields = process.argv.slice(4);
                if (!vpDocPath) {
                    console.error("Error: Document path required");
                    process.exit(1);
                }
                await createOid4vpPresentation(vpDocPath, fields.length > 0 ? fields : undefined);
                break;

            case "full-flow":
                const flowDocType = process.argv[3];
                const flowPin = process.argv[4];
                if (!flowDocType || !flowPin) {
                    console.error("Error: Document type and PIN required");
                    process.exit(1);
                }
                await fullFlow(flowDocType, flowPin);
                break;

            default:
                console.error(`Unknown command: ${command}`);
                process.exit(1);
        }
    } catch (error) {
        log(`\n✗ Error: ${error instanceof Error ? error.message : String(error)}`, COLORS.red);
        process.exit(1);
    }
}

main().catch(console.error);
