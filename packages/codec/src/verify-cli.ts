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
    }
    console.log("------------------------------------------\n");
}

main().catch(console.error);
