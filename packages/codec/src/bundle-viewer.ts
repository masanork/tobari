import fs from 'fs';
import path from 'path';
import { decode } from 'cbor-x';
import { subsetFont, bufferToDataUrl } from './font-engine';

async function buildViewer() {
    console.log("Bundling High-Fidelity Tobari Viewer...");

    const tobariBinaryPath = path.resolve('examples/juminhyo/juminhyo.tobari');
    if (!fs.existsSync(tobariBinaryPath)) {
        console.error("Error: juminhyo.tobari not found.");
        process.exit(1);
    }

    const tobariBinary = fs.readFileSync(tobariBinaryPath);

    // 1. Extract ALL text for total font subsetting
    console.log("Extracting all possible text characters for subsetting...");
    const coseArray = decode(tobariBinary);
    const payload = decode(coseArray[2]);
    const disclosures = payload.disclosures || [];

    // Collect text from data, exposures (disclosures), and the embedded layout template
    const templateText = payload.display?.template || "";
    let dataText = collectAllText(payload.data);

    // Decode disclosures to get the real values
    console.log(`Parsing ${disclosures.length} disclosures...`);
    const { decode: decodeCbor } = await import('@tobari/crypto/cbor');
    for (const d of disclosures) {
        try {
            const decoded = Uint8Array.from(atob(d.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
            const disclosureArray = decodeCbor(decoded);
            const value = disclosureArray.length === 3 ? disclosureArray[2] : disclosureArray[1];
            dataText += collectAllText(value);
        } catch (e) {
            console.warn("Failed to parse disclosure during subsetting:", e);
        }
    }

    const engineText = "（非開示）Digital Certificate Signature Schema Compiled at Document Auth ID Sig ES384 Issued At 0123456789/:,.令和上記は、住民基本台帳の写しと相違ないことを証明する。交付役職名氏主印員";
    const combinedText = templateText + dataText + engineText;

    const uniqueChars = Array.from(new Set(Array.from(combinedText))).join('');
    console.log(`Unique characters to subset: ${uniqueChars.length}`);

    // 2. Subset Font (IPA MJ Mincho)
    const fontPath = path.resolve('../srn/shared/fonts/ipamjm.ttf');
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

    const scriptBlock = `<script type="module">
${bundledJs}
window.__TOBARI_DATA__ = "${dataUri}";
if (window.initTobari) {
    window.initTobari(window.__TOBARI_DATA__);
}
</script>`;

    const finalHtml = html.replace(/<script type="module">[\s\S]*?<\/script>/, scriptBlock);

    const outPath = path.resolve('examples/juminhyo/juminhyo-verifiable.html');
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
