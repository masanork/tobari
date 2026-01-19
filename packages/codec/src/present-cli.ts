import fs from 'fs';
import path from 'path';
import { createPresentation } from './sd';
import { encode } from 'cbor-x';
import { extractFieldsFromDefinition, parseOid4vpRequest } from './presentation-exchange';

async function main() {
    const inputPath = process.argv[2];
    const outputPath = process.argv[3];
    const definitionArg = process.argv.find(arg => arg.startsWith('--definition='));
    const fieldsArg = process.argv.find(arg => arg.startsWith('--fields='));
    const nonceArg = process.argv.find(arg => arg.startsWith('--nonce='));
    const audienceArg = process.argv.find(arg => arg.startsWith('--audience=')); // Client ID
    const responseUriArg = process.argv.find(arg => arg.startsWith('--response-uri='));

    if (!inputPath || !outputPath) {
        console.log("\nUsage: bun run present-cli.ts <input.cose> <output.cose> [options]");
        console.log("Options:");
        console.log("  --fields=key1,key2           Comma-separated list of fields to disclose");
        console.log("  --definition=request.json    Path to OID4VP Authorization Request / Presentation Definition");
        console.log("  --nonce=...                  OID4VP Nonce");
        console.log("  --audience=...               Verifier Client ID");
        console.log("  --response-uri=...           Response URI");
        process.exit(1);
    }

    let fields: string[] = [];
    let nonce = nonceArg ? nonceArg.split('=')[1] : null;
    let clientId = audienceArg ? audienceArg.split('=')[1] : null;
    let responseUri = responseUriArg ? responseUriArg.split('=')[1] : null;

    // Load from Definition if provided
    if (definitionArg) {
        const defPath = definitionArg.split('=')[1];
        const defContent = fs.readFileSync(path.resolve(defPath), 'utf-8');
        const json = JSON.parse(defContent);
        const parsed = parseOid4vpRequest(json);

        if (parsed.definition) {
            const extracted = extractFieldsFromDefinition(parsed.definition);
            console.log(`Using Presentation Definition from ${defPath}`);
            fields = extracted;
        }

        // Use values from JSON if not overridden by CLI args
        if (!nonce && parsed.nonce) nonce = parsed.nonce;
        if (!clientId && parsed.clientId) clientId = parsed.clientId;
        if (!responseUri && parsed.responseUri) responseUri = parsed.responseUri;
    }

    // CLI args override everything
    if (fieldsArg) {
        fields = fieldsArg.split('=')[1].split(',').map(s => s.trim());
    }

    if (fields.length === 0) {
        console.error("Error: No fields specified. Use --fields or provide a --definition with constraints.");
        process.exit(1);
    }
    
    // Default responseUri to clientId if missing
    if (clientId && !responseUri) responseUri = clientId;

    console.log(`\nGenerating Verifiable Presentation...`);
    console.log(`Input: ${inputPath}`);
    console.log(`Disclosing: ${fields.join(', ')}`);
    if (nonce) {
        console.log(`Session: Nonce=${nonce}`);
        console.log(`         ClientID=${clientId}`);
        console.log(`         ResponseURI=${responseUri}`);
    }

    const binary = fs.readFileSync(path.resolve(inputPath));
    const { decode: decodeCbor } = await import('../../crypto/src/cbor');
    const doc = decodeCbor(binary);

    // Create VP (IssuerSigned)
    const vp = await createPresentation(doc, fields);

    // Add DeviceSigned (Holder Binding) if nonce is present
    if (nonce && clientId && responseUri) {
        if (!fs.existsSync("device-key.json")) {
            console.error("Error: device-key.json not found. Cannot sign presentation.");
            process.exit(1);
        }
        const jwk = JSON.parse(fs.readFileSync("device-key.json", 'utf-8'));
        const deviceKey = await crypto.subtle.importKey(
            "jwk", jwk, { name: "ECDSA", namedCurve: "P-384" }, true, ["sign"]
        );

        // OID4VP Handover Construction
        const textEncoder = new TextEncoder();
        const clientIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(clientId)));
        const responseUriHash = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(responseUri)));

        // Handover = [clientIdHash, responseUriHash, nonce]
        const oid4vpHandover = [clientIdHash, responseUriHash, nonce];

        // SessionTranscript = [DeviceEngagementBytes, ERCReaderKeyBytes, Handover]
        const sessionTranscript = [null, null, oid4vpHandover];

        const { encodeCanonical } = await import('../../crypto/src/cbor');
        const { signCoseSign1 } = await import('../../crypto/src/cose');

        // DeviceAuthentication = ["DeviceAuthentication", SessionTranscript, DocType, DeviceNameSpacesBytes]
        const mso = decodeCbor(decodeCbor(doc.issuerSigned.issuerAuth)[2]);

        const deviceAuthPayload = ["DeviceAuthentication", sessionTranscript, mso.docType, encodeCanonical({})];

        // Sign with Device Key
        const deviceAuth = await signCoseSign1(deviceAuthPayload, deviceKey, {
            alg: -35, // P-384
            kid: "device-key"
        }); 

        // In mdoc, "deviceAuth" field contains {"deviceSignature": COSE_Sign1}
        vp.deviceSigned = {
            nameSpaces: {}, // Device namespaces (not used here)
            deviceAuth: {
                deviceSignature: deviceAuth
            }
        };
        console.log("✅ Holder Binding Added (DeviceSigned)");
    }

    // Encode back to CBOR
    const vpBinary = encode(vp);

    fs.writeFileSync(path.resolve(outputPath), vpBinary);
    console.log(`\n✅ VP Generated: ${outputPath} (${vpBinary.length} bytes)`);
    console.log(`   (Original size: ${binary.length} bytes)`);
}

main().catch(console.error);