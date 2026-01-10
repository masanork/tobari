import { generateSignedTobari } from '../../packages/codec/src/tobari-gen';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    const isLockedBuild = process.argv.includes('--locked');
    const suffix = isLockedBuild ? '.locked' : '';
    
    console.log(`Generating juminhyo${suffix}.cose...`);

    const schemaPath = path.resolve(__dirname, 'juminhyo.yaml');
    const schemaYaml = fs.readFileSync(schemaPath, 'utf-8');

    const yamlDataPath = path.resolve(__dirname, 'juminhyo-data.yaml');
    const sampleData = yaml.load(fs.readFileSync(yamlDataPath, 'utf-8'));

    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

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

    const binary = await generateSignedTobari(schemaYaml, sampleData, keyPair.privateKey, {
        kid: "iss-local-p384",
        encryptionPublicKey,
        embeddedFont
    });

    const outputPath = path.resolve(__dirname, `juminhyo${suffix}.cose`);
    fs.writeFileSync(outputPath, binary);
    console.log(`✅ Generated: ${outputPath}`);
}

main().catch(console.error);
