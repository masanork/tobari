import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from "child_process";
import { decode, encode, Decoder } from "cbor-x";
import { verifyTobari, verifyPresentation } from "@tobari/codec/validator";
import { createPresentation, signDeviceAuth, getDeviceAuthToBeSigned, assembleDeviceAuth } from "@tobari/codec/sd";
import { readTobariFileAsBuffer, decodeSignatureInput, rawEcdsaToDer, PROJECT_ROOT, DEFAULT_SIGNER_MACOS_PATH, getNativeSignerPath } from "../utils.js";
import {
    ReadTobariFileSchema,
    CreatePresentationSchema,
    PreparePresentationSchema,
    AssemblePresentationSchema,
    VerifyPresentationSchema,
    PreviewPresentationSchema,
    AnalyzeServiceRequestSchema,
    ListAvailableDocumentsSchema,
    GeneratePassportZkpInputSchema,
    RegisterDeviceSchema,
    IssueLocalCredentialSchema,
    IssueIdentityDocumentSchema,
    GenerateBbsKeySchema,
    SignWithBbsSchema
} from "../schemas.js";
import { handleReadBasicInfo } from "./jpki.js";
import { generateSignedTobari } from "@tobari/codec/tobari-gen";

export async function handleIssueIdentityDocument(toolArgs: any) {
    try {
        const args = IssueIdentityDocumentSchema.parse(toolArgs);
        const signerPath = getNativeSignerPath();

        // 1. Determine DocType and Namespace
        const docType = args.isDtc ? "org.icao.dtc.v1" : args.docType;
        const mainNamespace = args.isDtc ? "org.icao.lds.1" : args.docType;

        // 2. Get Device Public Keys for Holder Binding and Encryption
        let deviceKeys: any = null;
        if (process.platform === 'darwin' && signerPath) {
            const registrationResult = await handleRegisterDevice({});
            deviceKeys = JSON.parse(registrationResult.content[0].text);
        }

        // 3. Prepare Mock Issuer Key for local sign (MSO signature)
        const issuerKeyPair = await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-384" },
            true,
            ["sign"]
        );

        // 4. Construct data and schema
        // If DTC mode, map dg1, dg2, sod keys to binary from base64
        const processedData: Record<string, any> = {};
        const fields: any[] = [];

        for (const [k, v] of Object.entries(args.data)) {
            if ((args.isDtc && (k.startsWith("dg") || k === "sod")) || 
                k.endsWith("_cert") || k === "signature" || k.startsWith("raw_data")) {
                // Keep as binary if it's an ICAO Data Group, JPKI Cert, DL Signature, or Raw Data
                if (v && typeof v === 'string') {
                    processedData[k] = new Uint8Array(Buffer.from(v, 'base64'));
                } else {
                    processedData[k] = v;
                }
            } else {
                processedData[k] = v;
            }
            fields.push({ id: k, title: k.toUpperCase() });
        }

        const docSchemaYaml = `
id: ${docType}
title: ${args.title}
fields:
${fields.map(f => `  - id: ${f.id}\n    title: ${f.title}`).join("\n")}
`;

        // 5. Define External Signer for hardware-bound MSO signature
        let externalSigner: ((msoHash: Uint8Array) => Promise<Uint8Array>) | undefined;
        if (process.platform === 'darwin' && signerPath === DEFAULT_SIGNER_MACOS_PATH) {
            externalSigner = async (msoHash: Uint8Array) => {
                const hashBase64Url = Buffer.from(msoHash).toString('base64url');
                const output = await runCivCommand(signerPath, ["--sign-mso", "--hash", hashBase64Url]);
                const result = JSON.parse(output);
                return new Uint8Array(Buffer.from(result.signature, 'base64url'));
            };
        }

        // 6. Handle Encryption
        let encryptionPublicKey: Uint8Array | undefined;
        if (args.encrypt && deviceKeys) {
            const x = Buffer.from(deviceKeys.encryptionPublicKey.x, 'base64url');
            const y = Buffer.from(deviceKeys.encryptionPublicKey.y, 'base64url');
            encryptionPublicKey = new Uint8Array(65);
            encryptionPublicKey[0] = 0x04;
            encryptionPublicKey.set(x, 1);
            encryptionPublicKey.set(y, 33);
        }

        // 7. Generate signed document
        const coseBinary = await generateSignedTobari(docSchemaYaml, processedData, issuerKeyPair.privateKey, {
            kid: externalSigner ? "hardware-device-key" : "self-issued-local-key",
            alg: externalSigner ? -7 : -35,
            devicePublicKey: deviceKeys ? await crypto.subtle.importKey(
                "jwk",
                deviceKeys.signingPublicKey,
                { name: "ECDSA", namedCurve: "P-256" },
                true,
                ["verify"]
            ) : undefined,
            encryptionPublicKey: encryptionPublicKey,
            externalSigner: externalSigner
        });

        // 8. Save
        await fs.writeFile(args.outputPath, coseBinary);

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    success: true,
                    path: path.resolve(args.outputPath),
                    docType: docType,
                    namespace: mainNamespace,
                    encrypted: !!encryptionPublicKey,
                    hardwareSigned: !!externalSigner,
                    message: `Local identity document (${args.isDtc ? "DTC Type 1" : "Custom"}) issued and saved to ${args.outputPath}`
                }, null, 2)
            }],
        };

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error issuing identity document: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleGenerateBbsKey(toolArgs: any) {
    try {
        const signerPath = getNativeSignerPath();
        if (!signerPath) throw new Error("Native signer not found.");

        const { execFileSync } = await import("child_process");
        const output = execFileSync(signerPath, ["--bbs-generate-key"]).toString();
        
        return {
            content: [{ type: "text", text: output }],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error generating BBS+ key: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleSignWithBbs(toolArgs: any) {
    try {
        const args = SignWithBbsSchema.parse(toolArgs);
        const signerPath = getNativeSignerPath();
        if (!signerPath) throw new Error("Native signer not found.");

        const { spawn } = await import("child_process");
        
        const signRequest = {
            challenge: args.nonce,
            rp_id: "mcp-server-bbs",
            bbs: {
                publicKey: args.publicKey,
                signature: args.signature,
                messages: args.messages,
                revealedIndices: args.revealedIndices
            }
        };

        const signerProcess = spawn(signerPath, ["--request", JSON.stringify(signRequest)]);

        const resultPromise = new Promise<string>((resolve, reject) => {
            let stdout = "";
            let stderr = "";
            signerProcess.stdout.on("data", (data) => stdout += data);
            signerProcess.stderr.on("data", (data) => stderr += data);
            signerProcess.on("close", (code) => {
                if (code === 0) resolve(stdout);
                else reject(new Error(`BBS signer failed (code ${code}): ${stderr || stdout}`));
            });
        });

        const outputStr = await resultPromise;
        return {
            content: [{ type: "text", text: outputStr }],
        };

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error generating BBS+ proof: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleIssueLocalCredential(toolArgs: any) {
    try {
        const args = IssueLocalCredentialSchema.parse(toolArgs);

        // 1. Read data from Card
        const basicInfoResult = await handleReadBasicInfo({ pin: args.pin });
        if (basicInfoResult.isError) throw new Error("Failed to read card info.");
        const personalData = JSON.parse(basicInfoResult.content[0].text);

        // 2. Get Device Public Keys
        const registrationResult = await handleRegisterDevice({});
        const deviceKeys = JSON.parse(registrationResult.content[0].text);

        // 3. Generate Mock Issuer Key for Self-Sign
        // In a real scenario, this might be a local key managed by the app.
        const issuerKeyPair = await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-384" },
            true,
            ["sign"]
        );

        // 4. Define Document Schema (Resident Record style)
        const docSchemaYaml = `
id: io.github.masanork.tobari.resident-record.v1
title: Digital Resident Record (Self-Issued)
fields:
  - id: name
    title: Full Name
  - id: address
    title: Address
  - id: birthDate
    title: Date of Birth
  - id: gender
    title: Gender
`;

        const dataToSign = {
            name: personalData.name,
            address: personalData.address,
            birthDate: personalData.birthDate,
            gender: personalData.gender
        };

        // 5. Generate mdoc
        const isMac = process.platform === 'darwin';
        const signerPath = getNativeSignerPath();
        let externalSigner: ((msoHash: Uint8Array) => Promise<Uint8Array>) | undefined;
        
        if (isMac && signerPath === DEFAULT_SIGNER_MACOS_PATH) {
            externalSigner = async (msoHash: Uint8Array) => {
                const hashBase64Url = Buffer.from(msoHash).toString('base64url');
                const output = await runCivCommand(signerPath, ["--sign-mso", "--hash", hashBase64Url]);
                const result = JSON.parse(output);
                return new Uint8Array(Buffer.from(result.signature, 'base64url'));
            };
        }

        const coseBinary = await generateSignedTobari(docSchemaYaml, dataToSign, issuerKeyPair.privateKey, {
            kid: externalSigner ? "hardware-device-key" : "self-issued-local-key",
            alg: externalSigner ? -7 : -35,
            devicePublicKey: await crypto.subtle.importKey(
                "jwk",
                deviceKeys.signingPublicKey,
                { name: "ECDSA", namedCurve: "P-256" },
                true,
                ["verify"]
            ),
            encryptionPublicKey: rawEncryptionPub,
            externalSigner: externalSigner
        });

        // 6. Save and Return
        await fs.writeFile(args.outputPath, coseBinary);

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    success: true,
                    path: path.resolve(args.outputPath),
                    message: "Hardware-bound identity document created. You can now use this for applications without re-inserting your My Number Card."
                }, null, 2)
            }],
        };

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error issuing local credential: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleRegisterDevice(toolArgs: any) {
    if (process.platform !== 'darwin') {
        throw new Error("register_device is currently only supported on macOS via signer-macos.");
    }

    try {
        const args = RegisterDeviceSchema.parse(toolArgs);
        const signerPath = DEFAULT_SIGNER_MACOS_PATH;
        await fs.access(signerPath);

        const { execFileSync } = await import("child_process");
        const env = { ...process.env, TOBARI_SIGNER_USE_KEYCHAIN: "1" };

        const signingKeyOutput = execFileSync(signerPath, ["--get-public-key"], { env }).toString();
        const encryptionKeyOutput = execFileSync(signerPath, ["--get-encryption-public-key"], { env }).toString();

        const signingKey = JSON.parse(signingKeyOutput).publicKey;
        const encryptionKey = JSON.parse(encryptionKeyOutput).publicKey;

        const result = {
            signingPublicKey: signingKey,
            encryptionPublicKey: encryptionKey,
            platform: "macOS (Secure Enclave)",
            description: "Registered successfully. Use these keys for Issuance and Holder Binding."
        };

        if (args.rootPath) {
            const signingPath = path.join(args.rootPath, "device-key.json");
            const encryptionPath = path.join(args.rootPath, "recipient-pubkey.json");
            await fs.mkdir(args.rootPath, { recursive: true });
            await fs.writeFile(signingPath, JSON.stringify(signingKey, null, 2));
            await fs.writeFile(encryptionPath, JSON.stringify(encryptionKey, null, 2));
            (result as any).savedTo = args.rootPath;
        }

        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error registering device: ${error.message}` }],
            isError: true,
        };
    }
}

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
            
                                let signerPath = args.signerPath || getNativeSignerPath();
            
                                if (!signerPath && args.fallbackToEphemeral) {                    const keyPair = await crypto.subtle.generateKey(
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

                if (!signerPath && !deviceAuth) {
                    throw new Error(
                        "Could not find 'tobari-signer' or 'signer-macos' binary. Build the signer packages or set TOBARI_SIGNER_PATH. " +
                        `Checked: ${possiblePaths.join(", ")}`
                    );
                }

                if (!deviceAuth) {
                    const isMacSigner = signerPath === DEFAULT_SIGNER_MACOS_PATH;
                    
                    const signRequest = {
                        challenge: Buffer.from(toBeSigned).toString('base64url'),
                        rp_id: "tobari-mcp-server",
                        message: `Sign presentation for ${disclosedDoc.docType}`,
                        user_verification: "preferred"
                    };

                    const signArgs = isMacSigner 
                        ? ["--sign-passkey", "--request", JSON.stringify(signRequest)]
                        : ["--request", JSON.stringify(signRequest)];
                    
                    const spawnEnv = isMacSigner 
                        ? { ...process.env, TOBARI_SIGNER_USE_KEYCHAIN: "1" }
                        : process.env;

                    const signerProcess = spawn(signerPath!, signArgs, { env: spawnEnv });

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

                    if (output.authData && output.clientDataJSON) {
                        const authDataBytes = new Uint8Array(Buffer.from(output.authData, 'base64url'));
                        const { assembleWebAuthnDeviceAuth } = await import("@tobari/codec/sd");
                        deviceAuth = await assembleWebAuthnDeviceAuth(
                            protectedHeaderBytes,
                            disclosedDoc.docType,
                            deviceNameSpacesBytes,
                            sessionTranscript,
                            signatureBytes,
                            authDataBytes,
                            output.clientDataJSON
                        );
                    } else {
                        deviceAuth = await assembleDeviceAuth(
                            protectedHeaderBytes,
                            disclosedDoc.docType,
                            deviceNameSpacesBytes,
                            sessionTranscript,
                            signatureBytes
                        );
                    }
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
            const sigInput = args.signatures[i];
            
            let deviceAuth: Uint8Array;

            // Check if it's a WebAuthn signature (Object with signature, authData, clientDataJSON)
            if (typeof sigInput === 'object' && sigInput.authData && sigInput.clientDataJSON) {
                const signature = decodeSignatureInput(sigInput.signature, signatureEncoding);
                const authData = decodeSignatureInput(sigInput.authData, signatureEncoding);
                const clientDataJSON = sigInput.clientDataJSON;

                const { assembleWebAuthnDeviceAuth } = await import("@tobari/codec/sd");
                deviceAuth = await assembleWebAuthnDeviceAuth(
                    new Uint8Array(Buffer.from(p.protectedHeaderBytes, 'base64')),
                    p.docType,
                    new Uint8Array(Buffer.from(p.deviceNameSpacesBytes, 'base64')),
                    p.sessionTranscript,
                    signature,
                    authData,
                    clientDataJSON
                );
            } else {
                const inputSignature = decodeSignatureInput(sigInput as string, signatureEncoding);
                const signature = signatureFormat === "raw-ecdsa"
                    ? rawEcdsaToDer(inputSignature)
                    : inputSignature;

                const { assembleDeviceAuth } = await import("@tobari/codec/sd");
                deviceAuth = await assembleDeviceAuth(
                    new Uint8Array(Buffer.from(p.protectedHeaderBytes, 'base64')),
                    p.docType,
                    new Uint8Array(Buffer.from(p.deviceNameSpacesBytes, 'base64')),
                    p.sessionTranscript,
                    signature
                );
            }

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
        const meta = buildPreviewMeta(args.vpBase64, vpBytes, presentation);

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

        // --- NEW: Add Authenticity Evidence Analysis ---
        let evidenceVerification: any = null;
        if (presentation.documents && presentation.documents.length > 0) {
            const { verifyIdentityEvidence } = await import("@tobari/codec/validator");
            const evidenceResults = [];
            for (const doc of presentation.documents) {
                // Extract disclosed fields to check for SOD/Certs/Sigs
                const fields = extractDisclosedFields(doc);
                const res = await verifyIdentityEvidence(fields);
                if (res.details.length > 0) {
                    evidenceResults.push({
                        docType: doc.docType,
                        ...res
                    });
                }
            }
            if (evidenceResults.length > 0) {
                evidenceVerification = evidenceResults;
            }
        }

        const includeDecoded = format === "full" || !!args.includeDecoded;
        const decodedVp = includeDecoded ? normalizeForJson(presentation) : undefined;

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        summary,
                        meta,
                        readable,
                        decodedVp,
                        verification,
                        evidenceVerification // New field in response
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

function buildPreviewMeta(vpBase64: string, vpBytes: Uint8Array, vp: any) {
    const docTypes = Array.isArray(vp?.documents)
        ? vp.documents.map((doc: any) => doc?.docType).filter((v: any) => typeof v === "string")
        : [];

    const disclosedFields = Array.isArray(vp?.documents)
        ? vp.documents.map((doc: any) => ({
            docType: doc?.docType ?? "Unknown",
            fields: Object.keys(extractDisclosedFields(doc))
        }))
        : [];

    return {
        vpBase64Length: vpBase64.length,
        vpByteLength: vpBytes.length,
        documentCount: Array.isArray(vp?.documents) ? vp.documents.length : 0,
        docTypes,
        disclosedFields
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
