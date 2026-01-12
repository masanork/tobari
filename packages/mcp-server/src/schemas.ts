import { z } from "zod";
import { DEFAULT_MYNA_PATH } from "./utils.js";

const DecryptOptionsSchema = z.object({
    hpkeSecret: z.string().optional().describe("Override HPKE secret used for decryption (defaults to TOBARI_HPKE_SECRET or demo secret)."),
    hpkeInfo: z.string().optional().describe("Override HPKE info (defaults to TOBARI_HPKE_INFO or demo info)."),
    pqcPrivateKeyPath: z.string().optional().describe("Path to recipient PQC private key (base64url JSON) for hybrid decryption.")
}).optional().describe("Optional decryption overrides for encrypted Tobari files.");

// Define tool schemas
export const ReadTobariFileSchema = z.object({
    path: z.string().describe("Absolute path to the Tobari file (.cose or .html)"),
    issuerPublicKeyPath: z.string().optional().describe("Absolute path to the issuer's public key (JWK/JSON format) for verification"),
    issuerPqcPublicKeyPath: z.string().optional().describe("Absolute path to the issuer's PQC public key (base64url JSON)"),
    decrypt: DecryptOptionsSchema,
});

export const CreatePresentationSchema = z.object({
    requests: z.array(z.object({
        path: z.string().describe("Path to the source Tobari file"),
        fields: z.array(z.string()).describe("List of field IDs to disclose from this document"),
    })),
    devicePrivateKeyPath: z.string().optional().describe("Path to the holder's device private key (JWK)."),
    devicePrivateKeyJson: z.union([z.string(), z.record(z.any())]).optional().describe("Device private key as a JSON string or object. Use this if the key file is not accessible by the server."),
    ephemeralKey: z.boolean().optional().describe("If true, generates a temporary key for testing. Ignored if devicePrivateKeyPath or devicePrivateKeyJson is provided."),
    signerPath: z.string().optional().describe("Path to the tobari-signer binary. Overrides TOBARI_SIGNER_PATH if set."),
    fallbackToEphemeral: z.boolean().optional().describe("If true, falls back to an ephemeral key when signer is unavailable."),
    verifierNonce: z.string().optional().describe("Optional nonce for replay protection"),
    deviceAlg: z.number().optional().describe("COSE algorithm for DeviceAuth (default: -35 / ES384, use -7 for ES256)"),
    decrypt: DecryptOptionsSchema.describe("Optional decryption settings applied to all input documents."),
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
    decrypt: DecryptOptionsSchema.describe("Optional decryption settings applied to all input documents."),
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
    issuerPqcPublicKeys: z.record(z.string()).optional().describe("Optional map of docType to absolute path of issuer's PQC public key (base64url JSON)"),
    verifierNonce: z.string().optional().describe("Expected nonce to prevent replay attacks"),
});

export const PreviewPresentationSchema = z.object({
    vpBase64: z.string().describe("The base64-encoded DeviceResponse (VP) to preview"),
    issuerPublicKeys: z.record(z.string()).optional().describe("Optional map of docType to absolute path of issuer's public key (JWK)"),
    issuerPqcPublicKeys: z.record(z.string()).optional().describe("Optional map of docType to absolute path of issuer's PQC public key (base64url JSON)"),
    verifierNonce: z.string().optional().describe("Expected nonce to prevent replay attacks"),
    format: z.enum(["summary", "readable", "full"]).optional().describe("Output format: summary, readable (default), or full."),
    includeDecoded: z.boolean().optional().describe("Include decoded VP JSON payload (may be large)."),
    redact: z.boolean().optional().describe("Redact string values in readable output."),
    maxStringLength: z.number().optional().describe("Maximum string length before truncation in readable output."),
});

export const AnalyzeServiceRequestSchema = z.object({
    path: z.string().describe("Path to the Service Request Tobari file (.cose or .html)"),
    decrypt: DecryptOptionsSchema,
});

export const ListAvailableDocumentsSchema = z.object({
    rootPath: z.string().optional().describe("Optional path to scan. Defaults to the Tobari examples directory."),
    decrypt: DecryptOptionsSchema,
});

export const GeneratePassportZkpInputSchema = z.object({
    path: z.string().describe("Path to the Passport Tobari file"),
    ageThreshold: z.number().default(18).describe("Age threshold to prove (default: 18)"),
    currentDate: z.array(z.number()).length(3).optional().describe("Reference date [YYYY, MM, DD]. Defaults to today."),
    secret: z.string().optional().describe("Base64 encoded secret for nullifier. If not provided, a random one will be generated."),
    decrypt: DecryptOptionsSchema,
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
    demo: z.boolean().optional().describe("Use demo/mock mode with simulated card reader (default: false)"),
});

export const ReadMyNumberSchema = z.object({
    pin: z.string().describe("Card PIN code for text input assistance (4 digits)"),
    mynaPath: z.string().optional().describe(`Path to myna binary (default: ${DEFAULT_MYNA_PATH})`),
    demo: z.boolean().optional().describe("Use demo/mock mode with simulated card reader (default: false)"),
});

export const ReadBasicInfoSchema = z.object({
    pin: z.string().describe("Card PIN code for text input assistance (4 digits)"),
    mynaPath: z.string().optional().describe(`Path to myna binary (default: ${DEFAULT_MYNA_PATH})`),
    demo: z.boolean().optional().describe("Use demo/mock mode with simulated card reader (default: false)"),
});

export const ReadPhotoSchema = z.object({
    pin: z.string().describe("Card PIN code for visual verification (4 digits)"),
    mynaPath: z.string().optional().describe(`Path to myna binary (default: ${DEFAULT_MYNA_PATH})`),
    demo: z.boolean().optional().describe("Use demo/mock mode with simulated card reader (default: false)"),
});

export const ReadPassportSchema = z.object({
    mrz: z.string().optional().describe("MRZ info (PassportNo+Birth+Expiry with check digits)"),
    can: z.string().optional().describe("6-digit Card Access Number (for PACE)"),
    usePace: z.boolean().optional().describe("Force use of PACE instead of BAC"),
});

export const ReadDriverLicenseSchema = z.object({
    pin1: z.string().describe("4-digit PIN1"),
    pin2: z.string().describe("4-digit PIN2"),
});

export const ReadResidenceCardSchema = z.object({
    // No PIN usually required for basic info
});

export const RegisterDeviceSchema = z.object({
    rootPath: z.string().optional().describe("Optional path where to save the exported public keys. If not provided, keys are only returned in the response."),
});

export const IssueLocalCredentialSchema = z.object({
    pin: z.string().describe("4-digit PIN for My Number Card"),
    outputPath: z.string().describe("Where to save the generated .cose file (e.g. ./my-identity.cose)"),
    issuerName: z.string().optional().default("My Hardware Device").describe("Label for the issuer in the document"),
});

export const IssueIdentityDocumentSchema = z.object({
    docType: z.string().describe("Document type ID (e.g. io.github.masanork.tobari.passport.v1)"),
    title: z.string().describe("Human readable title for the document"),
    data: z.record(z.any()).describe("Key-value pairs of identity data"),
    outputPath: z.string().describe("File path to save the .cose file"),
    encrypt: z.boolean().optional().default(true).describe("Whether to encrypt the document using the device hardware key"),
});

export const GenerateBbsKeySchema = z.object({
    // No arguments needed for now
});

export const SignWithBbsSchema = z.object({
    publicKey: z.string().describe("BBS+ Public Key (JSON string)"),
    signature: z.string().describe("BBS+ Signature (JSON string)"),
    messages: z.array(z.string()).describe("All messages that were originally signed"),
    revealedIndices: z.array(z.number()).describe("Indices of messages to reveal in the proof"),
    nonce: z.string().describe("Challenge/nonce for replay protection (Base64URL)"),
});


