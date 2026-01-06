import fs from 'fs';
import path from 'path';
import { decode } from 'cbor-x';
import { subsetFont, bufferToDataUrl } from './font-engine';

async function buildViewer() {
    console.log("Bundling High-Fidelity Tobari Viewer...");

    const args = process.argv.slice(2);
    let tobariBinaryPath: string;
    let outPath: string;

    if (args.length > 0) {
        tobariBinaryPath = path.resolve(args[0]);
        const parsed = path.parse(tobariBinaryPath);
        // Default output is same directory, same name, .html extension
        outPath = path.resolve(parsed.dir, parsed.name + '.html');
        if (args.length > 1) {
            outPath = path.resolve(args[1]);
        }
    } else {
        tobariBinaryPath = path.resolve('examples/juminhyo/juminhyo.cose');
        outPath = path.resolve('examples/juminhyo/juminhyo.html');
    }

    if (!fs.existsSync(tobariBinaryPath)) {
        console.error(`Error: Input file not found at ${tobariBinaryPath}`);
        process.exit(1);
    }

    const tobariBinary = fs.readFileSync(tobariBinaryPath);

    // 1. Extract ALL text for total font subsetting
    console.log("Extracting all possible text characters for subsetting...");
    const doc = decode(tobariBinary);
    const { issuerSigned, fields } = doc;
    const issuerAuth = decode(issuerSigned.issuerAuth);
    const mso = decode(issuerAuth[2]);

    const namespace = mso.docType;
    const items = issuerSigned.nameSpaces[namespace] || [];

    // Collect text from data, exposures (disclosures), and the embedded layout template
    let dataText = "";
    const { decode: decodeCbor } = await import('@tobari/crypto/cbor');

    // Extract text from all IssuerSignedItems
    for (const itemBytes of items) {
        try {
            const item = decodeCbor(itemBytes);
            // [digestID, random, key, value]
            dataText += collectAllText(item[3]);
        } catch (e) {
            console.warn("Failed to parse item during subsetting:", e);
        }
    }

    // Collect all field labels for subsetting
    let labelText = "";
    if (fields) {
        const extractLabels = (fs: any[]) => {
            for (const f of fs) {
                if (f.id) labelText += f.id;
                if (f.items?.fields) extractLabels(f.items.fields);
            }
        };
        extractLabels(fields);
    }

    const engineText = "（非開示）Digital Certificate Signature Schema Compiled at Document Auth ID Sig ES384 Issued At 0123456789/:,.印発行者情報ISO/IEC 18013-5 MSO Verified";
    const combinedText = dataText + labelText + engineText;

    const uniqueChars = Array.from(new Set(Array.from(combinedText))).join('');
    console.log(`Unique characters to subset: ${uniqueChars.length}`);

    // 2. Subset Font (IPA MJ Mincho)
    const fontPath = path.resolve('shared/fonts/ipamjm.ttf');
    let fontCss = "";
    if (fs.existsSync(fontPath)) {
        console.log("Subsetting IPA MJ Mincho font...");
        const { buffer, mimeType } = await subsetFont(fontPath, uniqueChars);
        const fontDataUrl = bufferToDataUrl(buffer, mimeType);

        // Define the font-face. We use !important in elements to prefer this.
        fontCss = `
@font-face {
    font-family: 'TobariSubset';
    src: url('${fontDataUrl}') format('woff2');
    font-style: normal;
    font-weight: normal;
    font-display: block;
}
`;
        console.log(`Font subsetted: ${buffer.length} bytes`);
    } else {
        console.error(`FATAL: IPA Font not found at ${fontPath}`);
        process.exit(1);
    }

    // 3. Assemble HTML
    const templatePath = path.resolve('packages/codec/src/viewer-template.html');
    let html = fs.readFileSync(templatePath, 'utf-8');

    html = html.replace('/* BUNDLED_FONT_PLACEHOLDER */', fontCss);

    const base64Data = tobariBinary.toString('base64');
    const dataUri = `data:application/cbor;base64,${base64Data}`;

    const buildResult = await Bun.build({
        entrypoints: [path.resolve('packages/codec/src/viewer-client.ts')],
        minify: true,
        target: 'browser',
    });
    const bundledJs = await buildResult.outputs[0].text();

    // Try to load issuer-key.json from the same directory as the input file
    const keyPath = path.resolve(path.dirname(tobariBinaryPath), 'issuer-key.json');
    let issuerKeyJson = "null";
    if (fs.existsSync(keyPath)) {
        console.log(`Embedding Issuer Key from: ${keyPath}`);
        const keyData = fs.readFileSync(keyPath, 'utf-8');
        issuerKeyJson = JSON.stringify(JSON.parse(keyData)); // minify
    } else {
        console.warn("No issuer-key.json found. Signature verification will be skipped in viewer.");
    }

    const scriptBlock = `<script type="module">
${bundledJs}
window.__TOBARI_DATA__ = "${dataUri}";
window.__ISSUER_KEY__ = ${issuerKeyJson};
if (window.initTobari) {
    window.initTobari(window.__TOBARI_DATA__, window.__ISSUER_KEY__);
}
</script>`;

    const finalHtml = html.replace(/<script type="module">[\s\S]*?<\/script>/, () => scriptBlock);

    // const outPath defined above
    fs.writeFileSync(outPath, finalHtml);
    console.log(`Successfully generated verifiable viewer: ${outPath}`);
}

function collectAllText(obj: any): string {
    if (obj === undefined || obj === null) return "";
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    if (Array.isArray(obj)) return obj.map(collectAllText).join("");
    if (typeof obj === 'object') return Object.values(obj).map(collectAllText).join("");
    return "";
}

buildViewer().catch(console.error);
