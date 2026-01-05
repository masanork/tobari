import fs from 'fs';
import path from 'path';
import { verifyTobari } from './validator';
import { revealMdocData } from './sd';
import { decode } from 'cbor-x';

async function main() {
    const filePath = process.argv[2];
    const jwkPath = process.argv[3];

    if (!filePath) {
        console.log("\nUsage: bun run verify-cli.ts <path-to-cose> [path-to-public-key-jwk]");
        process.exit(1);
    }

    const binary = fs.readFileSync(path.resolve(filePath));

    let publicKey: CryptoKey | undefined;
    if (jwkPath) {
        const jwk = JSON.parse(fs.readFileSync(path.resolve(jwkPath), 'utf-8'));
        publicKey = await crypto.subtle.importKey(
            'jwk',
            jwk,
            { name: "ECDSA", namedCurve: "P-384" },
            true,
            ['verify']
        );
    }

    console.log(`\nAnalyzing Tobari Mdoc: ${path.basename(filePath)}`);
    console.log("------------------------------------------");

    if (publicKey) {
        const result = await verifyTobari(binary, publicKey);
        if (result.isValid && result.mso) {
            console.log("✅ Signature: VALID (Algorithm: ES384)");
            console.log(`   DocType: ${result.mso.docType}`);
            console.log(`   Signed at: ${result.mso.validityInfo.signed}`);

            const namespace = result.mso.docType;
            const items = result.doc.issuerSigned.nameSpaces[namespace] || [];
            const revealed = await revealMdocData(result.mso, items, namespace);

            console.log("\n[Revealed Data]");
            console.log(JSON.stringify(revealed, null, 2));

            // Verify Device Signature (Holder Binding)
            if (result.doc.deviceSigned && result.doc.deviceSigned.deviceAuth) {
                console.log("\n------------------------------------------");
                console.log("🔒 Holder Binding Verification (Device Signed)");

                try {
                    // To safely extract COSE Key (which uses negative integer keys),
                    // we should re-decode MSO using a decoder configured to preserve Maps.
                    const { Decoder, decode } = await import('@tobari/crypto/cbor');
                    // @ts-ignore: cbor-x types might be missing useMaps
                    const mapDecoder = new Decoder({ mapsAsObjects: false, useMaps: true });

                    // MSO is inside issuerAuth (COSE_Sign1) which is inside doc.issuerSigned.issuerAuth
                    // result.doc is already decoded with default settings (object).
                    // We need to look at the raw bytes for MSO.

                    // Re-read binary from file to get COSE_Sign1 of MSO
                    // We are in `verify-cli.ts`, we have `binary` which is the whole file.
                    // Let's manually traverse to get MSO bytes.

                    // 1. Decode main doc (Standard decoder ok for outer structure)
                    const mainDoc = decode(fs.readFileSync(path.resolve(process.argv[2])));

                    // 2. Get IssuerAuth (COSE_Sign1)
                    const issuerAuthCose = decode(mainDoc.issuerSigned.issuerAuth);
                    // COSE_Sign1 = [Header, Map, Payload, Signature]
                    const msoBytes = issuerAuthCose[2];

                    // 3. Decode MSO with Map support
                    const msoMap = mapDecoder.decode(msoBytes);
                    const deviceKeyMap = msoMap.deviceKeyInfo.deviceKey; // This should be a Map now

                    if (!deviceKeyMap || !(deviceKeyMap instanceof Map)) {
                        throw new Error("Failed to extract Device Key as Map from MSO");
                    }

                    // Convert COSE Key Map to CryptoKey
                    // Curve P-384
                    const x = deviceKeyMap.get(-2);
                    const y = deviceKeyMap.get(-3);

                    if (!x || !y) throw new Error("Invalid Device Key structure: Missing x/y coordinates");

                    const jwk = {
                        kty: "EC", crv: "P-384", x: Buffer.from(x).toString('base64url'), y: Buffer.from(y).toString('base64url')
                    };
                    const deviceKey = await crypto.subtle.importKey(
                        "jwk", jwk, { name: "ECDSA", namedCurve: "P-384" }, true, ["verify"]
                    );

                    const deviceAuthCose = result.doc.deviceSigned.deviceAuth.deviceSignature;

                    // Manual Verification of COSE_Sign1 (Device Auth)
                    const coseArray = decode(deviceAuthCose);
                    if (!Array.isArray(coseArray) || coseArray.length !== 4) {
                        throw new Error("Invalid Device Auth COSE structure");
                    }
                    const [protectedHeaderBytes, unprotectedHeader, payloadBytes, signature] = coseArray;

                    // Setup Sig_structure
                    const sigStructure = [
                        "Signature1",
                        protectedHeaderBytes,
                        new Uint8Array(0), // external_aad
                        payloadBytes
                    ];

                    const { encodeCanonical } = await import('@tobari/crypto/cbor');
                    const toBeSigned = encodeCanonical(sigStructure);

                    const isValid = await crypto.subtle.verify(
                        { name: "ECDSA", hash: { name: "SHA-384" } },
                        deviceKey,
                        signature,
                        toBeSigned as any
                    );

                    if (isValid) {
                        console.log("✅ Device Signature: VALID");
                        // Decode payload to show session info
                        const coseStruct = decode(deviceAuthCose);
                        const payload = decode(coseStruct[2]);
                        // Payload is ["DeviceAuthentication", SessionTranscript, DocType, Bytes]
                        // SessionTranscript is [DeviceEngagement, Key, [Nonce, Audience]]
                        const sessionTranscript = payload[1];
                        // check if sessionTranscript follows our simplified structure
                        if (Array.isArray(sessionTranscript) && Array.isArray(sessionTranscript[2])) {
                            const handover = sessionTranscript[2];
                            if (Array.isArray(handover) && handover.length === 3) {
                                // OID4VP Handover: [clientIdHash, responseUriHash, nonce]
                                const [clientIdHash, responseUriHash, nonce] = handover;
                                console.log(`\n   [OID4VP Session Data]`);
                                console.log(`   Nonce: ${nonce}`);
                                console.log(`   ClientID Hash (SHA-256): ${Buffer.from(clientIdHash).toString('hex')}`);
                                console.log(`   ResponseURI Hash (SHA-256): ${Buffer.from(responseUriHash).toString('hex')}`);
                            } else if (Array.isArray(handover) && handover.length === 2) {
                                // Legacy/Simplified: [nonce, audience]
                                const [nonce, audience] = handover;
                                console.log(`   Session Nonce: ${nonce}`);
                                console.log(`   Audience: ${audience}`);
                            } else {
                                console.log(`   Unknown Handover Format:`, handover);
                            }
                        }
                    } else {
                        console.log("❌ Device Signature: INVALID");
                    }

                } catch (e: any) {
                    console.log(`❌ Holder Binding Error: ${e.message}`);
                }
            } else {
                console.log("\n⚠️  No Holder Binding (Device Signature) found.");
            }
        } else {
            console.log("❌ Signature: INVALID");
            console.log(`Error: ${result.error}`);
        }
    } else {
        console.log("⚠️  Skipping signature verification (No public key provided)");
        const doc = decode(binary);
        const issuerAuthToken = doc.issuerSigned.issuerAuth;
        const coseArray = decode(issuerAuthToken);
        const mso = decode(coseArray[2]);

        const namespace = mso.docType;
        const items = doc.issuerSigned.nameSpaces[namespace] || [];
        const revealed = await revealMdocData(mso, items, namespace);

        console.log(`   DocType: ${mso.docType}`);
        console.log("\n[Decoded Data]");
        console.log(JSON.stringify(revealed, null, 2));

        // Verify Device Signature (Holder Binding) - Copy of logic above
        if (doc.deviceSigned && doc.deviceSigned.deviceAuth) {
            console.log("\n------------------------------------------");
            console.log("🔒 Holder Binding Verification (Device Signed)");

            try {
                const deviceKeyMap = mso.deviceKeyInfo?.deviceKey; // mso is available here
                if (!deviceKeyMap) throw new Error("No Device Key found in Issuer MSO");

                // Convert COSE Key Map to CryptoKey
                let x, y;
                if (deviceKeyMap instanceof Map) {
                    x = deviceKeyMap.get(-2);
                    y = deviceKeyMap.get(-3);
                } else {
                    x = deviceKeyMap[-2] || deviceKeyMap['-2'];
                    y = deviceKeyMap[-3] || deviceKeyMap['-3'];
                }

                if (!x || !y) throw new Error("Invalid Device Key structure: Missing x/y coordinates");

                const jwk = {
                    kty: "EC", crv: "P-384", x: Buffer.from(x).toString('base64url'), y: Buffer.from(y).toString('base64url')
                };
                const deviceKey = await crypto.subtle.importKey(
                    "jwk", jwk, { name: "ECDSA", namedCurve: "P-384" }, true, ["verify"]
                );

                const deviceAuthCose = doc.deviceSigned.deviceAuth.deviceSignature;

                // Manual Verification of COSE_Sign1 (Device Auth)
                // 1. Parse COSE_Sign1
                const coseArray = decode(deviceAuthCose);
                if (!Array.isArray(coseArray) || coseArray.length !== 4) {
                    throw new Error("Invalid Device Auth COSE structure");
                }
                const [protectedHeaderBytes, unprotectedHeader, payloadBytes, signature] = coseArray;

                // 2. Setup Sig_structure
                // [ "Signature1", protected, external_aad, payload ]
                const sigStructure = [
                    "Signature1",
                    protectedHeaderBytes,
                    new Uint8Array(0), // external_aad
                    payloadBytes
                ];

                // We need to encode using the canonical encoder we know about
                const { encodeCanonical } = await import('@tobari/crypto/cbor');
                const toBeSigned = encodeCanonical(sigStructure);

                // 3. Verify
                const isValid = await crypto.subtle.verify(
                    { name: "ECDSA", hash: { name: "SHA-384" } }, // Assuming P-384/ES384
                    deviceKey,
                    signature,
                    toBeSigned as any
                );


                if (isValid) {
                    console.log("✅ Device Signature: VALID");
                    const coseStruct = decode(deviceAuthCose);
                    const payload = decode(coseStruct[2]);
                    const sessionTranscript = payload[1];
                    if (Array.isArray(sessionTranscript) && Array.isArray(sessionTranscript[2])) {
                        const handover = sessionTranscript[2];
                        if (Array.isArray(handover) && handover.length === 3) {
                            // OID4VP Handover: [clientIdHash, responseUriHash, nonce]
                            const [clientIdHash, responseUriHash, nonce] = handover;
                            console.log(`\n   [OID4VP Session Data]`);
                            console.log(`   Nonce: ${nonce}`);
                            console.log(`   ClientID Hash (SHA-256): ${Buffer.from(clientIdHash).toString('hex')}`);
                            console.log(`   ResponseURI Hash (SHA-256): ${Buffer.from(responseUriHash).toString('hex')}`);
                        } else if (Array.isArray(handover) && handover.length === 2) {
                            // Legacy/Simplified: [nonce, audience]
                            const [nonce, audience] = handover;
                            console.log(`   Session Nonce: ${nonce}`);
                            console.log(`   Audience: ${audience}`);
                        } else {
                            console.log(`   Unknown Handover Format:`, handover);
                        }
                    }
                } else {
                    console.log("❌ Device Signature: INVALID");
                }

            } catch (e: any) {
                console.log(`❌ Holder Binding Error: ${e.message}`);
            }
        }
    }
    console.log("------------------------------------------\n");
}

main().catch(console.error);
