import { generateSignedTobari } from '../../packages/codec/src/tobari-gen';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    console.log("Generating full-spec juminhyo.cose with local YAML data...");

    const schemaPath = path.resolve(__dirname, 'juminhyo.yaml');
    const schemaYaml = fs.readFileSync(schemaPath, 'utf-8');

    const yamlDataPath = path.resolve(__dirname, 'juminhyo-data.yaml');
    const jsonDataPath = path.resolve(__dirname, 'juminhyo-data.json');
    let sampleData: any;

    if (fs.existsSync(yamlDataPath)) {
        console.log("Loading data from juminhyo-data.yaml...");
        sampleData = yaml.load(fs.readFileSync(yamlDataPath, 'utf-8'));
    } else if (fs.existsSync(jsonDataPath)) {
        console.log("Loading data from juminhyo-data.json...");
        sampleData = JSON.parse(fs.readFileSync(jsonDataPath, 'utf-8'));
    } else {
        console.error("Error: No data file found (juminhyo-data.yaml or .json)");
        process.exit(1);
    }

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
        kid: "iss-local-p384"
    });

    const outputPath = path.resolve(__dirname, 'juminhyo.cose');
    fs.writeFileSync(outputPath, binary);

    console.log(`Successfully generated COSE file: ${outputPath} (${binary.length} bytes)`);
}

main().catch(console.error);
