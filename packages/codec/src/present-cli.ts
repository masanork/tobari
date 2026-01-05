import fs from 'fs';
import path from 'path';
import { createPresentation } from './sd';
import { decode, encode } from 'cbor-x';

async function main() {
    const inputPath = process.argv[2];
    const outputPath = process.argv[3];
    const fieldsArg = process.argv.find(arg => arg.startsWith('--fields='));
    const nonceArg = process.argv.find(arg => arg.startsWith('--nonce='));
    const audienceArg = process.argv.find(arg => arg.startsWith('--audience='));

    if (!inputPath || !outputPath || !fieldsArg) {
        console.log("\nUsage: bun run present-cli.ts <input.cose> <output.cose> --fields=key1,key2 [--nonce=abc --audience=xyz]");
        process.exit(1);
    }

    const fields = fieldsArg.split('=')[1].split(',').map(s => s.trim());
    const nonce = nonceArg ? nonceArg.split('=')[1] : null;
    const audience = audienceArg ? audienceArg.split('=')[1] : null;

    console.log(`\nGenerating Verifiable Presentation...`);
    console.log(`Input: ${inputPath}`);
    console.log(`Disclosing: ${fields.join(', ')}`);
    if (nonce) console.log(`Session: Nonce=${nonce}, Audience=${audience || 'None'}`);

    const binary = fs.readFileSync(path.resolve(inputPath));
    const doc = decode(binary);

    // Create VP (IssuerSigned)
    const vp = await createPresentation(doc, fields);

    // Add DeviceSigned (Holder Binding) if nonce is present
    if (nonce) {
        if (!fs.existsSync("device-key.json")) {
            console.error("Error: device-key.json not found. Cannot sign presentation.");
            process.exit(1);
        }
        const jwk = JSON.parse(fs.readFileSync("device-key.json", 'utf-8'));
        const deviceKey = await crypto.subtle.importKey(
            "jwk", jwk, { name: "ECDSA", namedCurve: "P-384" }, true, ["sign"]
        );

        // SessionTranscript = [DeviceEngagementBytes, ERCReaderKeyBytes, Handover]
        // For CLI, we simplify and just sign [nonce, audience] as the transcript
        const sessionTranscript = [null, null, [nonce, audience]];
        const { encodeCanonical } = await import('@tobari/crypto/cbor');
        const { signCoseSign1 } = await import('@tobari/crypto/cose');

        // DeviceAuthentication = ["DeviceAuthentication", SessionTranscript, DocType, DeviceNameSpacesBytes]
        // Since we have no Device Namespaces (yet), bytes is null/empty
        // Check MSO to get DocType
        const { decode: decodeCbor } = await import('@tobari/crypto/cbor');
        const mso = decodeCbor(decodeCbor(doc.issuerSigned.issuerAuth)[2]);

        const deviceAuthPayload = ["DeviceAuthentication", sessionTranscript, mso.docType, encodeCanonical({})];

        // Sign with Device Key
        const deviceAuth = await signCoseSign1(deviceAuthPayload, deviceKey, {
            alg: -35, // P-384
            kid: "device-key"
        }); // Returns bytes, but we need COSE_Sign1 structure? 
        // signCoseSign1 returns the full COSE_Sign1 structure as bytes.

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
