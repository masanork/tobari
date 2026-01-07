import { generateSignedTobari } from '../../packages/codec/src/tobari-gen';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    console.log("Generating Local Service Request PoC document...");

    const schemaStr = await fs.readFile(path.join(__dirname, 'service-request.yaml'), 'utf-8');
    const dataStr = await fs.readFile(path.join(__dirname, 'child-allowance-local.yaml'), 'utf-8');

    const data = yaml.load(dataStr) as any;

    let keyPair;
    // Try to reuse existing key if available to keep verification working if keys are hardcoded somewhere
    try {
        const keyContent = await fs.readFile(path.join(__dirname, 'issuer-key.json'), "utf-8");
        const jwk = JSON.parse(keyContent);
        const privateKey = await crypto.subtle.importKey(
            "jwk",
            { ...jwk, d: undefined }, // This usually won't work as JWK on disk is Public Key only
            { name: "ECDSA", namedCurve: "P-384" },
            true,
            ["verify"]
        );
        // We actually need private key. The example gen-request.ts generates a new one each time.
        // So we will do the same.
    } catch (e) { }

    // Generate NEW Issuer Key for this Service Request
    keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    // Save Public Key for verification demo (overwriting the old one is fine for demo)
    const pubKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    await fs.writeFile(path.join(__dirname, 'issuer-key-local.json'), JSON.stringify(pubKeyJwk, null, 2));
    console.log("Saved Issuer Public Key to issuer-key-local.json");

    const coseBytes = await generateSignedTobari(schemaStr, data, keyPair.privateKey, {
        kid: "iss-service-request-p384-local"
    });

    // We name it .cose to be consistent, but we will bundle it into HTML
    const outputCose = path.join(__dirname, 'service-request-local.cose');
    await fs.writeFile(outputCose, coseBytes);
    console.log(`Generated COSE: ${outputCose}`);

    // Bundle HTML viewer
    const bundleScript = path.resolve(__dirname, '../../packages/codec/src/bundle-viewer.ts');

    // Check if bundle-viewer exists
    try {
        await fs.access(bundleScript);
    } catch {
        console.error("Bundle viewer script not found at " + bundleScript);
        process.exit(1);
    }

    const proc = Bun.spawn(["bun", "run", bundleScript, outputCose], { stdout: "inherit" });
    await proc.exited;
}

main().catch(console.error);
