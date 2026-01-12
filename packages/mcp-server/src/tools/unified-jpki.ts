/**
 * Unified Interface wrappers for JPKI/Identity Card operations
 *
 * This module provides MCP tool handlers that use the new unified interface
 * to communicate with signer-macos.
 */

import { runUnifiedSigner, isErrorResponse, isSuccessResponse, UnifiedResponse } from "../unified-signer.js";
import { getNativeSignerPath } from "../utils.js";
import {
    ReadBasicInfoSchema,
    ReadMyNumberSchema,
    ReadPhotoSchema,
    ReadPassportSchema,
    ReadDriverLicenseSchema,
    ReadResidenceCardSchema,
    SignWithJPKISchema
} from "../schemas.js";

/**
 * Helper to convert UnifiedResponse to MCP tool response
 */
function toMcpResponse(response: UnifiedResponse, errorPrefix: string = "Operation failed") {
    if (isSuccessResponse(response)) {
        const data = response.result.data;
        const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);

        return {
            content: [{ type: "text" as const, text }],
        };
    } else if (isErrorResponse(response)) {
        return {
            content: [{
                type: "text" as const,
                text: `${errorPrefix}: ${response.error.message}`
            }],
            isError: true,
        };
    } else {
        return {
            content: [{
                type: "text" as const,
                text: `Unexpected response status: ${response.status}`
            }],
            isError: true,
        };
    }
}

/**
 * Read basic information from JPKI card (My Number Card)
 */
export async function handleReadBasicInfoUnified(toolArgs: any) {
    try {
        const args = ReadBasicInfoSchema.parse(toolArgs);
        const signerPath = getNativeSignerPath();

        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        const response = await runUnifiedSigner(
            signerPath,
            "read_card",
            {
                cardType: "jpki",
                pin: args.pin
            }
        );

        return toMcpResponse(response, "Failed to read JPKI card");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Read My Number (12-digit personal number) from JPKI card
 */
export async function handleReadMyNumberUnified(toolArgs: any) {
    try {
        const args = ReadMyNumberSchema.parse(toolArgs);
        const signerPath = getNativeSignerPath();

        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        // Note: signer-macos doesn't have a dedicated unified command for My Number yet
        // We'll need to add this to the UnifiedCLIHandler
        // For now, we'll use a workaround by extending read_card params

        const response = await runUnifiedSigner(
            signerPath,
            "read_card",
            {
                cardType: "jpki",
                pin: args.pin,
                // @ts-ignore - extended parameter
                includeMyNumber: true
            }
        );

        return toMcpResponse(response, "Failed to read My Number");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Read face photo from JPKI card
 */
export async function handleReadPhotoUnified(toolArgs: any) {
    try {
        const args = ReadPhotoSchema.parse(toolArgs);
        const signerPath = getNativeSignerPath();

        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        // Similar to My Number, we need to extend the unified interface
        const response = await runUnifiedSigner(
            signerPath,
            "read_card",
            {
                cardType: "jpki",
                pin: args.pin,
                // @ts-ignore - extended parameter
                includeFacePhoto: true
            }
        );

        return toMcpResponse(response, "Failed to read face photo");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Read passport data (ePassport / ICAO 9303)
 */
export async function handleReadPassportUnified(toolArgs: any) {
    try {
        const args = ReadPassportSchema.parse(toolArgs);
        const signerPath = getNativeSignerPath();

        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        const response = await runUnifiedSigner(
            signerPath,
            "read_card",
            {
                cardType: "passport",
                mrz: args.mrz,
                can: args.can,
                usePace: args.usePace
            }
        );

        return toMcpResponse(response, "Failed to read passport");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Read driver's license data (Japan)
 */
export async function handleReadDriverLicenseUnified(toolArgs: any) {
    try {
        const args = ReadDriverLicenseSchema.parse(toolArgs);
        const signerPath = getNativeSignerPath();

        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        const response = await runUnifiedSigner(
            signerPath,
            "read_card",
            {
                cardType: "drivers_license",
                pin1: args.pin1,
                pin2: args.pin2
            }
        );

        return toMcpResponse(response, "Failed to read driver's license");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Read residence card data (Japan)
 */
export async function handleReadResidenceCardUnified(toolArgs: any) {
    try {
        const signerPath = getNativeSignerPath();

        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        const response = await runUnifiedSigner(
            signerPath,
            "read_card",
            {
                cardType: "residence_card"
            }
        );

        return toMcpResponse(response, "Failed to read residence card");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Sign data with JPKI certificate
 */
export async function handleSignWithJpkiUnified(toolArgs: any) {
    try {
        const args = SignWithJPKISchema.parse(toolArgs);
        const signerPath = getNativeSignerPath();

        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        // Convert data to Base64URL
        const dataBuffer = Buffer.from(args.data, args.encoding || "utf8");
        const dataBase64Url = dataBuffer.toString("base64url");

        const response = await runUnifiedSigner(
            signerPath,
            "sign_data",
            {
                data: dataBase64Url,
                algorithm: "RS256", // JPKI uses RSA
                // @ts-ignore - extended parameters for JPKI
                signatureType: args.type || "auth",
                pin: args.pin
            }
        );

        return toMcpResponse(response, "Failed to sign with JPKI");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Register device keys (Passkey / Secure Enclave)
 */
export async function handleRegisterDeviceUnified(toolArgs: any) {
    try {
        const signerPath = getNativeSignerPath();

        if (!signerPath) {
            throw new Error("Native signer not found");
        }

        const response = await runUnifiedSigner(
            signerPath,
            "register_device",
            {
                keyType: "secure_enclave",
                exportPublicKey: true
            }
        );

        if (isSuccessResponse(response) && typeof response.result.data === "object") {
            const data = response.result.data as any;

            // Parse JWK strings to objects
            const signingKey = JSON.parse(data.signingPublicKey);
            const encryptionKey = JSON.parse(data.encryptionPublicKey);

            const result = {
                signingPublicKey: signingKey,
                encryptionPublicKey: encryptionKey,
                keyType: data.keyType,
                platform: response.result.metadata?.platform || "unknown"
            };

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }],
            };
        }

        return toMcpResponse(response, "Failed to register device");

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}
