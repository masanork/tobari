import { generateSignedTobari } from './packages/codec/src/tobari-gen';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    console.log("Generating juminhyo.tobari using ES384...");

    // 1. Load Schema
    const schemaPath = path.resolve('juminhyo.yaml');
    const schemaYaml = fs.readFileSync(schemaPath, 'utf-8');

    // 2. Prepare Sample Data (Extracted from juminhyo.md structure)
    // In a real app, this would come from a form or database
    const sampleData = {
        "証明書名称": "住民票の写し（世帯連記式）",
        "交付年月日": "2026-01-15",
        "世帯住所": "東京都港区虎ノ門2-2-1 虎ノ門ハイツ101号",
        "世帯主氏名": "䶒藤󠄃 太朗󠄅",
        "世帯員": [
            {
                "氏名": "䶒藤󠄃 太朗󠄅",
                "フリガナ": "サイトウ タロウ",
                "生年月日": "1989-01-01",
                "性別": "男",
                "続柄": "世帯主",
                "住民となった日": "2019-12-04",
                "前住所": "東京都千代田区霞が関2丁目2番1号",
                "本籍": ["東京都千代田区千代田1-1", "筆頭者：䶒藤󠄃 太朗󠄅"],
                "個人番号": "379474484458"
            },
            {
                "氏名": "䶒藤󠄃 花󠄃子",
                "フリガナ": "サイトウ ハナコ",
                "生年月日": "1993-05-05",
                "性別": "女",
                "続柄": "妻",
                "個人番号": "454972364860"
            }
        ],
        "発行者役職": "△△△△長",
        "発行者氏名": "○○　○○"
    };

    // 3. Generate P-384 KeyPair (Issuer Key)
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    // 4. Generate Signed Tobari File
    const tobariBinary = await generateSignedTobari(schemaYaml, sampleData, keyPair.privateKey, {
        kid: "iss-p384-001"
    });

    // 5. Save to file
    const outputPath = path.resolve('juminhyo.tobari');
    fs.writeFileSync(outputPath, tobariBinary);

    console.log(`Successfully generated: ${outputPath}`);
    console.log(`Binary size: ${tobariBinary.length} bytes`);

    // --- Verification Check ---
    const { verifyFormToken } = await import('./packages/crypto/src/cose');
    const { base64url } = await import('./packages/crypto/src/utils');
    const token = base64url.encode(tobariBinary);
    const verified = await verifyFormToken(token, keyPair.publicKey);

    console.log("Integrity Verification: OK");
    console.log("Schema ID:", verified.schema_id);
}

main().catch(console.error);
