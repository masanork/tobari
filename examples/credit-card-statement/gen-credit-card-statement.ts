import { generateSignedTobari } from '../../packages/codec/src/tobari-gen';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    console.log("Generating credit-card-statement.cose ...");

    const schemaPath = path.resolve(__dirname, 'credit-card-statement.yaml');
    const schemaYaml = fs.readFileSync(schemaPath, 'utf-8');

    const args = process.argv.slice(2);
    let yamlDataPath = path.resolve(__dirname, 'credit-card-statement-data.yaml');

    const dataArgIdx = args.indexOf('--data');
    if (dataArgIdx !== -1 && args.length > dataArgIdx + 1) {
        yamlDataPath = path.resolve(args[dataArgIdx + 1]);
        console.log(`Using custom data file: ${yamlDataPath}`);
    }

    let sampleData: any;

    if (fs.existsSync(yamlDataPath)) {
        sampleData = yaml.load(fs.readFileSync(yamlDataPath, 'utf-8'));
    } else {
        console.error(`Error: Data file not found at ${yamlDataPath}`);
        process.exit(1);
    }

    // Generate Issuer Key (Ephemeral)
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    // Save Public Key for verification
    const pubKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    fs.writeFileSync(path.resolve(__dirname, 'issuer-key.json'), JSON.stringify(pubKeyJwk, null, 2));

    const binary = await generateSignedTobari(schemaYaml, sampleData, keyPair.privateKey, {
        kid: "iss-credit-p384"
    });

    const outputPath = path.resolve(__dirname, 'credit-card-statement.cose');
    fs.writeFileSync(outputPath, binary);

    console.log(`Successfully generated COSE file: ${outputPath} (${binary.length} bytes)`);
}

main().catch(console.error);
