/**
 * Holder Binding functionality for Tobari
 *
 * Implements the application/issuance flow described in juminhyo_poc_proposal.md:
 * 1. Create application with Device Key + JPKI signature
 * 2. Issuer verifies and issues mdoc with Device Key binding
 * 3. Holder creates VP with Device signature + OID4VP handover
 */

import * as fs from "fs/promises";
import * as path from "path";
import { runUnifiedSigner, isErrorResponse, isSuccessResponse } from "../unified-signer.js";
import { getNativeSignerPath } from "../utils.js";
import { generateSignedTobari } from "@tobari/codec/tobari-gen";

/**
 * Application document structure (matches Swift ApplicationDocument)
 */
export interface ApplicationDocument {
    applicationId: string;
    createdAt: string;
    applicationType: "issuance" | "renewal";
    requestedDocType: string;
    requestedFields?: string[];
    deviceSigningKey: DevicePublicKey;
    deviceEncryptionKey: DevicePublicKey;
    applicantInfo?: ApplicantInfo;
    jpkiSignature?: JpkiSignatureInfo;
}

export interface DevicePublicKey {
    kty: string;
    crv: string;
    x: string;
    y: string;
    kid?: string;
}

export interface ApplicantInfo {
    name?: string;
    birthDate?: string;
    address?: string;
    identificationMethod: string;
}

export interface JpkiSignatureInfo {
    signature: string;
    certificate: string;
    signatureType: string;
    algorithm: string;
}

/**
 * Create application document with holder binding
 */
export async function handleCreateApplication(toolArgs: any) {
    try {
        const { requestedDocType, requestedFields, jpkiPin, outputPath } = toolArgs;

        if (!requestedDocType) {
            throw new Error("requestedDocType is required");
        }

        if (!jpkiPin) {
            throw new Error("jpkiPin is required");
        }

        const signerPath = getNativeSignerPath();
        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        // Call signer-macos to create application
        const response = await runUnifiedSigner(
            signerPath,
            "create_application",
            {
                requestedDocType,
                requestedFields,
                jpkiPin,
                outputPath
            }
        );

        if (isErrorResponse(response)) {
            throw new Error(response.error.message);
        }

        if (isSuccessResponse(response)) {
            const application = response.result.data as ApplicationDocument;

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        applicationId: application.applicationId,
                        requestedDocType: application.requestedDocType,
                        deviceBindingEnabled: true,
                        outputPath: outputPath || "(returned in response)",
                        application: application
                    }, null, 2)
                }],
            };
        }

        throw new Error("Unexpected response from signer");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error creating application: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Issue mdoc with Device Key binding (Issuer side)
 */
export async function handleIssueWithBinding(toolArgs: any) {
    try {
        const { applicationPath, docSchemaPath, issuerKeyPath, outputPath } = toolArgs;

        // Read application document
        const applicationJSON = await fs.readFile(applicationPath, "utf-8");
        const application: ApplicationDocument = JSON.parse(applicationJSON);

        // Verify JPKI signature (TODO: actual verification)
        console.error(`Verifying application ${application.applicationId}...`);

        // Read document schema
        const docSchemaYaml = await fs.readFile(docSchemaPath, "utf-8");

        // Load issuer key
        const issuerKeyJWK = JSON.parse(await fs.readFile(issuerKeyPath, "utf-8"));
        const issuerKeyPair = await crypto.subtle.importKey(
            "jwk",
            issuerKeyJWK,
            { name: "ECDSA", namedCurve: "P-384" },
            true,
            ["sign"]
        );

        // Import device signing public key
        const devicePublicKey = await crypto.subtle.importKey(
            "jwk",
            application.deviceSigningKey,
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["verify"]
        );

        // Import device encryption public key (P-256 for HPKE)
        const deviceEncPublicKey = await crypto.subtle.importKey(
            "jwk",
            application.deviceEncryptionKey,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            []
        );

        // Export encryption key to raw format for HPKE
        const deviceEncRaw = await crypto.subtle.exportKey("raw", deviceEncPublicKey);

        // Prepare data to sign (from applicant info)
        const data: Record<string, any> = {};
        if (application.applicantInfo) {
            if (application.applicantInfo.name) data.name = application.applicantInfo.name;
            if (application.applicantInfo.birthDate) data.birthDate = application.applicantInfo.birthDate;
            if (application.applicantInfo.address) data.address = application.applicantInfo.address;
        }

        // Get external signer for MSO (hardware-bound signature)
        const signerPath = getNativeSignerPath();
        let externalSigner: ((msoHash: Uint8Array) => Promise<Uint8Array>) | undefined;

        if (signerPath) {
            externalSigner = async (msoHash: Uint8Array) => {
                const hashBase64Url = Buffer.from(msoHash).toString('base64url');
                const response = await runUnifiedSigner(signerPath, "sign_data", {
                    data: hashBase64Url,
                    algorithm: "ES256"
                });

                if (isSuccessResponse(response)) {
                    const signatureData = response.result.data;
                    const signature = typeof signatureData === "string"
                        ? signatureData
                        : (signatureData as any).signature;

                    return new Uint8Array(Buffer.from(signature, "base64url"));
                }

                throw new Error("Failed to sign MSO");
            };
        }

        // Generate mdoc with Device Key binding
        const coseBinary = await generateSignedTobari(docSchemaYaml, data, issuerKeyPair, {
            kid: "issuer-key-001",
            alg: -35, // ES384
            devicePublicKey: devicePublicKey,
            encryptionPublicKey: new Uint8Array(deviceEncRaw),
            externalSigner: externalSigner
        });

        // Save to output
        await fs.writeFile(outputPath, coseBinary);

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    success: true,
                    message: "mdoc issued with Device Key binding",
                    applicationId: application.applicationId,
                    docType: application.requestedDocType,
                    outputPath: path.resolve(outputPath),
                    deviceKeyBound: true
                }, null, 2)
            }],
        };

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error issuing with binding: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Create OID4VP-compliant VP with Device signature
 */
export async function handleCreateOid4vpPresentation(toolArgs: any) {
    try {
        const { documentPath, disclosureFields, verifierId, nonce, responseUri, outputPath } = toolArgs;

        if (!documentPath) {
            throw new Error("documentPath is required");
        }

        const signerPath = getNativeSignerPath();
        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        // Step 1: Preview presentation
        console.error("Requesting preview...");
        const previewResponse = await runUnifiedSigner(
            signerPath,
            "sign_presentation",
            {
                documentPath,
                disclosureFields,
                verifierId,
                nonce,
                responseUri
            },
            { preview: true }
        );

        if (isErrorResponse(previewResponse)) {
            throw new Error(previewResponse.error.message);
        }

        if (previewResponse.status !== "preview" || !previewResponse.preview) {
            throw new Error("Failed to generate preview");
        }

        const sessionId = previewResponse.preview.sessionId;
        console.error(`Preview generated. Session ID: ${sessionId}`);

        // Step 2: Approve and sign (in production, user would review preview first)
        console.error("Approving and signing...");
        const approveResponse = await runUnifiedSigner(
            signerPath,
            "approve_preview",
            { sessionId }
        );

        if (isErrorResponse(approveResponse)) {
            throw new Error(approveResponse.error.message);
        }

        if (isSuccessResponse(approveResponse)) {
            const vpData = approveResponse.result.data;

            // Save if output path specified
            if (outputPath) {
                await fs.writeFile(
                    outputPath,
                    JSON.stringify(vpData, null, 2)
                );
            }

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        message: "OID4VP presentation created with Device signature",
                        verifierId,
                        nonce,
                        deviceSigned: true,
                        outputPath: outputPath ? path.resolve(outputPath) : undefined,
                        presentation: vpData
                    }, null, 2)
                }],
            };
        }

        throw new Error("Unexpected response from approval");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error creating OID4VP presentation: ${error.message}` }],
            isError: true,
        };
    }
}

import { McpTool } from "../mcp-tool.js";
import { z } from "zod";
export const holderBindingTools: McpTool<any>[] = [
    { name: "create_application", description: "Creates an application with holder binding.", schema: z.object({ requestedDocType: z.string(), requestedFields: z.array(z.string()).optional(), jpkiPin: z.string().optional(), outputPath: z.string() }), handler: handleCreateApplication },
    { name: "issue_with_binding", description: "Issues an mdoc with binding.", schema: z.object({ applicationPath: z.string(), docSchemaPath: z.string(), issuerKeyPath: z.string(), outputPath: z.string() }), handler: handleIssueWithBinding },
    { name: "create_oid4vp_presentation", description: "Creates an OID4VP presentation.", schema: z.object({ documentPath: z.string(), disclosureFields: z.array(z.string()).optional(), verifierId: z.string(), nonce: z.string(), responseUri: z.string().optional(), outputPath: z.string() }), handler: handleCreateOid4vpPresentation }
];

