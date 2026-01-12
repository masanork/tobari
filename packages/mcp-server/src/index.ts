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
    handlePreviewPresentation,
    handleAnalyzeServiceRequest,
    handleGeneratePassportZkpInput,
    handleListAvailableDocuments,
    handleRegisterDevice,
    handleIssueLocalCredential,
    handleIssueIdentityDocument,
    handleGenerateBbsKey,
    handleSignWithBbs
} from "./tools/tobari.js";
import { handleDemoListExamples } from "./tools/demo.js";
import {
    handleSignWithJpki,
    handleReadMyNumber,
    handleReadBasicInfo,
    handleReadPhoto,
    handleReadPassport,
    handleReadDriverLicense,
    handleReadResidenceCard
} from "./tools/jpki.js";
import {
    handleSignWithWebAuthn,
    handleRegisterWebAuthn
} from "./tools/webauthn.js";

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
                name: "issue_local_credential",
                description: "Creates a hardware-bound, encrypted digital identity document by reading info from a My Number Card. This 'Master mdoc' can be used for future applications without the physical card.",
                inputSchema: {
                    type: "object",
                    properties: {
                        pin: { type: "string", description: "4-digit PIN for My Number Card" },
                        outputPath: { type: "string", description: "Path where to save the generated document (e.g. ./my-identity.cose)" }
                    },
                    required: ["pin", "outputPath"]
                }
            },
            {
                name: "issue_identity_document",
                description: "Generates and optionally encrypts an identity document (mdoc) from provided identity data. Useful for digitizing physical cards for future use.",
                inputSchema: {
                    type: "object",
                    properties: {
                        docType: { type: "string", description: "Document type ID" },
                        title: { type: "string", description: "Human readable title" },
                        data: { type: "object", description: "Key-value pairs of identity information" },
                        outputPath: { type: "string", description: "Path to save the .cose file" },
                        encrypt: { type: "boolean", description: "Encrypt using hardware device key (default: true)" }
                    },
                    required: ["docType", "title", "data", "outputPath"]
                }
            },
            {
                name: "register_device",
                description: "Registers the current hardware device as a Tobari holder by exporting its Secure Enclave public keys (Signing & Encryption).",
                inputSchema: {
                    type: "object",
                    properties: {
                        rootPath: { type: "string", description: "Optional path where to save the exported public keys (e.g. examples/juminhyo)." }
                    }
                }
            },
            {
                name: "generate_bbs_key",
                description: "Generates a new BBS+ key pair for unlinkable credentials. This is performed entirely on the native signer for security.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "sign_with_bbs",
                description: "Generates a BBS+ zero-knowledge proof (ZKP) for a selective disclosure presentation. Requires an existing BBS+ signature and public key.",
                inputSchema: {
                    type: "object",
                    properties: {
                        publicKey: { type: "string", description: "BBS+ Public Key (JSON)" },
                        signature: { type: "string", description: "BBS+ Signature (JSON)" },
                        messages: { type: "array", items: { type: "string" }, description: "Original signed messages" },
                        revealedIndices: { type: "array", items: { type: "number" }, description: "Indices to reveal" },
                        nonce: { type: "string", description: "Challenge/nonce (Base64URL)" }
                    },
                    required: ["publicKey", "signature", "messages", "revealedIndices", "nonce"]
                }
            },
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
                        issuerPqcPublicKeyPath: {
                            type: "string",
                            description: "Absolute path to the issuer's PQC public key (base64url JSON) for verification",
                        },
                        decrypt: {
                            type: "object",
                            description: "Optional decryption overrides for encrypted Tobari files.",
                            properties: {
                                hpkeSecret: { type: "string", description: "Override HPKE secret for decryption." },
                                hpkeInfo: { type: "string", description: "Override HPKE info for decryption." },
                                pqcPrivateKeyPath: { type: "string", description: "Path to recipient PQC private key (base64url JSON) for hybrid decryption." }
                            }
                        }
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
                        signerPath: {
                            type: "string",
                            description: "Path to tobari-signer binary. Overrides TOBARI_SIGNER_PATH."
                        },
                        fallbackToEphemeral: {
                            type: "boolean",
                            description: "If true, falls back to an ephemeral key when signer is unavailable."
                        },
                        verifierNonce: {
                            type: "string",
                            description: "Optional nonce for replay protection"
                        },
                        deviceAlg: {
                            type: "number",
                            description: "COSE algorithm for DeviceAuth (default: -35 / ES384, use -7 for ES256)"
                        },
                        decrypt: {
                            type: "object",
                            description: "Optional decryption settings applied to all input documents.",
                            properties: {
                                hpkeSecret: { type: "string", description: "Override HPKE secret for decryption." },
                                hpkeInfo: { type: "string", description: "Override HPKE info for decryption." },
                                pqcPrivateKeyPath: { type: "string", description: "Path to recipient PQC private key (base64url JSON) for hybrid decryption." }
                            }
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
                        },
                        decrypt: {
                            type: "object",
                            description: "Optional decryption settings applied to all input documents.",
                            properties: {
                                hpkeSecret: { type: "string", description: "Override HPKE secret for decryption." },
                                hpkeInfo: { type: "string", description: "Override HPKE info for decryption." },
                                pqcPrivateKeyPath: { type: "string", description: "Path to recipient PQC private key (base64url JSON) for hybrid decryption." }
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
                name: "preview_presentation",
                description: "Decodes a Verifiable Presentation (VP) and returns a summary plus decoded JSON. Optionally verifies signatures.",
                inputSchema: {
                    type: "object",
                    properties: {
                        vpBase64: { type: "string", description: "Base64-encoded DeviceResponse" },
                        issuerPublicKeys: {
                            type: "object",
                            additionalProperties: { type: "string" },
                            description: "Optional map of docType to path of issuer's public key (JWK)"
                        },
                        issuerPqcPublicKeys: {
                            type: "object",
                            additionalProperties: { type: "string" },
                            description: "Optional map of docType to path of issuer's PQC public key (base64url JSON)"
                        },
                        verifierNonce: { type: "string", description: "Expected nonce to prevent replay attacks" },
                        format: { type: "string", description: "summary | readable (default) | full" },
                        includeDecoded: { type: "boolean", description: "Include decoded VP JSON payload (may be large)." },
                        redact: { type: "boolean", description: "Redact string values in readable output." },
                        maxStringLength: { type: "number", description: "Max string length before truncation in readable output." }
                    },
                    required: ["vpBase64"]
                }
            },
            {
                name: "analyze_service_request",
                description: "Analyzes an administrative service request document to identify required credentials and user inputs.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Path to the service request file" },
                        decrypt: {
                            type: "object",
                            description: "Optional decryption overrides for encrypted Tobari files.",
                            properties: {
                                hpkeSecret: { type: "string", description: "Override HPKE secret for decryption." },
                                hpkeInfo: { type: "string", description: "Override HPKE info for decryption." },
                                pqcPrivateKeyPath: { type: "string", description: "Path to recipient PQC private key (base64url JSON) for hybrid decryption." }
                            }
                        }
                    },
                    required: ["path"]
                }
            },
            {
                name: "list_available_documents",
                description: "Lists available Tobari documents and service requests found in the project's examples or specified directory.",
                inputSchema: {
                    type: "object",
                    properties: {
                        rootPath: { type: "string", description: "Optional path to scan. Defaults to the Tobari examples directory." },
                        decrypt: {
                            type: "object",
                            description: "Optional decryption overrides for encrypted Tobari files.",
                            properties: {
                                hpkeSecret: { type: "string", description: "Override HPKE secret for decryption." },
                                hpkeInfo: { type: "string", description: "Override HPKE info for decryption." },
                                pqcPrivateKeyPath: { type: "string", description: "Path to recipient PQC private key (base64url JSON) for hybrid decryption." }
                            }
                        }
                    }
                }
            },
            {
                name: "demo_list_examples",
                description: "Lists available Tobari example documents and service requests found in the project's examples directory. Useful for discovering test data.",
                inputSchema: {
                    type: "object",
                    properties: {
                        rootPath: { type: "string", description: "Optional path to scan. Defaults to the Tobari examples directory." },
                        decrypt: {
                            type: "object",
                            description: "Optional decryption overrides for encrypted Tobari files.",
                            properties: {
                                hpkeSecret: { type: "string", description: "Override HPKE secret for decryption." },
                                hpkeInfo: { type: "string", description: "Override HPKE info for decryption." },
                                pqcPrivateKeyPath: { type: "string", description: "Path to recipient PQC private key (base64url JSON) for hybrid decryption." }
                            }
                        }
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
                        secret: { type: "string", description: "Base64 encoded secret for nullifier (optional)" },
                        decrypt: {
                            type: "object",
                            description: "Optional decryption overrides for encrypted Tobari files.",
                            properties: {
                                hpkeSecret: { type: "string", description: "Override HPKE secret for decryption." },
                                hpkeInfo: { type: "string", description: "Override HPKE info for decryption." },
                                pqcPrivateKeyPath: { type: "string", description: "Path to recipient PQC private key (base64url JSON) for hybrid decryption." }
                            }
                        }
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
                name: "read_passport",
                description: "Reads personal information and photo from an ePassport (ICAO 9303). Supports BAC (MRZ) and PACE (CAN) authentication.",
                inputSchema: {
                    type: "object",
                    properties: {
                        mrz: { type: "string", description: "MRZ info (PassportNo+Birth+Expiry with check digits)" },
                        can: { type: "string", description: "6-digit CAN (optional, used for PACE)" },
                        usePace: { type: "boolean", description: "Force use of PACE instead of BAC (default: false)" }
                    }
                }
            },
            {
                name: "read_driver_license",
                description: "Reads information from a Japanese Driver's License. Requires card reader and two 4-digit PINs.",
                inputSchema: {
                    type: "object",
                    properties: {
                        pin1: { type: "string", description: "4-digit PIN1" },
                        pin2: { type: "string", description: "4-digit PIN2" }
                    },
                    required: ["pin1", "pin2"]
                }
            },
            {
                name: "read_residence_card",
                description: "Reads back-side information (address updates, etc.) from a Japanese Residence Card. No PIN required for basic info.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            // No local demo server tools (MCP-only demo flow)
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    switch (request.params.name) {
        case "issue_local_credential":
            return handleIssueLocalCredential(request.params.arguments);
        case "issue_identity_document":
            return handleIssueIdentityDocument(request.params.arguments);
        case "register_device":
            return handleRegisterDevice(request.params.arguments);
        case "generate_bbs_key":
            return handleGenerateBbsKey(request.params.arguments);
        case "sign_with_bbs":
            return handleSignWithBbs(request.params.arguments);
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
        case "preview_presentation":
            return handlePreviewPresentation(request.params.arguments);
        case "analyze_service_request":
            return handleAnalyzeServiceRequest(request.params.arguments);
        case "list_available_documents":
            return handleListAvailableDocuments(request.params.arguments);
        case "demo_list_examples":
            return handleDemoListExamples(request.params.arguments);
        // No demo_start_* handlers
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
        case "read_passport":
            return handleReadPassport(request.params.arguments);
        case "read_driver_license":
            return handleReadDriverLicense(request.params.arguments);
        case "read_residence_card":
            return handleReadResidenceCard(request.params.arguments);
        // No demo_start_* handlers
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
