/**
 * Unified Interface wrappers for VP (Verifiable Presentation) operations
 *
 * This module provides MCP tool handlers for VP operations using the unified interface.
 * Most VP processing logic remains in @tobari/codec, and this module bridges to
 * signer-macos for signature operations.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { decode, encode } from "cbor-x";
import { createPresentation } from "@tobari/codec/sd";
import { verifyPresentation } from "@tobari/codec/validator";
import { readTobariFileAsBuffer } from "../utils.js";
import { runUnifiedSigner, isErrorResponse, isSuccessResponse } from "../unified-signer.js";
import { getNativeSignerPath } from "../utils.js";
import {
    CreatePresentationSchema,
    PreparePresentationSchema,
    AssemblePresentationSchema,
    VerifyPresentationSchema,
    PreviewPresentationSchema
} from "../schemas.js";

/**
 * Sign Device Authentication for VP using unified interface
 */
async function signDeviceAuthUnified(
    toBeSigned: Uint8Array,
    verifierId?: string,
    nonce?: string,
    responseUri?: string
): Promise<{ signature: string; authData?: string; clientDataJSON?: string }> {
    const signerPath = getNativeSignerPath();
    if (!signerPath) {
        throw new Error("Native signer not found");
    }

    const challengeBase64Url = Buffer.from(toBeSigned).toString("base64url");

    const response = await runUnifiedSigner(
        signerPath,
        "sign_data",
        {
            data: challengeBase64Url,
            algorithm: "ES256",
            // @ts-ignore - extended metadata for OID4VP
            metadata: {
                verifierId,
                nonce,
                responseUri,
                purpose: "device_authentication"
            }
        }
    );

    if (isErrorResponse(response)) {
        throw new Error(`Device signature failed: ${response.error.message}`);
    }

    if (isSuccessResponse(response) && typeof response.result.data === "object") {
        const data = response.result.data as any;
        return {
            signature: data.signature,
            authData: data.authData,
            clientDataJSON: data.clientDataJSON
        };
    }

    throw new Error("Unexpected signature response format");
}

/**
 * Sign MSO (Mobile Security Object) for document issuance
 */
export async function signMsoUnified(msoHash: Uint8Array): Promise<Uint8Array> {
    const signerPath = getNativeSignerPath();
    if (!signerPath) {
        throw new Error("Native signer not found");
    }

    const hashBase64Url = Buffer.from(msoHash).toString("base64url");

    const response = await runUnifiedSigner(
        signerPath,
        "sign_data",
        {
            data: hashBase64Url,
            algorithm: "ES256",
            // @ts-ignore - extended metadata
            metadata: {
                purpose: "mso_signature"
            }
        }
    );

    if (isErrorResponse(response)) {
        throw new Error(`MSO signature failed: ${response.error.message}`);
    }

    if (isSuccessResponse(response)) {
        const signatureData = response.result.data;
        const signature = typeof signatureData === "string"
            ? signatureData
            : (signatureData as any).signature;

        return new Uint8Array(Buffer.from(signature, "base64url"));
    }

    throw new Error("Unexpected MSO signature response format");
}

/**
 * Create Verifiable Presentation with unified interface
 */
export async function handleCreatePresentationUnified(toolArgs: any) {
    try {
        const args = CreatePresentationSchema.parse(toolArgs);

        // Read document file
        const fileBuffer = await readTobariFileAsBuffer(args.documentPath);
        const fullDoc = decode(fileBuffer);

        // Parse requested fields
        const requestedFields: Record<string, string[]> = {};
        if (args.requestedFields) {
            for (const field of args.requestedFields) {
                const [ns, attr] = field.includes(".")
                    ? field.split(".", 2)
                    : [fullDoc.docType, field];

                if (!requestedFields[ns]) {
                    requestedFields[ns] = [];
                }
                requestedFields[ns].push(attr);
            }
        }

        // Create selective disclosure
        const disclosedDoc = await createPresentation(fullDoc, requestedFields);

        // Prepare Device Authentication
        const sessionTranscript = args.sessionTranscript
            ? new Uint8Array(Buffer.from(args.sessionTranscript, "base64url"))
            : null;

        // TODO: Implement full VP assembly with device signature
        // For now, return the disclosed document structure

        const result = {
            docType: disclosedDoc.docType,
            nameSpaces: disclosedDoc.nameSpaces,
            disclosedFields: Object.keys(requestedFields).flatMap(ns =>
                requestedFields[ns].map(attr => `${ns}.${attr}`)
            ),
            requiresSignature: true
        };

        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }],
        };

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error creating presentation: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Prepare presentation (without signature) - for external signing flow
 */
export async function handlePreparePresentationUnified(toolArgs: any) {
    try {
        const args = PreparePresentationSchema.parse(toolArgs);

        // Read document
        const fileBuffer = await readTobariFileAsBuffer(args.documentPath);
        const fullDoc = decode(fileBuffer);

        // Parse requested fields
        const requestedFields: Record<string, string[]> = {};
        if (args.requestedFields) {
            for (const field of args.requestedFields) {
                const [ns, attr] = field.includes(".")
                    ? field.split(".", 2)
                    : [fullDoc.docType, field];

                if (!requestedFields[ns]) {
                    requestedFields[ns] = [];
                }
                requestedFields[ns].push(attr);
            }
        }

        // Create selective disclosure
        const disclosedDoc = await createPresentation(fullDoc, requestedFields);

        // Return prepared data for signing
        const result = {
            disclosedDocument: disclosedDoc,
            toBeSigned: "... (hash to be computed)",
            status: "prepared"
        };

        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }],
        };

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error preparing presentation: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Verify Verifiable Presentation
 */
export async function handleVerifyPresentationUnified(toolArgs: any) {
    try {
        const args = VerifyPresentationSchema.parse(toolArgs);

        // Read VP file
        const vpBuffer = await fs.readFile(args.presentationPath);
        const deviceResponse = decode(vpBuffer);

        // Verify
        const verificationResult = await verifyPresentation(deviceResponse, {
            issuerPublicKeyPath: args.issuerPublicKeyPath,
            expectedNonce: args.expectedNonce,
            expectedVerifierId: args.expectedVerifierId
        });

        const result = {
            valid: verificationResult.valid,
            issuerSignatureValid: verificationResult.issuerSignatureValid,
            deviceSignatureValid: verificationResult.deviceSignatureValid,
            errors: verificationResult.errors || [],
            disclosedData: verificationResult.disclosedData
        };

        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }],
        };

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error verifying presentation: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Preview Verifiable Presentation using unified interface
 */
export async function handlePreviewPresentationUnified(toolArgs: any) {
    try {
        const args = PreviewPresentationSchema.parse(toolArgs);
        const signerPath = getNativeSignerPath();

        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        // Read document
        const fileBuffer = await readTobariFileAsBuffer(args.documentPath);
        const docBase64Url = Buffer.from(fileBuffer).toString("base64url");

        // Request preview from signer-macos
        const response = await runUnifiedSigner(
            signerPath,
            "sign_presentation",
            {
                documentData: docBase64Url,
                disclosureFields: args.requestedFields,
                verifierId: args.verifierId,
                nonce: args.nonce,
                outputFormat: "cose"
            },
            { preview: true }
        );

        if (response.status === "preview" && response.preview) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        summary: response.preview.summary,
                        fields: response.preview.fields,
                        sessionId: response.preview.sessionId,
                        status: "preview"
                    }, null, 2)
                }],
            };
        }

        if (isErrorResponse(response)) {
            throw new Error(response.error.message);
        }

        throw new Error("Unexpected preview response");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error previewing presentation: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Approve and execute presentation signature
 */
export async function handleApprovePresentationUnified(sessionId: string) {
    try {
        const signerPath = getNativeSignerPath();
        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        const response = await runUnifiedSigner(
            signerPath,
            "approve_preview",
            { sessionId }
        );

        if (isSuccessResponse(response)) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: "signed",
                        presentation: response.result.data
                    }, null, 2)
                }],
            };
        }

        if (isErrorResponse(response)) {
            throw new Error(response.error.message);
        }

        throw new Error("Unexpected approval response");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error approving presentation: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * External signer function for MSO (to be used with @tobari/codec)
 */
export async function createMsoExternalSigner() {
    const signerPath = getNativeSignerPath();
    if (!signerPath) {
        return undefined;
    }

    return async (msoHash: Uint8Array): Promise<Uint8Array> => {
        return await signMsoUnified(msoHash);
    };
}
