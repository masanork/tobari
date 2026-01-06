
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import { decode, encode } from "cbor-x";
import { verifyTobari, verifyPresentation } from "@tobari/codec/validator";
import { createPresentation, signDeviceAuth, getDeviceAuthToBeSigned, assembleDeviceAuth } from "@tobari/codec/sd";
import { WebAuthnHandler } from "./webauthn-handler.js";

// Define tool schemas
const ReadTobariFileSchema = z.object({
    path: z.string().describe("Absolute path to the Tobari file (.cose or .html)"),
    issuerPublicKeyPath: z.string().optional().describe("Absolute path to the issuer's public key (JWK/JSON format) for verification"),
});

const CreatePresentationSchema = z.object({
    requests: z.array(z.object({
        path: z.string().describe("Path to the source Tobari file"),
        fields: z.array(z.string()).describe("List of field IDs to disclose from this document"),
    })),
    devicePrivateKeyPath: z.string().optional().describe("Path to the holder's device private key (JWK). If omitted, attempts to launch Tobari Signer UI."),
    verifierNonce: z.string().optional().describe("Nonce provided by the verifier to prevent replay attacks"),
});

const PreparePresentationSchema = z.object({
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

const AssemblePresentationSchema = z.object({
    preparedData: z.any().describe("The opaque state returned by prepare_presentation"),
    signatures: z.array(z.string()).describe("Base64 encoded signatures, one for each document in the original request order"),
    signatureFormat: z.enum(["der", "raw-ecdsa"]).optional().describe("Signature format: DER (default) or raw ECDSA (r||s)"),
    signatureEncoding: z.enum(["base64", "base64url"]).optional().describe("Encoding of signatures array (default: base64)"),
});

const VerifyPresentationSchema = z.object({
    vpBase64: z.string().describe("The base64-encoded DeviceResponse (VP) to verify"),
    issuerPublicKeys: z.record(z.string()).describe("Map of docType to absolute path of issuer's public key (JWK)"),
    verifierNonce: z.string().optional().describe("Expected nonce to prevent replay attacks"),
});

const AnalyzeServiceRequestSchema = z.object({
    path: z.string().describe("Path to the Service Request Tobari file (.cose or .html)"),
});

const ListAvailableDocumentsSchema = z.object({
    rootPath: z.string().optional().describe("Optional path to scan. Defaults to the Tobari examples directory."),
});

const SignWithWebAuthnSchema = z.object({
    challenge: z.string().describe("Base64URL encoded challenge to sign"),
    rpId: z.string().optional().describe("Relying Party ID (domain) for the signature scope"),
    allowCredentials: z.array(z.object({
        id: z.string().describe("Credential ID (base64url)"),
        type: z.literal("public-key").default("public-key"),
        transports: z.array(z.string()).optional()
    })).optional().describe("List of allowed credential IDs to restrict the sign-in choice")
});

const RegisterWebAuthnSchema = z.object({
    challenge: z.string().describe("Base64URL encoded challenge for registration"),
    rpId: z.string().optional().describe("Relying Party ID (default: localhost)"),
    userName: z.string().optional().describe("User name for the new credential"),
    userDisplayName: z.string().optional().describe("Display name for the new credential"),
});

const SignWithJPKISchema = z.object({
    data: z.string().describe("Base64 encoded data to sign"),
    pin: z.string().describe("JPKI signature PIN code (6-16 digits)"),
    digest: z.enum(["sha1", "sha256", "sha512"]).optional().describe("Digest algorithm (default: sha256)"),
    detached: z.boolean().optional().describe("Create detached signature (default: true)"),
    format: z.enum(["pem", "der"]).optional().describe("Output format (default: der)"),
    mynaPath: z.string().optional().describe("Path to myna binary (default: ~/go/bin/myna)"),
});

const ReadMyNumberSchema = z.object({
    pin: z.string().describe("Card PIN code for text input assistance (4 digits)"),
    mynaPath: z.string().optional().describe("Path to myna binary (default: ~/go/bin/myna)"),
});

const ReadBasicInfoSchema = z.object({
    pin: z.string().describe("Card PIN code for text input assistance (4 digits)"),
    mynaPath: z.string().optional().describe("Path to myna binary (default: ~/go/bin/myna)"),
});

const ReadPhotoSchema = z.object({
    pin: z.string().describe("Card PIN code for visual verification (4 digits)"),
    mynaPath: z.string().optional().describe("Path to myna binary (default: ~/go/bin/myna)"),
});

/**
 * Helper to read a Tobari file (HTML or COSE) and return its binary buffer.
 */
async function readTobariFileAsBuffer(filePath: string): Promise<Uint8Array> {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html") {
        const htmlContent = await fs.readFile(filePath, "utf-8");
        
        // Faster lookup than regex matchAll for large files
        const marker = "window.__TOBARI_DATA__ = \"";
        const startIdx = htmlContent.indexOf(marker);
        if (startIdx === -1) {
            throw new Error("Could not find embedded Tobari data in HTML file.");
        }
        
        const dataStart = startIdx + marker.length;
        const endIdx = htmlContent.indexOf("\"", dataStart);
        if (endIdx === -1) {
            throw new Error("Could not find end of Tobari data in HTML file.");
        }

        let b64 = htmlContent.substring(dataStart, endIdx).replace(/\s/g, '');
        if (b64.startsWith("data:")) {
            const commaIdx = b64.indexOf(",");
            if (commaIdx !== -1) {
                b64 = b64.substring(commaIdx + 1);
            }
        }

        // Use native Buffer for fast base64 decoding
        return new Uint8Array(Buffer.from(b64, 'base64'));
    } else {
        return await fs.readFile(filePath);
    }
}

function decodeSignatureInput(signature: string, encoding: "base64" | "base64url"): Uint8Array {
    return new Uint8Array(Buffer.from(signature, encoding));
}

function rawEcdsaToDer(rawSignature: Uint8Array): Uint8Array {
    if (rawSignature.length % 2 !== 0) {
        throw new Error("Invalid raw ECDSA signature length");
    }
    const partLen = rawSignature.length / 2;
    const r = rawSignature.slice(0, partLen);
    const s = rawSignature.slice(partLen);

    const toInteger = (bytes: Uint8Array) => {
        let start = 0;
        while (start < bytes.length - 1 && bytes[start] === 0) start++;
        let trimmed = bytes.slice(start);
        if (trimmed[0] & 0x80) {
            const prefixed = new Uint8Array(trimmed.length + 1);
            prefixed[0] = 0x00;
            prefixed.set(trimmed, 1);
            trimmed = prefixed;
        }
        return trimmed;
    };

    const rInt = toInteger(r);
    const sInt = toInteger(s);
    const totalLen = 2 + rInt.length + 2 + sInt.length;
    const der = new Uint8Array(2 + totalLen);
    let offset = 0;
    der[offset++] = 0x30;
    der[offset++] = totalLen;
    der[offset++] = 0x02;
    der[offset++] = rInt.length;
    der.set(rInt, offset);
    offset += rInt.length;
    der[offset++] = 0x02;
    der[offset++] = sInt.length;
    der.set(sInt, offset);
    return der;
}

const server = new Server(
    {
        name: "tobari-mcp-server",
        version: "0.1.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "read_tobari_file",
                description: "Reads a Tobari file (.cose or .html), extracts the embedded data, and optionally verifies the signature.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Absolute path to the Tobari file",
                        },
                        issuerPublicKeyPath: {
                            type: "string",
                            description: "Absolute path to the issuer's public key (JWK) for verification",
                        },
                    },
                    required: ["path"],
                },
            },
            {
                name: "create_presentation",
                description: "Creates a Verifiable Presentation (VP) by selectively disclosing fields from one or more Tobari documents and signing with a device key.",
                inputSchema: {
                    type: "object",
                    properties: {
                        requests: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    path: { type: "string", description: "Path to source file" },
                                    fields: { type: "array", items: { type: "string" }, description: "Fields to disclose" }
                                },
                                required: ["path", "fields"]
                            }
                        },
                        devicePrivateKeyPath: {
                            type: "string",
                            description: "Path to holder's private key (JWK). Optional if using external signer UI."
                        },
                        verifierNonce: {
                            type: "string",
                            description: "Optional nonce for replay protection"
                        }
                    },
                    required: ["requests"]
                }
            },
            {
                name: "prepare_presentation",
                description: "Step 1 of external signing: Extracts fields and generates the 'To Be Signed' data for each document.",
                inputSchema: {
                    type: "object",
                    properties: {
                        requests: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    path: { type: "string" },
                                    fields: { type: "array", items: { type: "string" } }
                                },
                                required: ["path", "fields"]
                            }
                        },
                        verifierNonce: { type: "string" },
                        webauthn: {
                            type: "object",
                            description: "Optional WebAuthn metadata for browser clients",
                            properties: {
                                rpId: { type: "string", description: "Relying Party ID" },
                                userVerification: { type: "string", description: "required | preferred | discouraged" },
                                allowCredentials: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            idBase64Url: { type: "string", description: "Credential ID (base64url)" },
                                            type: { type: "string", description: "Credential type (public-key)" }
                                        },
                                        required: ["idBase64Url", "type"]
                                    }
                                }
                            }
                        }
                    },
                    required: ["requests"]
                }
            },
            {
                name: "assemble_presentation",
                description: "Step 2 of external signing: Assembles the final Verifiable Presentation using externally generated signatures.",
                inputSchema: {
                    type: "object",
                    properties: {
                        preparedData: { type: "object", description: "Opaque state from prepare_presentation" },
                        signatures: { type: "array", items: { type: "string" }, description: "Base64 signatures" },
                        signatureFormat: { type: "string", description: "der (default) or raw-ecdsa" },
                        signatureEncoding: { type: "string", description: "base64 (default) or base64url" }
                    },
                    required: ["preparedData", "signatures"]
                }
            },
            {
                name: "verify_presentation",
                description: "Verifies a Verifiable Presentation (VP), checking both Issuer and Holder (Device) signatures.",
                inputSchema: {
                    type: "object",
                    properties: {
                        vpBase64: { type: "string", description: "Base64-encoded DeviceResponse" },
                        issuerPublicKeys: { 
                            type: "object", 
                            additionalProperties: { type: "string" },
                            description: "Map of docType to path of issuer's public key (JWK)"
                        },
                        verifierNonce: { type: "string" }
                    },
                    required: ["vpBase64", "issuerPublicKeys"]
                }
            },
            {
                name: "analyze_service_request",
                description: "Analyzes an administrative service request document to identify required credentials and user inputs.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Path to the service request file" }
                    },
                    required: ["path"]
                }
            },
            {
                name: "list_available_documents",
                description: "Lists available Tobari documents and service requests found in the project's examples or specified directory. Use this to discover files without asking the user for paths.",
                inputSchema: {
                    type: "object",
                    properties: {
                        rootPath: { type: "string", description: "Root directory to scan (optional)" }
                    }
                }
            },
            {
                name: "sign_with_webauthn",
                description: "Signs a challenge using the system's WebAuthn authenticator (Touch ID, Face ID, YubiKey) by opening a browser window. Useful for holder binding signatures.",
                inputSchema: {
                    type: "object",
                    properties: {
                        challenge: { type: "string", description: "Base64URL encoded challenge to sign" },
                        rpId: { type: "string", description: "Relying Party ID (default: localhost)" },
                        allowCredentials: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    type: { type: "string" }
                                }
                            }
                        }
                    },
                    required: ["challenge"]
                }
            },
            {
                name: "register_webauthn",
                description: "Registers a new WebAuthn credential (Passkey) on this device. Use this if the user does not have a key yet.",
                inputSchema: {
                    type: "object",
                    properties: {
                        challenge: { type: "string", description: "Base64URL encoded challenge" },
                        rpId: { type: "string", description: "Relying Party ID" },
                        userName: { type: "string" },
                        userDisplayName: { type: "string" }
                    },
                    required: ["challenge"]
                }
            },
            {
                name: "sign_with_jpki",
                description: "Signs data using JPKI (Japanese Public Key Infrastructure) with マイナンバーカード via the myna CLI tool. Requires a card reader and PIN code.",
                inputSchema: {
                    type: "object",
                    properties: {
                        data: { type: "string", description: "Base64 encoded data to sign" },
                        pin: { type: "string", description: "JPKI signature PIN code (6-16 digits)" },
                        digest: { type: "string", description: "Digest algorithm: sha1, sha256, or sha512 (default: sha256)" },
                        detached: { type: "boolean", description: "Create detached signature (default: true)" },
                        format: { type: "string", description: "Output format: pem or der (default: der)" },
                        mynaPath: { type: "string", description: "Path to myna binary (default: ~/go/bin/myna)" }
                    },
                    required: ["data", "pin"]
                }
            },
            {
                name: "read_mynumber",
                description: "Reads My Number (個人番号) from マイナンバーカード using the text input assistance AP. Requires a card reader and 4-digit PIN.",
                inputSchema: {
                    type: "object",
                    properties: {
                        pin: { type: "string", description: "Card PIN code for text input assistance (4 digits)" },
                        mynaPath: { type: "string", description: "Path to myna binary (default: ~/go/bin/myna)" }
                    },
                    required: ["pin"]
                }
            },
            {
                name: "read_basic_info",
                description: "Reads basic personal information (氏名, 生年月日, 性別, 住所) from マイナンバーカード using the text input assistance AP. Requires a card reader and 4-digit PIN.",
                inputSchema: {
                    type: "object",
                    properties: {
                        pin: { type: "string", description: "Card PIN code for text input assistance (4 digits)" },
                        mynaPath: { type: "string", description: "Path to myna binary (default: ~/go/bin/myna)" }
                    },
                    required: ["pin"]
                }
            },
            {
                name: "read_photo",
                description: "Reads the photo from マイナンバーカード using the visual verification AP. Returns JPEG2000 image as base64. Requires a card reader and 4-digit PIN.",
                inputSchema: {
                    type: "object",
                    properties: {
                        pin: { type: "string", description: "Card PIN code for visual verification (4 digits)" },
                        mynaPath: { type: "string", description: "Path to myna binary (default: ~/go/bin/myna)" }
                    },
                    required: ["pin"]
                }
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    if (request.params.name === "read_tobari_file") {
        try {
            const args = ReadTobariFileSchema.parse(request.params.arguments);
            const filePath = args.path;
            const fileBuffer = await readTobariFileAsBuffer(filePath);

            let isValid: boolean | string = "Skipped (No public key provided)";

            if (args.issuerPublicKeyPath) {
                const keyContent = await fs.readFile(args.issuerPublicKeyPath, "utf-8");
                const jwk = JSON.parse(keyContent);

                const cryptoKey = await crypto.subtle.importKey(
                    "jwk",
                    jwk,
                    { name: "ECDSA", namedCurve: jwk.crv }, // Typically P-256 or P-384
                    false,
                    ["verify"]
                );

                try {
                    const result = await verifyTobari(fileBuffer, cryptoKey);
                    isValid = result.isValid;
                } catch (e: any) {
                    isValid = `Verification failed: ${e.message}`;
                }
            }

            let cose = decode(fileBuffer);

            // Handle cbor-x Tagged object unwrapping
            while (cose && typeof cose === "object" && !Array.isArray(cose) && ((cose as any).tag !== undefined)) {
                if ((cose as any).value !== undefined) {
                    cose = (cose as any).value;
                } else {
                    break;
                }
            }

            let payload: any = {};
            let isTobariDoc = false;

            // Check if it's a Tobari Document (mdoc structure)
            if (cose && typeof cose === 'object' && !Array.isArray(cose) && cose.issuerSigned) {
                isTobariDoc = true;
                payload.docType = cose.docType;
                
                // Extract data from nameSpaces
                if (cose.issuerSigned.nameSpaces) {
                    for (const ns of Object.keys(cose.issuerSigned.nameSpaces)) {
                        const items = cose.issuerSigned.nameSpaces[ns];
                        for (const itemBytes of items) {
                            try {
                                // itemBytes is a Tagged or Uint8Array of [digestID, random, elementIdentifier, elementValue]
                                const item = decode(itemBytes);
                                if (Array.isArray(item) && item.length >= 4) {
                                    const [_, __, key, value] = item;
                                    payload[key] = value;
                                }
                            } catch (e) {
                                console.error(`Failed to decode item in namespace ${ns}:`, e);
                            }
                        }
                    }
                }
            } else if (Array.isArray(cose) && cose.length >= 3) {
                // COSE_Sign1 is array [protected, unprotected, payload, signature]
                const payloadData = cose[2];
                if (payloadData instanceof Uint8Array) {
                    payload = decode(payloadData);
                } else if (payloadData && typeof payloadData === 'object') {
                    // Try to reconstruct bytes if it's an array-like object returned by cbor-x
                    try {
                        let bytes: Uint8Array;
                        if ('length' in payloadData && typeof (payloadData as any).length === 'number') {
                            bytes = Buffer.from(payloadData as any);
                        } else {
                            const keys = Object.keys(payloadData).filter(k => !isNaN(Number(k)));
                            keys.sort((a, b) => Number(a) - Number(b));
                            bytes = new Uint8Array(keys.length);
                            for (let i = 0; i < keys.length; i++) {
                                bytes[i] = (payloadData as any)[keys[i]];
                            }
                        }
                        payload = decode(bytes);
                    } catch (e: any) {
                        payload = { error: "Failed to reconstruct/decode payload", details: e.message, raw: payloadData };
                    }
                } else {
                    payload = { error: "Payload is not Uint8Array or object", raw: payloadData };
                }
            } else {
                payload = { error: "Unknown structure (not a Tobari doc or COSE_Sign1)", raw: cose };
            }

            let responseData: any;
            const meta = {
                valid: isValid,
                source: filePath
            };

            // If payload is a valid document object, spread it at the top level
            if (payload && typeof payload === 'object' && !Array.isArray(payload) && !payload.error) {
                responseData = {
                    ...payload,
                    _meta: meta
                };
            } else {
                responseData = {
                    payload: payload,
                    _meta: meta
                };
            }

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(responseData, null, 2),
                    },
                ],
            };

        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error processing file: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }

    if (request.params.name === "create_presentation") {
        try {
            const args = CreatePresentationSchema.parse(request.params.arguments);
            const documents = [];

            let devicePrivateKey: CryptoKey | undefined;
            if (args.devicePrivateKeyPath) {
                // Load and parse private key
                const keyContent = await fs.readFile(args.devicePrivateKeyPath, "utf-8");
                const jwk = JSON.parse(keyContent);
                devicePrivateKey = await crypto.subtle.importKey(
                    "jwk",
                    jwk,
                    { name: "ECDSA", namedCurve: jwk.crv || "P-384" },
                    true,
                    ["sign"]
                );
            }

            for (const req of args.requests) {
                const filePath = req.path;
                const fileBuffer = await readTobariFileAsBuffer(filePath);

                const fullDoc = decode(fileBuffer);
                // Selective Disclosure
                const disclosedDoc = await createPresentation(fullDoc, req.fields);

                // Device Signing
                const deviceNameSpaces = new Map(); // Empty for now as per simple mdoc
                const deviceNameSpacesBytes = encode(deviceNameSpaces);
                
                // Session Transcript for Online Presentation (simplified)
                const sessionTranscript = [null, null, args.verifierNonce || null];

                let deviceAuth;

                if (devicePrivateKey) {
                    deviceAuth = await signDeviceAuth(
                        disclosedDoc.docType,
                        deviceNameSpacesBytes,
                        sessionTranscript,
                        devicePrivateKey
                    );
                } else {
                    // External Signer Flow (Tauri App)
                    const { toBeSigned, protectedHeaderBytes } = await getDeviceAuthToBeSigned(
                        disclosedDoc.docType,
                        deviceNameSpacesBytes,
                        sessionTranscript
                    );

                    // Locate Signer Binary
                    let signerPath = process.env.TOBARI_SIGNER_PATH;
                    if (!signerPath) {
                        // Assuming running from packages/mcp-server/src or similar
                        // Try to find relative to project root
                        // Current file is .../packages/mcp-server/src/index.ts
                        const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
                        
                        // Check common build locations
                        const possiblePaths = [
                            path.join(projectRoot, "packages/signer/src-tauri/target/release/tobari-signer"), // Unix/Mac
                            path.join(projectRoot, "packages/signer/src-tauri/target/release/tobari-signer.exe"), // Windows
                            path.join(projectRoot, "packages/signer/src-tauri/target/debug/tobari-signer"), // Debug Unix/Mac
                            path.join(projectRoot, "packages/signer/src-tauri/target/debug/tobari-signer.exe") // Debug Windows
                        ];

                        for (const p of possiblePaths) {
                            try {
                                await fs.access(p);
                                signerPath = p;
                                break;
                            } catch {}
                        }
                    }

                    if (!signerPath) {
                        throw new Error("Could not find 'tobari-signer' binary. Please build the signer package or set TOBARI_SIGNER_PATH.");
                    }

                    const signRequest = {
                        challenge: Buffer.from(toBeSigned).toString('base64url'),
                        rp_id: "tobari-mcp-server",
                        message: `Sign presentation for ${disclosedDoc.docType}`,
                        user_verification: "preferred"
                    };

                    // Spawn the signer process
                    const signerProcess = spawn(signerPath, ["--request", JSON.stringify(signRequest)]);
                    
                    const resultPromise = new Promise<string>((resolve, reject) => {
                        let stdout = "";
                        let stderr = "";
                        signerProcess.stdout.on("data", (data) => stdout += data);
                        signerProcess.stderr.on("data", (data) => stderr += data);
                        signerProcess.on("close", (code) => {
                            if (code === 0) resolve(stdout);
                            else reject(new Error(`Signer exited with code ${code}: ${stderr}`));
                        });
                        signerProcess.on("error", (err) => reject(err));
                    });
                    
                    const outputStr = await resultPromise;
                    let output;
                    try {
                        output = JSON.parse(outputStr);
                    } catch (e) {
                         throw new Error(`Invalid JSON output from signer: ${outputStr}`);
                    }
                    
                    // Assemble deviceAuth with the external signature
                    // Note: This signature is a WebAuthn assertion signature, not a raw ECDSA signature over toBeSigned.
                    // The verifier must be aware of this distinction.
                    const signatureBytes = new Uint8Array(Buffer.from(output.signature, 'base64url'));

                    deviceAuth = await assembleDeviceAuth(
                        protectedHeaderBytes,
                        disclosedDoc.docType,
                        deviceNameSpacesBytes,
                        sessionTranscript,
                        signatureBytes
                    );
                }

                documents.push({
                    docType: disclosedDoc.docType,
                    issuerSigned: disclosedDoc.issuerSigned,
                    deviceSigned: {
                        nameSpaces: deviceNameSpacesBytes,
                        deviceAuth: deviceAuth
                    }
                });
            }

            const deviceResponse = {
                version: "1.0",
                documents: documents,
                status: 0
            };

            const vpBytes = encode(deviceResponse);
            const vpBase64 = Buffer.from(vpBytes).toString('base64');

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            vp_base64: vpBase64,
                            description: "Verifiable Presentation created successfully.",
                            document_count: documents.length,
                            signing_method: devicePrivateKey ? "internal_key" : "external_signer"
                        }, null, 2),
                    },
                ],
            };

        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error creating VP: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "prepare_presentation") {
        try {
            const args = PreparePresentationSchema.parse(request.params.arguments);
            const itemsToSign = [];
            const preparedDocs = [];

            for (const req of args.requests) {
                const filePath = req.path;
                const fileBuffer = await readTobariFileAsBuffer(filePath);

                const fullDoc = decode(fileBuffer);
                const disclosedDoc = await createPresentation(fullDoc, req.fields);

                const deviceNameSpaces = new Map();
                const deviceNameSpacesBytes = encode(deviceNameSpaces);
                const sessionTranscript = [null, null, args.verifierNonce || null];

                const { toBeSigned, protectedHeaderBytes } = await getDeviceAuthToBeSigned(
                    disclosedDoc.docType,
                    deviceNameSpacesBytes,
                    sessionTranscript
                );

                const { encodeCanonical } = await import('@tobari/crypto/cbor');
                const deviceAuthPayload = [
                    "DeviceAuthentication",
                    sessionTranscript,
                    disclosedDoc.docType,
                    deviceNameSpacesBytes
                ];
                const deviceAuthPayloadBytes = encodeCanonical(deviceAuthPayload);

                itemsToSign.push({
                    docType: disclosedDoc.docType,
                    toBeSignedHex: Buffer.from(toBeSigned).toString('hex'),
                    toBeSignedBase64: Buffer.from(toBeSigned).toString('base64'),
                    toBeSignedBase64Url: Buffer.from(toBeSigned).toString('base64url'),
                    deviceAuthPayloadBase64: Buffer.from(deviceAuthPayloadBytes).toString('base64'),
                    deviceAuthPayloadBase64Url: Buffer.from(deviceAuthPayloadBytes).toString('base64url'),
                    webauthn: {
                        challengeBase64Url: Buffer.from(toBeSigned).toString('base64url'),
                        rpId: args.webauthn?.rpId || null,
                        userVerification: args.webauthn?.userVerification || "preferred",
                        allowCredentials: args.webauthn?.allowCredentials || []
                    }
                });

                preparedDocs.push({
                    docType: disclosedDoc.docType,
                    issuerSigned: disclosedDoc.issuerSigned,
                    deviceNameSpacesBytes: Buffer.from(deviceNameSpacesBytes).toString('base64'),
                    protectedHeaderBytes: Buffer.from(protectedHeaderBytes).toString('base64'),
                    sessionTranscript: sessionTranscript
                });
            }

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            itemsToSign,
                            preparedData: preparedDocs // This is the state for assemble_presentation
                        }, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error preparing VP: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "assemble_presentation") {
        try {
            const args = AssemblePresentationSchema.parse(request.params.arguments);
            const documents = [];
            const preparedDocs = args.preparedData as any[];
            const signatureFormat = args.signatureFormat || "der";
            const signatureEncoding = args.signatureEncoding || "base64";

            if (preparedDocs.length !== args.signatures.length) {
                throw new Error("Number of signatures does not match number of documents");
            }

            for (let i = 0; i < preparedDocs.length; i++) {
                const p = preparedDocs[i];
                const inputSignature = decodeSignatureInput(args.signatures[i], signatureEncoding);
                const signature = signatureFormat === "raw-ecdsa"
                    ? rawEcdsaToDer(inputSignature)
                    : inputSignature;

                const deviceAuth = await assembleDeviceAuth(
                    new Uint8Array(Buffer.from(p.protectedHeaderBytes, 'base64')),
                    p.docType,
                    new Uint8Array(Buffer.from(p.deviceNameSpacesBytes, 'base64')),
                    p.sessionTranscript,
                    signature
                );

                documents.push({
                    docType: p.docType,
                    issuerSigned: p.issuerSigned,
                    deviceSigned: {
                        nameSpaces: new Uint8Array(Buffer.from(p.deviceNameSpacesBytes, 'base64')),
                        deviceAuth: deviceAuth
                    }
                });
            }

            const deviceResponse = {
                version: "1.0",
                documents: documents,
                status: 0
            };

            const vpBytes = encode(deviceResponse);
            const vpBase64 = Buffer.from(vpBytes).toString('base64');

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            vp_base64: vpBase64,
                            document_count: documents.length
                        }, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error assembling VP: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "verify_presentation") {
        try {
            const args = VerifyPresentationSchema.parse(request.params.arguments);
            const vpBytes = new Uint8Array(Buffer.from(args.vpBase64, 'base64'));
            const presentation = decode(vpBytes);

            const issuerKeys: Record<string, CryptoKey> = {};
            for (const docType of Object.keys(args.issuerPublicKeys)) {
                const keyPath = args.issuerPublicKeys[docType];
                const keyContent = await fs.readFile(keyPath, "utf-8");
                const jwk = JSON.parse(keyContent);
                issuerKeys[docType] = await crypto.subtle.importKey(
                    "jwk", jwk, { name: "ECDSA", namedCurve: jwk.crv || "P-384" }, true, ["verify"]
                );
            }

            const results = await verifyPresentation(presentation, issuerKeys, args.verifierNonce);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            results,
                            overall_valid: results.every(r => r.issuerValid && r.deviceValid)
                        }, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error verifying VP: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "analyze_service_request") {
        try {
            const args = AnalyzeServiceRequestSchema.parse(request.params.arguments);
            const filePath = args.path;
            const fileBuffer = await readTobariFileAsBuffer(filePath);

            // Using simple read logic instead of full verification for analysis
            const cose = decode(fileBuffer);
            let payload: any = {};
            
            // Extract payload from nameSpaces (Administrative documents follow same mdoc structure)
            if (cose.issuerSigned && cose.issuerSigned.nameSpaces) {
                for (const ns of Object.keys(cose.issuerSigned.nameSpaces)) {
                    for (const itemBytes of cose.issuerSigned.nameSpaces[ns]) {
                        const [_, __, key, value] = decode(itemBytes);
                        payload[key] = value;
                    }
                }
            }

            const pd = payload.presentation_definition;
            if (!pd) throw new Error("Document does not contain a presentation_definition");

            const requiredCredentials = [];
            const requiredUserInputs = [];

            if (pd.input_descriptors) {
                for (const desc of pd.input_descriptors) {
                    const fields = desc.constraints?.fields || [];
                    const isMdoc = desc.format?.mso_mdoc !== undefined;

                    if (isMdoc) {
                        const requiredFields = fields.map((f: any) => {
                            const path = f.path[0];
                            const match = path.match(/\$\[\'(.+)\'\]\[\'(.+)\'\]/);
                            return match ? { docType: match[1], field: match[2] } : { rawPath: path };
                        });
                        requiredCredentials.push({
                            id: desc.id,
                            name: desc.name,
                            purpose: desc.purpose,
                            requiredFields
                        });
                    } else {
                        // Assume user input if not mdoc
                        const fieldsToAsk = fields.map((f: any) => ({
                            id: f.path[0].match(/\$\[\'(.+)\'\]/)?.[1] || f.path[0],
                            label: f.label || f.id
                        }));
                        requiredUserInputs.push({
                            id: desc.id,
                            name: desc.name,
                            purpose: desc.purpose,
                            fields: fieldsToAsk
                        });
                    }
                }
            }

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            title: payload.title,
                            description: payload.description,
                            eligibility: payload.eligibility,
                            submission_uri: payload.submission_uri,
                            requiredCredentials,
                            requiredUserInputs
                        }, null, 2),
                    },
                ],
            };

        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error analyzing service request: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "list_available_documents") {
        try {
            const args = ListAvailableDocumentsSchema.parse(request.params.arguments);
            // Default to the project root's examples directory
            // packages/mcp-server/src/index.ts -> ../../../examples
            const baseDir = args.rootPath || path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../examples");
            
            const files = [];
            const scan = async (dir: string) => {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory() && entry.name !== "node_modules") {
                        await scan(fullPath);
                    } else if (entry.isFile() && (entry.name.endsWith(".html") || entry.name.endsWith(".cose"))) {
                        // Skip common non-Tobari HTML files if needed, but for now we list them
                        if (entry.name === "verifier-tool.html" || entry.name === "viewer-template.html") continue;
                        
                        try {
                            const buffer = await readTobariFileAsBuffer(fullPath);
                            const cose = decode(buffer);
                            let docType = cose.docType || "Unknown";
                            
                            // For COSE_Sign1, docType might be in the payload
                            if (Array.isArray(cose) && cose.length >= 3) {
                                try {
                                    const payload = decode(cose[2]);
                                    if (payload.docType) docType = payload.docType;
                                } catch {}
                            }

                            files.push({
                                name: entry.name,
                                path: fullPath,
                                type: docType,
                                category: docType.includes("service_request") ? "Administrative Request" : "Credential"
                            });
                        } catch (e) {
                            // Probably not a Tobari file, skip
                        }
                    }
                }
            };

            await scan(baseDir);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            baseDir,
                            documents: files
                        }, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error listing documents: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "sign_with_webauthn") {
        try {
            const args = SignWithWebAuthnSchema.parse(request.params.arguments);
            const handler = new WebAuthnHandler();
            
            // This will block until the user signs in the browser
            const signature = await handler.sign({
                challenge: args.challenge,
                rpId: args.rpId,
                allowCredentials: args.allowCredentials as any
            });

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(signature, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error signing with WebAuthn: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "register_webauthn") {
        try {
            const args = RegisterWebAuthnSchema.parse(request.params.arguments);
            const handler = new WebAuthnHandler();

            const result = await handler.sign({
                mode: 'register',
                challenge: args.challenge,
                rpId: args.rpId,
                userName: args.userName,
                userDisplayName: args.userDisplayName
            });

            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error registering WebAuthn: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "sign_with_jpki") {
        try {
            const args = SignWithJPKISchema.parse(request.params.arguments);

            // Resolve myna path (expand ~ to home directory)
            const mynaPath = args.mynaPath || "~/go/bin/myna";
            const resolvedMynaPath = mynaPath.startsWith("~")
                ? path.join(os.homedir(), mynaPath.slice(1))
                : mynaPath;

            // Decode base64 data
            const dataBuffer = Buffer.from(args.data, 'base64');

            // Create temporary files
            const tmpDir = os.tmpdir();
            const inputFile = path.join(tmpDir, `jpki-input-${Date.now()}.bin`);
            const outputFile = path.join(tmpDir, `jpki-output-${Date.now()}.cms`);

            try {
                // Write data to temporary input file
                await fs.writeFile(inputFile, dataBuffer);

                // Build myna command arguments
                const cmdArgs = [
                    "jpki", "cms", "sign",
                    "-i", inputFile,
                    "-o", outputFile,
                    "-p", args.pin,
                    "-m", args.digest || "sha256",
                    "-f", args.format || "der"
                ];

                if (args.detached !== false) {
                    cmdArgs.push("--detached");
                }

                // Execute myna command
                const mynaProcess = spawn(resolvedMynaPath, cmdArgs);

                const resultPromise = new Promise<void>((resolve, reject) => {
                    let stdout = "";
                    let stderr = "";
                    mynaProcess.stdout.on("data", (data) => stdout += data.toString());
                    mynaProcess.stderr.on("data", (data) => stderr += data.toString());
                    mynaProcess.on("close", (code) => {
                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`myna exited with code ${code}: ${stderr || stdout}`));
                        }
                    });
                    mynaProcess.on("error", (err) => reject(err));
                });

                await resultPromise;

                // Read the signature from output file
                const signatureBuffer = await fs.readFile(outputFile);
                const signatureBase64 = signatureBuffer.toString('base64');

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                signature: signatureBase64,
                                format: args.format || "der",
                                digest: args.digest || "sha256",
                                detached: args.detached !== false
                            }, null, 2),
                        },
                    ],
                };
            } finally {
                // Clean up temporary files
                try {
                    await fs.unlink(inputFile);
                } catch {}
                try {
                    await fs.unlink(outputFile);
                } catch {}
            }
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error signing with JPKI: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "read_mynumber") {
        try {
            const args = ReadMyNumberSchema.parse(request.params.arguments);

            const mynaPath = args.mynaPath || "~/go/bin/myna";
            const resolvedMynaPath = mynaPath.startsWith("~")
                ? path.join(os.homedir(), mynaPath.slice(1))
                : mynaPath;

            const cmdArgs = ["text", "mynumber", "-p", args.pin];

            const mynaProcess = spawn(resolvedMynaPath, cmdArgs);

            const resultPromise = new Promise<string>((resolve, reject) => {
                let stdout = "";
                let stderr = "";
                mynaProcess.stdout.on("data", (data) => stdout += data.toString());
                mynaProcess.stderr.on("data", (data) => stderr += data.toString());
                mynaProcess.on("close", (code) => {
                    if (code === 0) {
                        resolve(stdout.trim());
                    } else {
                        reject(new Error(`myna exited with code ${code}: ${stderr || stdout}`));
                    }
                });
                mynaProcess.on("error", (err) => reject(err));
            });

            const mynumber = await resultPromise;

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            mynumber: mynumber
                        }, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error reading My Number: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "read_basic_info") {
        try {
            const args = ReadBasicInfoSchema.parse(request.params.arguments);

            const mynaPath = args.mynaPath || "~/go/bin/myna";
            const resolvedMynaPath = mynaPath.startsWith("~")
                ? path.join(os.homedir(), mynaPath.slice(1))
                : mynaPath;

            const cmdArgs = ["text", "attr", "-p", args.pin, "-f", "json"];

            const mynaProcess = spawn(resolvedMynaPath, cmdArgs);

            const resultPromise = new Promise<string>((resolve, reject) => {
                let stdout = "";
                let stderr = "";
                mynaProcess.stdout.on("data", (data) => stdout += data.toString());
                mynaProcess.stderr.on("data", (data) => stderr += data.toString());
                mynaProcess.on("close", (code) => {
                    if (code === 0) {
                        resolve(stdout.trim());
                    } else {
                        reject(new Error(`myna exited with code ${code}: ${stderr || stdout}`));
                    }
                });
                mynaProcess.on("error", (err) => reject(err));
            });

            const jsonOutput = await resultPromise;
            const basicInfo = JSON.parse(jsonOutput);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(basicInfo, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error reading basic info: ${error.message}` }],
                isError: true,
            };
        }
    }

    if (request.params.name === "read_photo") {
        try {
            const args = ReadPhotoSchema.parse(request.params.arguments);

            const mynaPath = args.mynaPath || "~/go/bin/myna";
            const resolvedMynaPath = mynaPath.startsWith("~")
                ? path.join(os.homedir(), mynaPath.slice(1))
                : mynaPath;

            const tmpDir = os.tmpdir();
            const outputFile = path.join(tmpDir, `mynumber-photo-${Date.now()}.jp2`);

            try {
                const cmdArgs = ["visual", "photo", "-p", args.pin, "-o", outputFile];

                const mynaProcess = spawn(resolvedMynaPath, cmdArgs);

                const resultPromise = new Promise<void>((resolve, reject) => {
                    let stdout = "";
                    let stderr = "";
                    mynaProcess.stdout.on("data", (data) => stdout += data.toString());
                    mynaProcess.stderr.on("data", (data) => stderr += data.toString());
                    mynaProcess.on("close", (code) => {
                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`myna exited with code ${code}: ${stderr || stdout}`));
                        }
                    });
                    mynaProcess.on("error", (err) => reject(err));
                });

                await resultPromise;

                const photoBuffer = await fs.readFile(outputFile);
                const photoBase64 = photoBuffer.toString('base64');

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                photo: photoBase64,
                                format: "jpeg2000"
                            }, null, 2),
                        },
                    ],
                };
            } finally {
                try {
                    await fs.unlink(outputFile);
                } catch {}
            }
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error reading photo: ${error.message}` }],
                isError: true,
            };
        }
    }

    throw new Error(`Tool not found: ${request.params.name}`);
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
