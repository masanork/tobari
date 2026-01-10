import { generateSignedTobari } from '../../packages/codec/src/tobari-gen';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    console.log("Generating Ininjo PoC credential...");

    const schemaPath = path.resolve(__dirname, 'ininjo.yaml');
    const schemaYaml = fs.readFileSync(schemaPath, 'utf-8');

    const jsonDataPath = path.resolve(__dirname, 'ininjo-data.json');

    if (!fs.existsSync(jsonDataPath)) {
        console.error("Error: ininjo-data.json not found");
        process.exit(1);
    }

    const sampleData = JSON.parse(fs.readFileSync(jsonDataPath, 'utf-8'));

    // 4. Generate/Load Issuer Key
    console.log("Generating Ininjo PoC credential...");
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    // Save public key
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    fs.writeFileSync(path.join(__dirname, "issuer-key.json"), JSON.stringify(jwk, null, 2));
    console.log("Saved Issuer Public Key to issuer-key.json");

    // 5. Generate COSE
    const binary = await generateSignedTobari(schemaYaml, sampleData, keyPair.privateKey, {
        kid: "iss-ininjo-p384"
    });

    const outputPath = path.resolve(__dirname, 'ininjo.cose');
    fs.writeFileSync(outputPath, binary);

    console.log(`Successfully generated COSE file: ${outputPath} (${binary.length} bytes)`);
    console.log("You can now verify/view this using: bun run packages/codec/src/bundle-viewer.ts examples/ininjo/ininjo.cose");
}

main().catch(console.error);
