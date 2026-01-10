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

    const encrypt = process.argv.includes('--encrypt');
    let encryptionPublicKey: Uint8Array | undefined;
    let embeddedFont: string | undefined;

    // --- Font Subsetting (Privacy Protection) ---
    // Extract all characters from sampleData to create an encrypted font subset
    const { subsetFont, bufferToDataUrl } = await import('../../packages/codec/src/font-engine');
    const fontPath = path.resolve(process.cwd(), 'shared/fonts/ipamjm.ttf');
    
    if (fs.existsSync(fontPath)) {
        console.log("Subsetting font for encrypted embedding...");
        const allText = JSON.stringify(sampleData) + "（非開示）Digital Certificate Signature ES384 Verified 氏名住所交付年月日印";
        const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
        const uniqueChars = Array.from(new Set(Array.from(segmenter.segment(allText)).map(s => s.segment))).join('');
        
        const { buffer, mimeType } = await subsetFont(fontPath, uniqueChars);
        const fontDataUrl = bufferToDataUrl(buffer, mimeType);
        embeddedFont = `
@font-face {
    font-family: 'TobariSubset';
    src: url('${fontDataUrl}') format('woff2');
    font-style: normal;
    font-weight: normal;
    font-display: block;
}
`;
        console.log(`Font subsetted: ${buffer.length} bytes`);
    }

    if (encrypt) {
        console.log("Encryption enabled. Generating PoC Demo Key (Salt: 'tobari')...");
        const { deriveHPKEKeyPair } = await import("../../packages/crypto/src/hpke");
        
        const demoSecret = new TextEncoder().encode("tobari-demo-secret-key-32-bytes-long!!");
        const keyPair = await deriveHPKEKeyPair(demoSecret);
        
        if (!keyPair || !keyPair.publicKey) {
            throw new Error("Failed to derive HPKE KeyPair from WASM");
        }
        
        encryptionPublicKey = keyPair.publicKey;
    }

    const binary = await generateSignedTobari(schemaYaml, sampleData, keyPair.privateKey, {
        kid: "iss-local-p384",
        encryptionPublicKey,
        embeddedFont
    });

    const outputPath = path.resolve(__dirname, 'juminhyo.cose');
    fs.writeFileSync(outputPath, binary);

    console.log(`Successfully generated COSE file: ${outputPath} (${binary.length} bytes)`);
}

main().catch(console.error);
