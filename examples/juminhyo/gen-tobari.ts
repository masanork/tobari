import { generateSignedTobari } from '../../packages/codec/src/tobari-gen';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    const isLockedBuild = process.argv.includes('--locked');
    const usePqc = process.argv.includes('--pqc');
    const pqcPrivateKeyPath = readArgValue('--pqc-private-key');
    const pqcPublicKeyPath = readArgValue('--pqc-public-key');
    const suffix = isLockedBuild ? '.locked' : '';
    
    console.log(`Generating juminhyo${suffix}.cose...`);

    const schemaPath = path.resolve(__dirname, 'juminhyo.yaml');
    const schemaYaml = fs.readFileSync(schemaPath, 'utf-8');

    const yamlDataPath = path.resolve(__dirname, 'juminhyo-data.yaml');
    const sampleData = yaml.load(fs.readFileSync(yamlDataPath, 'utf-8'));

    const { privateKey: issuerPrivateKey } = await loadOrCreateIssuerKeyPair();
    const devicePublicKey = await loadOrCreateDevicePublicKey();
    const pqcKeyPair = usePqc
        ? await loadOrCreateIssuerPqcKeyPair(pqcPrivateKeyPath, pqcPublicKeyPath)
        : null;

    const encrypt = process.argv.includes('--encrypt') || isLockedBuild;
    let encryptionPublicKey: Uint8Array | undefined;
    let embeddedFont: Uint8Array | undefined;

    // --- Font Subsetting ---
    const { subsetFont } = await import('../../packages/codec/src/font-engine');
    const fontPath = path.resolve(process.cwd(), 'shared/fonts/ipamjm.ttf');
    
    if (fs.existsSync(fontPath)) {
        const allText = JSON.stringify(sampleData) + "（非開示）Digital Certificate Signature ES384 Verified 氏名住所交付年月日印";
        const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
        const uniqueChars = Array.from(new Set(Array.from(segmenter.segment(allText)).map(s => s.segment))).join('');
        const { buffer } = await subsetFont(fontPath, uniqueChars);
        embeddedFont = new Uint8Array(buffer);
    }

    if (encrypt) {
        const recipientKeyPath = path.resolve(__dirname, 'recipient-pubkey.json');
        
        if (isLockedBuild && fs.existsSync(recipientKeyPath)) {
            console.log(`🔒 Using REAL Recipient Public Key from ${recipientKeyPath}`);
            const keyData = JSON.parse(fs.readFileSync(recipientKeyPath, 'utf-8'));
            // Expecting raw base64 encoded public key from HPKE
            encryptionPublicKey = Uint8Array.from(atob(keyData.pubkey), c => c.charCodeAt(0));
        } else {
            console.log("🔓 Using DEMO Shared Key for encryption...");
            const { deriveHPKEKeyPair } = await import("../../packages/crypto/src/hpke");
            const demoSecret = new TextEncoder().encode("tobari-demo-secret-key-32-bytes-long!!");
            const demoKeyPair = await deriveHPKEKeyPair(demoSecret);
            encryptionPublicKey = demoKeyPair!.publicKey;
        }
    }

    const binary = await generateSignedTobari(schemaYaml, sampleData, issuerPrivateKey, {
        kid: "iss-local-p384",
        devicePublicKey,
        pqcCountersign: pqcKeyPair
            ? {
                privateKey: pqcKeyPair.privateKey,
                kid: "iss-local-mldsa65"
            }
            : undefined,
        encryptionPublicKey,
        embeddedFont
    });

    const outputPath = path.resolve(__dirname, `juminhyo${suffix}.cose`);
    fs.writeFileSync(outputPath, binary);
    console.log(`✅ Generated: ${outputPath}`);
}

main().catch(console.error);

async function loadOrCreateIssuerKeyPair(): Promise<{ privateKey: CryptoKey }> {
    const issuerPrivKeyPath = path.resolve(__dirname, 'issuer-private-key.json');
    const issuerPubKeyPath = path.resolve(__dirname, 'issuer-key.json');

    if (fs.existsSync(issuerPrivKeyPath)) {
        const jwk = JSON.parse(fs.readFileSync(issuerPrivKeyPath, 'utf-8'));
        const privateKey = await crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "ECDSA", namedCurve: "P-384" },
            true,
            ["sign"]
        );
        const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true, key_ops: ["verify"] };
        fs.writeFileSync(issuerPubKeyPath, JSON.stringify(pubJwk, null, 2));
        return { privateKey };
    }

    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    fs.writeFileSync(issuerPrivKeyPath, JSON.stringify(privateJwk, null, 2));
    fs.writeFileSync(issuerPubKeyPath, JSON.stringify(publicJwk, null, 2));
    return { privateKey: keyPair.privateKey };
}

async function loadOrCreateDevicePublicKey(): Promise<CryptoKey> {
    const deviceKeyPath = path.resolve(__dirname, 'device-key-p256.json');

    if (fs.existsSync(deviceKeyPath)) {
        const jwk = JSON.parse(fs.readFileSync(deviceKeyPath, 'utf-8'));
        const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
        return await crypto.subtle.importKey(
            "jwk",
            pubJwk,
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["verify"]
        );
    }

    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
    );
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    fs.writeFileSync(deviceKeyPath, JSON.stringify(privateJwk, null, 2));
    return keyPair.publicKey;
}

function readArgValue(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    if (index === -1) return undefined;
    return process.argv[index + 1];
}

async function loadOrCreateIssuerPqcKeyPair(
    privateKeyPath?: string,
    publicKeyPath?: string
): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
    const issuerPrivKeyPath = path.resolve(__dirname, privateKeyPath || 'issuer-pqc-private-key.json');
    const issuerPubKeyPath = path.resolve(__dirname, publicKeyPath || 'issuer-pqc-public-key.json');

    if (fs.existsSync(issuerPrivKeyPath)) {
        const stored = JSON.parse(fs.readFileSync(issuerPrivKeyPath, 'utf-8'));
        const privateKey = Buffer.from(stored.privateKey, 'base64url');
        let publicKey: Uint8Array;
        if (fs.existsSync(issuerPubKeyPath)) {
            const pubStored = JSON.parse(fs.readFileSync(issuerPubKeyPath, 'utf-8'));
            publicKey = Buffer.from(pubStored.publicKey, 'base64url');
        } else {
            publicKey = new Uint8Array(0);
        }
        return { privateKey: new Uint8Array(privateKey), publicKey: new Uint8Array(publicKey) };
    }

    const { generateMlDsa65KeyPair } = await import('../../packages/crypto/src/pqc');
    const keys = await generateMlDsa65KeyPair();
    fs.writeFileSync(issuerPrivKeyPath, JSON.stringify({
        alg: "ML-DSA-65",
        privateKey: Buffer.from(keys.privateKey).toString('base64url')
    }, null, 2));
    fs.writeFileSync(issuerPubKeyPath, JSON.stringify({
        alg: "ML-DSA-65",
        publicKey: Buffer.from(keys.publicKey).toString('base64url')
    }, null, 2));
    return keys;
}
