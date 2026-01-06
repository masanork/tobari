
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
import { decode, encode } from "cbor-x";
import { verifyTobari, verifyPresentation } from "@tobari/codec/validator";
import { createPresentation, signDeviceAuth, getDeviceAuthToBeSigned, assembleDeviceAuth } from "@tobari/codec/sd";

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
    devicePrivateKeyPath: z.string().describe("Path to the holder's device private key (JWK) for signing"),
    verifierNonce: z.string().optional().describe("Nonce provided by the verifier to prevent replay attacks"),
});

const PreparePresentationSchema = z.object({
    requests: z.array(z.object({
        path: z.string().describe("Path to the source Tobari file"),
        fields: z.array(z.string()).describe("List of field IDs to disclose from this document"),
    })),
    verifierNonce: z.string().optional().describe("Nonce provided by the verifier"),
});

const AssemblePresentationSchema = z.object({
    preparedData: z.any().describe("The opaque state returned by prepare_presentation"),
    signatures: z.array(z.string()).describe("Base64 encoded signatures, one for each document in the original request order"),
});

const VerifyPresentationSchema = z.object({
    vpBase64: z.string().describe("The base64-encoded DeviceResponse (VP) to verify"),
    issuerPublicKeys: z.record(z.string()).describe("Map of docType to absolute path of issuer's public key (JWK)"),
    verifierNonce: z.string().optional().describe("Expected nonce to prevent replay attacks"),
});

const AnalyzeServiceRequestSchema = z.object({
    path: z.string().describe("Path to the Service Request Tobari file (.cose or .html)"),
});

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
                            description: "Path to holder's private key (JWK)"
                        },
                        verifierNonce: {
                            type: "string",
                            description: "Optional nonce for replay protection"
                        }
                    },
                    required: ["requests", "devicePrivateKeyPath"]
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
                        verifierNonce: { type: "string" }
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
                        signatures: { type: "array", items: { type: "string" }, description: "Base64 signatures" }
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
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    if (request.params.name === "read_tobari_file") {
        try {
            const args = ReadTobariFileSchema.parse(request.params.arguments);
            const filePath = args.path;
            const ext = path.extname(filePath).toLowerCase();

            let fileBuffer: Uint8Array;

            if (ext === ".html") {
                const htmlContent = await fs.readFile(filePath, "utf-8");
                // Use matchAll to find the longest assignment, avoiding partial matches
                const matches = Array.from(htmlContent.matchAll(/window\.__TOBARI_DATA__\s*=\s*"([^"]+)"/g));
                let bestMatch = "";
                for (const m of matches) {
                    if (m[1].length > bestMatch.length) {
                        bestMatch = m[1];
                    }
                }

                if (!bestMatch) {
                    throw new Error("Could not find embedded Tobari data in HTML file.");
                }
                let b64 = bestMatch.replace(/\s/g, '');
                if (b64.startsWith("data:")) {
                    const commaIdx = b64.indexOf(",");
                    if (commaIdx !== -1) {
                        b64 = b64.substring(commaIdx + 1);
                    }
                }

                // Decode base64 to byte array
                // Bun/Node atob works
                const binString = atob(b64);
                fileBuffer = new Uint8Array(binString.length);
                for (let i = 0; i < binString.length; i++) {
                    fileBuffer[i] = binString.charCodeAt(i);
                }
            } else {
                fileBuffer = await fs.readFile(filePath);
            }

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

            // Load and parse private key
            const keyContent = await fs.readFile(args.devicePrivateKeyPath, "utf-8");
            const jwk = JSON.parse(keyContent);
            const devicePrivateKey = await crypto.subtle.importKey(
                "jwk",
                jwk,
                { name: "ECDSA", namedCurve: jwk.crv || "P-384" },
                true,
                ["sign"]
            );

            for (const req of args.requests) {
                const filePath = req.path;
                let fileBuffer: Uint8Array;
                
                if (filePath.toLowerCase().endsWith(".html")) {
                    const html = await fs.readFile(filePath, "utf-8");
                    const match = html.match(/window\.__TOBARI_DATA__\s*=\s*"([^"]+)"/);
                    if (!match) throw new Error(`No data found in ${filePath}`);
                    const bin = atob(match[1].replace(/data:.*,/, ''));
                    fileBuffer = Uint8Array.from(bin, c => c.charCodeAt(0));
                } else {
                    fileBuffer = await fs.readFile(filePath);
                }

                const fullDoc = decode(fileBuffer);
                // Selective Disclosure
                const disclosedDoc = await createPresentation(fullDoc, req.fields);

                // Device Signing
                const deviceNameSpaces = new Map(); // Empty for now as per simple mdoc
                const deviceNameSpacesBytes = encode(deviceNameSpaces);
                
                // Session Transcript for Online Presentation (simplified)
                // [DeviceEngagementBytes (null), ER_KeyBytes (null), Handover (Nonce)]
                const sessionTranscript = [null, null, args.verifierNonce || null];

                const deviceAuth = await signDeviceAuth(
                    disclosedDoc.docType,
                    deviceNameSpacesBytes,
                    sessionTranscript,
                    devicePrivateKey
                );

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
                            document_count: documents.length
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
                let fileBuffer: Uint8Array;
                if (filePath.toLowerCase().endsWith(".html")) {
                    const html = await fs.readFile(filePath, "utf-8");
                    const match = html.match(/window\.__TOBARI_DATA__\s*=\s*"([^"]+)"/);
                    if (!match) throw new Error(`No data found in ${filePath}`);
                    const bin = atob(match[1].replace(/data:.*,/, ''));
                    fileBuffer = Uint8Array.from(bin, c => c.charCodeAt(0));
                } else {
                    fileBuffer = await fs.readFile(filePath);
                }

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

                itemsToSign.push({
                    docType: disclosedDoc.docType,
                    toBeSignedHex: Buffer.from(toBeSigned).toString('hex'),
                    toBeSignedBase64: Buffer.from(toBeSigned).toString('base64')
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

            if (preparedDocs.length !== args.signatures.length) {
                throw new Error("Number of signatures does not match number of documents");
            }

            for (let i = 0; i < preparedDocs.length; i++) {
                const p = preparedDocs[i];
                const signature = new Uint8Array(Buffer.from(args.signatures[i], 'base64'));

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
            let fileBuffer: Uint8Array;

            if (filePath.toLowerCase().endsWith(".html")) {
                const html = await fs.readFile(filePath, "utf-8");
                const match = html.match(/window\.__TOBARI_DATA__\s*=\s*"([^"]+)"/);
                if (!match) throw new Error("No Tobari data found in HTML");
                const b64 = match[1].replace(/data:.*,/, '');
                const binString = atob(b64);
                fileBuffer = new Uint8Array(binString.length);
                for (let i = 0; i < binString.length; i++) {
                    fileBuffer[i] = binString.charCodeAt(i);
                }
            } else {
                fileBuffer = await fs.readFile(filePath);
            }

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
