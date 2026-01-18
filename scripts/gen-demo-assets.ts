import { generateSignedTobari } from '../packages/codec/src/tobari-gen';
import { deriveHPKEKeyPair } from '../packages/crypto/src/hpke';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    const assetsDir = path.resolve(process.cwd(), 'examples/demo-assets');
    const outputDir = path.resolve(assetsDir, 'generated');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    console.log("🚀 Generating Demo Identity Assets for 'Taro Saito'...");

    // 1. Load Persona Data
    const personaPath = path.resolve(assetsDir, 'taro-saito.yaml');
    const persona: any = yaml.load(fs.readFileSync(personaPath, 'utf-8'));

    // 2. Setup Demo Keys
    // Use fixed seed for deterministic demo keys
    const demoSecret = new TextEncoder().encode("tobari-demo-secret-key-32-bytes-long!!");
    const deviceKeyPair = await deriveHPKEKeyPair(demoSecret);
    const encryptionPublicKey = deviceKeyPair!.publicKey;

    // Issuer Key (P-384)
    const issuerKeyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    // Save public keys for verifier tests
    const deviceJwk = {
        kty: "EC",
        crv: "P-256",
        x: Buffer.from(encryptionPublicKey.slice(1, 33)).toString('base64url'),
        y: Buffer.from(encryptionPublicKey.slice(33, 65)).toString('base64url')
    };
    fs.writeFileSync(path.resolve(assetsDir, 'demo-device-pubkey.json'), JSON.stringify(deviceJwk, null, 2));

    // 3. Generate Documents
    const docs = [
        { id: 'jpki', schema: 'examples/juminhyo/juminhyo.yaml' },
        { id: 'license', schema: 'examples/jpdl/jpdl.yaml' },
        { id: 'passport', schema: 'docs/civ/icao9303.md' } // Minimal schema or just raw? Let's use custom simple schemas
    ];

    for (const doc of ['jpki', 'license', 'passport']) {
        const config = persona[doc];
        const schemaYaml = `
id: ${config.docType}
title: ${config.title}
fields:
${Object.keys(config.data).map(k => `  - id: ${k}\n    title: ${k.toUpperCase()}`).join('\n')}
`;

        console.log(`  - Generating ${doc} (${config.docType})...
`);
        
        // Generate Plain (for verification testing)
        const plainBinary = await generateSignedTobari(schemaYaml, config.data, issuerKeyPair.privateKey, {
            kid: "demo-issuer-p384",
            devicePublicKey: undefined, // Headless
        });
        fs.writeFileSync(path.resolve(outputDir, `taro-${doc}.cose`), plainBinary);

        // Generate Encrypted (for prefill/wallet testing)
        const encBinary = await generateSignedTobari(schemaYaml, config.data, issuerKeyPair.privateKey, {
            kid: "demo-issuer-p384",
            encryptionPublicKey: encryptionPublicKey,
        });
        fs.writeFileSync(path.resolve(outputDir, `taro-${doc}.enc.cose`), encBinary);
    }

    console.log(`\n✅ All demo assets generated in: ${outputDir}`);
    console.log(`🔐 These assets are encrypted for the fixed demo device key.`);
}

main().catch(console.error);
