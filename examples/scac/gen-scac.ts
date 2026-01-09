import { generateSignedTobari } from '../../packages/codec/src/tobari-gen';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    console.log("Generating SCAC (Self-Hosted Crypto Account Ownership Credential)...");

    // 1. Load schema and data
    const schemaStr = await fs.readFile(path.join(__dirname, 'scac.yaml'), 'utf-8');
    const dataStr = await fs.readFile(path.join(__dirname, 'scac-data.yaml'), 'utf-8');
    const data = yaml.load(dataStr) as any;

    // Convert Base64 proof to Uint8Array for CBOR encoding
    if (typeof data.identity_proof === 'string') {
        data.identity_proof = new Uint8Array(Buffer.from(data.identity_proof, 'base64'));
    }

    // 2. Generate Issuer Key (Mock)
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    // 3. Generate signed Tobari document (mDoc)
    const coseBytes = await generateSignedTobari(schemaStr, data, keyPair.privateKey, {
        kid: "iss-scac-p384"
    });

    // 4. Save result
    const outputCose = path.join(__dirname, 'scac.cose');
    await fs.writeFile(outputCose, coseBytes);
    console.log(`Successfully generated SCAC COSE at: ${outputCose}`);

    // 5. Bundle HTML viewer (Simulate wallet view)
    const bundleScript = path.resolve(__dirname, '../../packages/codec/src/bundle-viewer.ts');
    const proc = Bun.spawn(["bun", "run", bundleScript, outputCose], { stdout: "inherit" });
    await proc.exited;
    
    console.log("View the result at examples/scac/scac.html");
}

main().catch(console.error);