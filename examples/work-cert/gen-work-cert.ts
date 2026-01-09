import { generateSignedTobari } from '../../packages/codec/src/tobari-gen';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    console.log("Generating work-cert.cose with local YAML data...");

    const schemaPath = path.resolve(__dirname, 'work-cert.yaml');
    const schemaYaml = fs.readFileSync(schemaPath, 'utf-8');

    const yamlDataPath = path.resolve(__dirname, 'work-cert-data.yaml');
    let sampleData: any;

    if (fs.existsSync(yamlDataPath)) {
        console.log("Loading data from work-cert-data.yaml...");
        sampleData = yaml.load(fs.readFileSync(yamlDataPath, 'utf-8'));
    } else {
        console.error("Error: No data file found (work-cert-data.yaml)");
        process.exit(1);
    }

    // Generate or load a key for signing
    // For simplicity, we regenerate one or check if issuer-key.json exists?
    // Juminhyo example generates a new one each time but saves public key.

    // Check if we can reuse an existing key to keep it stable if needed, but generation is fine.
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    // Save Public Key for verification
    const pubKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    fs.writeFileSync(path.resolve(__dirname, 'issuer-key.json'), JSON.stringify(pubKeyJwk, null, 2));
    console.log("Saved Issuer Public Key to issuer-key.json");

    const binary = await generateSignedTobari(schemaYaml, sampleData, keyPair.privateKey, {
        kid: "iss-work-cert-p384"
    });

    const outputPath = path.resolve(__dirname, 'work-cert.cose');
    fs.writeFileSync(outputPath, binary);

    console.log(`Successfully generated COSE file: ${outputPath} (${binary.length} bytes)`);
}

main().catch(console.error);
