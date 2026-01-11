import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from "child_process";
import { decode, encode, Decoder } from "cbor-x";
import { verifyTobari, verifyPresentation } from "@tobari/codec/validator";
import { createPresentation, signDeviceAuth, getDeviceAuthToBeSigned, assembleDeviceAuth } from "@tobari/codec/sd";
import { readTobariFileAsBuffer, decodeSignatureInput, rawEcdsaToDer, PROJECT_ROOT, DEFAULT_SIGNER_MACOS_PATH } from "../utils.js";
import {
    ReadTobariFileSchema,
    CreatePresentationSchema,
    PreparePresentationSchema,
    AssemblePresentationSchema,
    VerifyPresentationSchema,
    PreviewPresentationSchema,
    AnalyzeServiceRequestSchema,
    ListAvailableDocumentsSchema,
    GeneratePassportZkpInputSchema
} from "../schemas.js";

export async function handleReadTobariFile(toolArgs: any) {
    try {
        const args = ReadTobariFileSchema.parse(toolArgs);
        const filePath = args.path;
        const fileBuffer = await readTobariFileAsBuffer(filePath, args.decrypt);

        let isValid: boolean | string = "Skipped (No public key provided)";

        if (args.issuerPublicKeyPath) {
            const keyContent = await fs.readFile(args.issuerPublicKeyPath, "utf-8");
            const jwk = JSON.parse(keyContent);

            const cryptoKey = await crypto.subtle.importKey(
                "jwk",
                jwk,
                { name: "ECDSA", namedCurve: jwk.crv },
                false,
                ["verify"]
            );
            
            let pqcPublicKey: Uint8Array | undefined;
            if (args.issuerPqcPublicKeyPath) {
                try {
                    const pqcContent = await fs.readFile(args.issuerPqcPublicKeyPath, "utf-8");
                    const pqcJson = JSON.parse(pqcContent);
                    if (pqcJson.publicKey) {
                        pqcPublicKey = new Uint8Array(Buffer.from(pqcJson.publicKey, 'base64url'));
                    }
                } catch (e: any) {
                    console.warn(`Failed to load PQC key from ${args.issuerPqcPublicKeyPath}: ${e.message}`);
                }
            }

            try {
                const result = await verifyTobari(fileBuffer, cryptoKey, pqcPublicKey);
                isValid = result.isValid;
                
                if (result.isValid && result.pqcValid !== null) {
                    if (result.pqcValid) {
                        isValid = "Valid (Classic + PQC)";
                    } else {
                        isValid = "Valid (Classic) but PQC INVALID";
                    }
                }
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
            // COSE_Sign1
            const payloadData = cose[2];
            if (payloadData instanceof Uint8Array) {
                payload = decode(payloadData);
            } else if (payloadData && typeof payloadData === 'object') {
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

        if (payload && typeof payload === 'object' && !Array.isArray(payload) && !payload.error) {
            if (payload.mandator && !payload.principal) {
                payload.principal = payload.mandator;
            }
            responseData = { ...payload, _meta: meta };
        } else {
            responseData = { payload: payload, _meta: meta };
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

// Basic in-memory store for prepared presentations
const preparationStore = new Map<string, any>();

export async function handleCreatePresentation(toolArgs: any) {
    try {
        const args = CreatePresentationSchema.parse(toolArgs);
        const documents = [];
        let signingMethod: "internal_key" | "external_signer" | "ephemeral_fallback" = "external_signer";

        let devicePrivateKey: CryptoKey | undefined;

        if (args.devicePrivateKeyPath) {
            try {
                const keyContent = await fs.readFile(args.devicePrivateKeyPath, "utf-8");
                const jwk = JSON.parse(keyContent);
                devicePrivateKey = await crypto.subtle.importKey(
                    "jwk",
                    jwk,
                    { name: "ECDSA", namedCurve: jwk.crv || "P-384" },
                    true,
                    ["sign"]
                );
            } catch (e: any) {
                // If path fails, we can't do much unless ephemeralKey is set
                if (!args.ephemeralKey && !args.devicePrivateKeyJson) {
                    throw new Error(`Failed to read key from ${args.devicePrivateKeyPath}: ${e.message}`);
                }
                console.warn(`Failed to read key from path, trying fallback methods: ${e.message}`);
            }
        }

        if (!devicePrivateKey && args.devicePrivateKeyJson) {
            const jwk = typeof args.devicePrivateKeyJson === 'string'
                ? JSON.parse(args.devicePrivateKeyJson)
                : args.devicePrivateKeyJson;

            devicePrivateKey = await crypto.subtle.importKey(
                "jwk",
                jwk,
                { name: "ECDSA", namedCurve: jwk.crv || "P-384" },
                true,
                ["sign"]
            );
        }

        if (!devicePrivateKey && args.ephemeralKey) {
            console.error("Generating ephemeral key for presentation...");
            const keyPair = await crypto.subtle.generateKey(
                { name: "ECDSA", namedCurve: "P-384" },
                true,
                ["sign"]
            );
            devicePrivateKey = keyPair.privateKey;
        }

        if (devicePrivateKey) {
            signingMethod = "internal_key";
        }

        const deviceAlg = args.deviceAlg ?? -35;

        for (const req of args.requests) {
            const filePath = req.path;
            const fileBuffer = await readTobariFileAsBuffer(filePath, args.decrypt);

            const fullDoc = decode(fileBuffer);
            const disclosedDoc = await createPresentation(fullDoc, req.fields);

            const deviceNameSpaces = new Map();
            const deviceNameSpacesBytes = encode(deviceNameSpaces);
            const sessionTranscript = [null, null, args.verifierNonce || null];

            let deviceAuth;

            if (devicePrivateKey) {
                deviceAuth = await signDeviceAuth(
                    disclosedDoc.docType,
                    deviceNameSpacesBytes,
                    sessionTranscript,
                    devicePrivateKey,
                    deviceAlg
                );
            } else {
                const { toBeSigned, protectedHeaderBytes } = await getDeviceAuthToBeSigned(
                    disclosedDoc.docType,
                    deviceNameSpacesBytes,
                    sessionTranscript,
                    deviceAlg
                );

                const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
                const possiblePaths = [
                    DEFAULT_SIGNER_MACOS_PATH,
                    path.join(projectRoot, "packages/signer/src-tauri/target/release/tobari-signer"),
                    path.join(projectRoot, "packages/signer/src-tauri/target/release/tobari-signer.exe"),
                    path.join(projectRoot, "packages/signer/src-tauri/target/debug/tobari-signer"),
                    path.join(projectRoot, "packages/signer/src-tauri/target/debug/tobari-signer.exe")
                ];

                let signerPath = args.signerPath || process.env.TOBARI_SIGNER_PATH;
                if (signerPath) {
                    try {
                        await fs.access(signerPath);
                    } catch {
                        signerPath = undefined;
                    }
                }

                if (!signerPath) {
                    for (const p of possiblePaths) {
                        try {
                            await fs.access(p);
                            signerPath = p;
                            break;
                        } catch { }
                    }
                    if (!signerPath && args.fallbackToEphemeral) {
                        const keyPair = await crypto.subtle.generateKey(
                            { name: "ECDSA", namedCurve: "P-384" },
                            true,
                            ["sign"]
                        );
                        deviceAuth = await signDeviceAuth(
                            disclosedDoc.docType,
                            deviceNameSpacesBytes,
                            sessionTranscript,
                            keyPair.privateKey,
                            deviceAlg
                        );
                        signingMethod = "ephemeral_fallback";
                    }
                }

                if (!signerPath && !deviceAuth) {
                    throw new Error(
                        "Could not find 'tobari-signer' binary. Build the signer package or set TOBARI_SIGNER_PATH. " +
                        `Checked: ${possiblePaths.join(", ")}`
                    );
                }

                if (!deviceAuth) {
                    const signRequest = {
                        challenge: Buffer.from(toBeSigned).toString('base64url'),
                        rp_id: "tobari-mcp-server",
                        message: `Sign presentation for ${disclosedDoc.docType}`,
                        user_verification: "preferred"
                    };

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

                    const signatureBytes = new Uint8Array(Buffer.from(output.signature, 'base64url'));

                    deviceAuth = await assembleDeviceAuth(
                        protectedHeaderBytes,
                        disclosedDoc.docType,
                        deviceNameSpacesBytes,
                        sessionTranscript,
                        signatureBytes
                    );
                }
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
                        signing_method: signingMethod,
                        is_ephemeral: !!args.ephemeralKey
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

export async function handlePreparePresentation(toolArgs: any) {
    try {
        const args = PreparePresentationSchema.parse(toolArgs);
        const itemsToSign = [];
        const preparedDocs = [];

        for (const req of args.requests) {
            const filePath = req.path;
            const fileBuffer = await readTobariFileAsBuffer(filePath, args.decrypt);

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

            // Dynamic import for crypto/cbor
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

        // Store session
        const preparationId = crypto.randomUUID();
        preparationStore.set(preparationId, preparedDocs);

        // Cleanup old sessions (basic)
        if (preparationStore.size > 100) {
            const keys = preparationStore.keys();
            preparationStore.delete(keys.next().value);
        }

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        preparationId,
                        itemsToSign,
                        // Still returning preparedData for backward compatibility if client prefers stateless
                        preparedData: preparedDocs
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

export async function handleAssemblePresentation(toolArgs: any) {
    try {
        const args = AssemblePresentationSchema.parse(toolArgs);
        const documents = [];

        let preparedDocs = args.preparedData as any[];

        if (!preparedDocs && args.preparationId) {
            preparedDocs = preparationStore.get(args.preparationId!);
            if (!preparedDocs) {
                throw new Error(`Preparation ID ${args.preparationId} not found or expired.`);
            }
        }

        if (!preparedDocs) {
            throw new Error("Neither preparedData nor preparationId provided.");
        }

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

export async function handleVerifyPresentation(toolArgs: any) {
    try {
        const args = VerifyPresentationSchema.parse(toolArgs);
        const vpBytes = new Uint8Array(Buffer.from(args.vpBase64, 'base64'));
        const presentation = decode(vpBytes);

        const issuerKeys = await loadIssuerKeys(args.issuerPublicKeys, args.issuerPqcPublicKeys);
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

export async function handlePreviewPresentation(toolArgs: any) {
    try {
        const args = PreviewPresentationSchema.parse(toolArgs);
        const vpBytes = decodeBase64Flexible(args.vpBase64);
        const presentation = decode(vpBytes);
        const summary = summarizeVp(presentation);
        const format = args.format ?? "readable";
        const redact = !!args.redact;
        const maxStringLength = args.maxStringLength ?? 200;

        let verification: any = null;
        if (args.issuerPublicKeys) {
            const issuerKeys = await loadIssuerKeys(args.issuerPublicKeys, args.issuerPqcPublicKeys);
            const results = await verifyPresentation(presentation, issuerKeys, args.verifierNonce);
            verification = {
                results,
                overall_valid: results.every(r => r.issuerValid && r.deviceValid)
            };
        }

        let readable: any = null;
        if (format !== "summary") {
            readable = formatReadableVp(presentation, verification, { redact, maxStringLength });
        }

        const includeDecoded = format === "full" || !!args.includeDecoded;
        const decodedVp = includeDecoded ? normalizeForJson(presentation) : undefined;

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        summary,
                        readable,
                        decodedVp,
                        verification
                    }, null, 2),
                },
            ],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error previewing VP: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleAnalyzeServiceRequest(toolArgs: any) {
    try {
        const args = AnalyzeServiceRequestSchema.parse(toolArgs);
        const filePath = args.path;
        const fileBuffer = await readTobariFileAsBuffer(filePath, args.decrypt);

        const cose = decode(fileBuffer);
        let payload: any = {};

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

async function loadIssuerKeys(
    issuerPublicKeys: Record<string, string>,
    issuerPqcPublicKeys?: Record<string, string>
): Promise<Record<string, CryptoKey | { classic: CryptoKey; pqcPublicKey?: Uint8Array }>> {
    const issuerKeys: Record<string, CryptoKey | { classic: CryptoKey; pqcPublicKey?: Uint8Array }> = {};
    for (const docType of Object.keys(issuerPublicKeys)) {
        const keyPath = issuerPublicKeys[docType];
        const keyContent = await fs.readFile(keyPath, "utf-8");
        const jwk = JSON.parse(keyContent);
        const classicKey = await crypto.subtle.importKey(
            "jwk", jwk, { name: "ECDSA", namedCurve: jwk.crv || "P-384" }, true, ["verify"]
        );

        const pqcKeyPath = issuerPqcPublicKeys?.[docType];
        if (pqcKeyPath) {
            const pqcContent = await fs.readFile(pqcKeyPath, "utf-8");
            const pqcJson = JSON.parse(pqcContent);
            const pqcPublicKey = Buffer.from(pqcJson.publicKey, "base64url");
            issuerKeys[docType] = { classic: classicKey, pqcPublicKey: new Uint8Array(pqcPublicKey) };
        } else {
            issuerKeys[docType] = classicKey;
        }
    }
    return issuerKeys;
}

function summarizeVp(vp: any) {
    if (!vp || !Array.isArray(vp.documents)) {
        return { error: "VP does not contain documents." };
    }
    return {
        documentCount: vp.documents.length,
        documents: vp.documents.map((doc: any) => ({
            docType: doc?.docType,
            fieldCount: countNamespaceItems(doc?.issuerSigned?.nameSpaces)
        }))
    };
}

function countNamespaceItems(ns: any): number | null {
    if (!ns) return null;
    let count = 0;
    if (ns instanceof Map) {
        for (const value of ns.values()) {
            if (Array.isArray(value)) count += value.length;
        }
        return count;
    }
    if (typeof ns === "object") {
        for (const key of Object.keys(ns)) {
            const value = (ns as any)[key];
            if (Array.isArray(value)) count += value.length;
        }
        return count;
    }
    return null;
}

function normalizeForJson(value: any): any {
    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString("base64");
    }
    if (value instanceof Map) {
        const obj: Record<string, any> = {};
        for (const [k, v] of value.entries()) {
            obj[String(k)] = normalizeForJson(v);
        }
        return obj;
    }
    if (Array.isArray(value)) {
        return value.map((v) => normalizeForJson(v));
    }
    if (value && typeof value === "object") {
        const obj: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            obj[k] = normalizeForJson(v);
        }
        return obj;
    }
    return value;
}

function decodeBase64Flexible(input: string): Uint8Array {
    const trimmed = input.trim();
    const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
    try {
        return new Uint8Array(Buffer.from(base64 + pad, "base64"));
    } catch {
        throw new Error("Invalid vpBase64: expected base64/base64url encoded DeviceResponse.");
    }
}

function formatReadableVp(
    presentation: any,
    verification: any,
    options: { redact: boolean; maxStringLength: number }
) {
    if (!presentation || !Array.isArray(presentation.documents)) {
        return { error: "VP does not contain documents." };
    }

    return {
        documentCount: presentation.documents.length,
        documents: presentation.documents.map((doc: any) => {
            const docType = doc?.docType ?? "Unknown";
            const fields = extractDisclosedFields(doc);
            const result = verification?.results?.find((r: any) => r.docType === docType);
            return {
                docType,
                issuerValid: result?.issuerValid ?? null,
                deviceValid: result?.deviceValid ?? null,
                pqcValid: result?.issuerPqcValid ?? null,
                disclosed: redactValue(fields, options)
            };
        })
    };
}

function extractDisclosedFields(doc: any): Record<string, any> {
    const output: Record<string, any> = {};
    if (!doc?.issuerSigned?.nameSpaces || !doc?.docType) return output;
    const namespaces = doc.issuerSigned.nameSpaces;
    const items = namespaces[doc.docType] || namespaces.get?.(doc.docType);
    if (!items || !Array.isArray(items)) return output;

    for (const itemBytes of items) {
        try {
            const item = decode(itemBytes);
            if (Array.isArray(item) && item.length >= 4) {
                const key = item[2];
                const value = item[3];
                output[String(key)] = value;
            }
        } catch {
            // Ignore malformed item
        }
    }
    return output;
}

function redactValue(value: any, options: { redact: boolean; maxStringLength: number }): any {
    if (value instanceof Uint8Array) {
        return `[bytes:${value.length}]`;
    }
    if (typeof value === "string") {
        const truncated = value.length > options.maxStringLength
            ? `${value.slice(0, options.maxStringLength)}…`
            : value;
        if (!options.redact) return truncated;
        if (truncated.length <= 2) return "**";
        return `${truncated[0]}***${truncated[truncated.length - 1]}`;
    }
    if (Array.isArray(value)) {
        return value.map((v) => redactValue(v, options));
    }
    if (value && typeof value === "object") {
        const obj: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            obj[k] = redactValue(v, options);
        }
        return obj;
    }
    return value;
}

export async function handleListAvailableDocuments(toolArgs: any) {
    try {
        const args = ListAvailableDocumentsSchema.parse(toolArgs);
        // Default to the project root's examples directory
        const baseDir = args.rootPath || path.join(PROJECT_ROOT, "examples");

        const files: any[] = [];
        const scan = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory() && entry.name !== "node_modules") {
                    await scan(fullPath);
                } else if (entry.isFile() && (entry.name.endsWith(".html") || entry.name.endsWith(".cose"))) {
                    if (entry.name === "verifier-tool.html" || entry.name === "viewer-template.html") continue;

                    try {
                        const buffer = await readTobariFileAsBuffer(fullPath, args.decrypt);
                        const cose = decode(buffer);
                        let docType = cose.docType || "Unknown";

                        if (Array.isArray(cose) && cose.length >= 3) {
                            try {
                                const payload = decode(cose[2]);
                                if (payload.docType) docType = payload.docType;
                            } catch { }
                        }

                        files.push({
                            name: entry.name,
                            path: fullPath,
                            type: docType,
                            category: docType.includes("service_request") ? "Administrative Request" : "Credential"
                        });
                    } catch (e) { }
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

export async function handleGeneratePassportZkpInput(toolArgs: any) {
    try {
        const args = GeneratePassportZkpInputSchema.parse(toolArgs);
        const fileBuffer = await readTobariFileAsBuffer(args.path, args.decrypt);
        const cose = decode(fileBuffer);

        let mrz = "";
        if (cose.issuerSigned && cose.issuerSigned.nameSpaces) {
            for (const ns of Object.keys(cose.issuerSigned.nameSpaces)) {
                for (const itemBytes of cose.issuerSigned.nameSpaces[ns]) {
                    const [_, __, key, value] = decode(itemBytes);
                    if (key === "dg1") {
                        mrz = value;
                    }
                }
            }
        }

        if (!mrz) {
            const payload = decode(fileBuffer);
            for (const key of Object.keys(payload)) {
                if (typeof payload[key] === 'string' && payload[key].length >= 88) {
                    mrz = payload[key];
                    break;
                }
            }
        }

        if (!mrz || mrz.length < 88) {
            throw new Error("Could not find a valid MRZ (at least 88 chars) in the document.");
        }

        const mrzClean = mrz.replace(/[\r\n]/g, "").substring(0, 88);
        
        const bufferToBitArray = (buf: Buffer): number[] => {
            const bits: number[] = [];
            for (let i = 0; i < buf.length; i++) {
                for (let j = 7; j >= 0; j--) {
                    bits.push((buf[i] >> j) & 1);
                }
            }
            return bits;
        };

        const mrzBuffer = Buffer.from(mrzClean, 'ascii');
        const mrzBits = bufferToBitArray(mrzBuffer);
        
        const { createHash } = await import('crypto');
        const hash = createHash('sha256').update(mrzClean).digest();
        const hashBits = bufferToBitArray(hash);

        const today = new Date();
        const currentDate = args.currentDate || [
            today.getFullYear(),
            today.getMonth() + 1,
            today.getDate()
        ];

        const cryptoMod = await import('crypto');
        const secret = args.secret 
            ? Buffer.from(args.secret, 'base64')
            : cryptoMod.randomBytes(32);
        const secretBits = bufferToBitArray(secret);

        const input = {
            mrz_bits: mrzBits,
            mrz_hash: hashBits,
            current_date: currentDate,
            age_threshold: args.ageThreshold,
            secret: secretBits
        };

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(input, null, 2),
                },
            ],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error generating ZKP input: ${error.message}` }],
            isError: true,
        };
    }
}
