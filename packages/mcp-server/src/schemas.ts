import { z } from "zod";
import { DEFAULT_MYNA_PATH } from "./utils.js";

// Define tool schemas
export const ReadTobariFileSchema = z.object({
    path: z.string().describe("Absolute path to the Tobari file (.cose or .html)"),
    issuerPublicKeyPath: z.string().optional().describe("Absolute path to the issuer's public key (JWK/JSON format) for verification"),
});

export const CreatePresentationSchema = z.object({
    requests: z.array(z.object({
        path: z.string().describe("Path to the source Tobari file"),
        fields: z.array(z.string()).describe("List of field IDs to disclose from this document"),
    })),
    devicePrivateKeyPath: z.string().optional().describe("Path to the holder's device private key (JWK)."),
    devicePrivateKeyJson: z.union([z.string(), z.record(z.any())]).optional().describe("Device private key as a JSON string or object. Use this if the key file is not accessible by the server."),
    ephemeralKey: z.boolean().optional().describe("If true, generates a temporary key for testing. Ignored if devicePrivateKeyPath or devicePrivateKeyJson is provided."),
    verifierNonce: z.string().optional().describe("Optional nonce for replay protection"),
});

export const PreparePresentationSchema = z.object({
    requests: z.array(z.object({
        path: z.string().describe("Path to the source Tobari file"),
        fields: z.array(z.string()).describe("List of field IDs to disclose from this document"),
    })),
    verifierNonce: z.string().optional().describe("Nonce provided by the verifier"),
    webauthn: z.object({
        rpId: z.string().optional().describe("Relying Party ID for WebAuthn"),
        userVerification: z.enum(["required", "preferred", "discouraged"]).optional().describe("WebAuthn userVerification setting"),
        allowCredentials: z.array(z.object({
            idBase64Url: z.string().describe("Credential ID (base64url)"),
            type: z.literal("public-key").describe("Credential type"),
        })).optional().describe("Allow-list of WebAuthn credential IDs"),
    }).optional().describe("Optional WebAuthn metadata for browser clients"),
});

export const AssemblePresentationSchema = z.object({
    preparedData: z.any().optional().describe("The opaque state returned by prepare_presentation (deprecated, use preparationId)"),
    preparationId: z.string().optional().describe("ID of the prepared presentation session returned by prepare_presentation"),
    signatures: z.array(z.string()).describe("Base64 encoded signatures, one for each document in the original request order"),
    signatureFormat: z.enum(["der", "raw-ecdsa"]).optional().describe("Signature format: DER (default) or raw ECDSA (r||s)"),
    signatureEncoding: z.enum(["base64", "base64url"]).optional().describe("Encoding of signatures array (default: base64)"),
});

export const VerifyPresentationSchema = z.object({
    vpBase64: z.string().describe("The base64-encoded DeviceResponse (VP) to verify"),
    issuerPublicKeys: z.record(z.string()).describe("Map of docType to absolute path of issuer's public key (JWK)"),
    verifierNonce: z.string().optional().describe("Expected nonce to prevent replay attacks"),
});

export const AnalyzeServiceRequestSchema = z.object({
    path: z.string().describe("Path to the Service Request Tobari file (.cose or .html)"),
});

export const ListAvailableDocumentsSchema = z.object({
    rootPath: z.string().optional().describe("Optional path to scan. Defaults to the Tobari examples directory."),
});

export const SignWithWebAuthnSchema = z.object({
    challenge: z.string().describe("Base64URL encoded challenge to sign"),
    rpId: z.string().optional().describe("Relying Party ID (domain) for the signature scope"),
    allowCredentials: z.array(z.object({
        id: z.string().describe("Credential ID (base64url)"),
        type: z.literal("public-key").default("public-key"),
        transports: z.array(z.string()).optional()
    })).optional().describe("List of allowed credential IDs to restrict the sign-in choice")
});

export const RegisterWebAuthnSchema = z.object({
    challenge: z.string().describe("Base64URL encoded challenge for registration"),
    rpId: z.string().optional().describe("Relying Party ID (default: localhost)"),
    userName: z.string().optional().describe("User name for the new credential"),
    userDisplayName: z.string().optional().describe("Display name for the new credential"),
});

export const SignWithJPKISchema = z.object({
    data: z.string().describe("Base64 encoded data to sign"),
    pin: z.string().describe("JPKI signature PIN code (6-16 digits)"),
    digest: z.enum(["sha1", "sha256", "sha512"]).optional().describe("Digest algorithm (default: sha256)"),
    detached: z.boolean().optional().describe("Create detached signature (default: true)"),
    format: z.enum(["pem", "der"]).optional().describe("Output format (default: der)"),
    mynaPath: z.string().optional().describe(`Path to myna binary (default: ${DEFAULT_MYNA_PATH})`),
});

export const ReadMyNumberSchema = z.object({
    pin: z.string().describe("Card PIN code for text input assistance (4 digits)"),
    mynaPath: z.string().optional().describe(`Path to myna binary (default: ${DEFAULT_MYNA_PATH})`),
});

export const ReadBasicInfoSchema = z.object({
    pin: z.string().describe("Card PIN code for text input assistance (4 digits)"),
    mynaPath: z.string().optional().describe(`Path to myna binary (default: ${DEFAULT_MYNA_PATH})`),
});

export const ReadPhotoSchema = z.object({
    pin: z.string().describe("Card PIN code for visual verification (4 digits)"),
    mynaPath: z.string().optional().describe(`Path to myna binary (default: ${DEFAULT_MYNA_PATH})`),
});

export const StartDemoServerSchema = z.object({});
