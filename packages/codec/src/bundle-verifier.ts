import fs from 'fs';
import path from 'path';
import { generateSignedTobari } from './tobari-gen';

async function buildVerifier() {
    console.log("Bundling Verifier Tool...");

    // 1. Generate a fixed Issuer Key for the PoC
    // In a real scenario, this public key would be distributed to verifiers or found in a DID
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );
    const pubKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

    // 2. Generate juminhyo.cose using THIS key so the verifier works
    const schemaYaml = fs.readFileSync('examples/juminhyo/juminhyo.yaml', 'utf-8');
    const sampleData = {
        "証明書名称": "住民票の写し（世帯連記式）",
        "交付年月日": "2026-01-15",
        "世帯住所": "検証テスト用住所",
        "世帯員": []
    };
    const coseBinary = await generateSignedTobari(schemaYaml, sampleData, keyPair.privateKey, { kid: "poc-issuer" });
    fs.writeFileSync('examples/juminhyo/poc-sample.cose', coseBinary);

    // 3. Bundle the UI logic
    const buildResult = await Bun.build({
        entrypoints: [path.resolve('packages/codec/src/verifier-ui.ts')],
        minify: true,
        target: 'browser',
    });
    const bundledJs = await buildResult.outputs[0].text();

    // 4. Inject into template
    const template = fs.readFileSync('packages/codec/src/verifier-tool.html', 'utf-8');
    const finalHtml = template.replace(
        '/* BUNDLED_VERIFIER_JS */',
        `
        ${bundledJs}
        const pubKeyJwk = ${JSON.stringify(pubKeyJwk)};
        crypto.subtle.importKey('jwk', pubKeyJwk, { name: "ECDSA", namedCurve: "P-384" }, true, ["verify"])
            .then(key => {
                // verifier-ui logic is now available
                setupUI(key);
            });
        `
    );

    fs.writeFileSync('examples/verifier.html', finalHtml);
    console.log("Successfully generated examples/verifier.html");
}

buildVerifier().catch(console.error);
