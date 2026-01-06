import { generateSignedTobari } from '../../packages/codec/src/tobari-gen';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    console.log("Generating Service Request PoC document...");

    const schemaStr = await fs.readFile(path.join(__dirname, 'service-request.yaml'), 'utf-8');
    const dataStr = await fs.readFile(path.join(__dirname, 'child-allowance-data.yaml'), 'utf-8');

    const data = yaml.load(dataStr) as any;

    // Generate Issuer Key for this Service Request
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    // Save Public Key for verification demo
    const pubKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    await fs.writeFile(path.join(__dirname, 'issuer-key.json'), JSON.stringify(pubKeyJwk, null, 2));
    console.log("Saved Issuer Public Key to issuer-key.json");

    const coseBytes = await generateSignedTobari(schemaStr, data, keyPair.privateKey, {
        kid: "iss-service-request-p384"
    });
    
    const outputCose = path.join(__dirname, 'service-request.cose');
    await fs.writeFile(outputCose, coseBytes);
    console.log(`Generated COSE: ${outputCose}`);

    // Bundle HTML viewer
    const bundleScript = path.resolve(__dirname, '../../packages/codec/src/bundle-viewer.ts');
    const proc = Bun.spawn(["bun", "run", bundleScript, outputCose], { stdout: "inherit" });
    await proc.exited;
}

main().catch(console.error);
