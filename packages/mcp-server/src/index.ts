import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_MYNA_PATH } from "./utils.js";
import {
    handleReadTobariFile,
    handleCreatePresentation,
    handlePreparePresentation,
    handleAssemblePresentation,
    handleVerifyPresentation,
    handleAnalyzeServiceRequest,
    handleListAvailableDocuments,
    handleGeneratePassportZkpInput
} from "./tools/tobari.js";
import {
    handleSignWithJpki,
    handleReadMyNumber,
    handleReadBasicInfo,
    handleReadPhoto
} from "./tools/jpki.js";
import {
    handleSignWithWebAuthn,
    handleRegisterWebAuthn
} from "./tools/webauthn.js";
import { handleStartDemoServer } from "./tools/demo_submission.js";

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
                        },
                        deviceAlg: {
                            type: "number",
                            description: "COSE algorithm for DeviceAuth (default: -35 / ES384, use -7 for ES256)"
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
                name: "generate_passport_zkp_input",
                description: "Generates JSON input for the Passport ZK circuit (age verification + nullifier) from a Tobari Passport document.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Path to the Passport Tobari file" },
                        ageThreshold: { type: "number", default: 18, description: "Age threshold to prove (default: 18)" },
                        currentDate: { type: "array", items: { type: "number" }, description: "Reference date [YYYY, MM, DD]. Defaults to today." },
                        secret: { type: "string", description: "Base64 encoded secret for nullifier (optional)" }
                    },
                    required: ["path"]
                }
            },
            {
                name: "sign_with_webauthn",
                description: "Signs a challenge using the system's WebAuthn authenticator (Touch ID, Face ID, YubiKey) by opening a browser window. Useful for holder binding signatures.",
                inputSchema: {
                    type: "object",
                    properties: {
                        challenge: { type: "string", description: "Base64URL encoded challenge to sign" },
                        rpId: { type: "string", description: "Relying Party ID (domain) for the signature scope" },
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
                        mynaPath: { type: "string", description: `Path to myna binary (default: ${DEFAULT_MYNA_PATH})` }
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
                        mynaPath: { type: "string", description: `Path to myna binary (default: ${DEFAULT_MYNA_PATH})` }
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
                        mynaPath: { type: "string", description: `Path to myna binary (default: ${DEFAULT_MYNA_PATH})` }
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
                        mynaPath: { type: "string", description: `Path to myna binary (default: ${DEFAULT_MYNA_PATH})` }
                    },
                    required: ["pin"]
                }
            },
            {
                name: "start_demo_server",
                description: "Starts a local demo server (submission portal) on port 22081. This server accepts VP submissions and displays a 'Success' screen. Returns the server URL.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    switch (request.params.name) {
        case "read_tobari_file":
            return handleReadTobariFile(request.params.arguments);
        case "create_presentation":
            return handleCreatePresentation(request.params.arguments);
        case "prepare_presentation":
            return handlePreparePresentation(request.params.arguments);
        case "assemble_presentation":
            return handleAssemblePresentation(request.params.arguments);
        case "verify_presentation":
            return handleVerifyPresentation(request.params.arguments);
        case "analyze_service_request":
            return handleAnalyzeServiceRequest(request.params.arguments);
        case "list_available_documents":
            return handleListAvailableDocuments(request.params.arguments);
        case "generate_passport_zkp_input":
            return handleGeneratePassportZkpInput(request.params.arguments);
        case "sign_with_webauthn":
            return handleSignWithWebAuthn(request.params.arguments);
        case "register_webauthn":
            return handleRegisterWebAuthn(request.params.arguments);
        case "sign_with_jpki":
            return handleSignWithJpki(request.params.arguments);
        case "read_mynumber":
            return handleReadMyNumber(request.params.arguments);
        case "read_basic_info":
            return handleReadBasicInfo(request.params.arguments);
        case "read_photo":
            return handleReadPhoto(request.params.arguments);
        case "start_demo_server":
            return handleStartDemoServer(request.params.arguments);
        default:
            throw new Error(`Tool not found: ${request.params.name}`);
    }
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
