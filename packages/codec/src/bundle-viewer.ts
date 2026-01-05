import fs from 'fs';
import path from 'path';
import { decode } from 'cbor-x';
import { subsetFont, bufferToDataUrl } from './font-engine';

async function buildViewer() {
    console.log("Bundling Self-Contained Tobari Viewer with Font Embedding...");

    const tobariBinaryPath = path.resolve('juminhyo.tobari');
    if (!fs.existsSync(tobariBinaryPath)) {
        console.error("Error: juminhyo.tobari not found. Run gen-tobari.ts first.");
        process.exit(1);
    }

    const tobariBinary = fs.readFileSync(tobariBinaryPath);

    // 1. Extract text for font subsetting
    console.log("Extracting text for font subsetting...");
    const coseArray = decode(tobariBinary);
    const payload = decode(coseArray[2]);
    const allText = collectAllText(payload);
    console.log(`Text to subset: "${allText.slice(0, 50)}..." (${allText.length} chars)`);

    // 2. Subset Font
    const fontPath = path.resolve('../srn/shared/fonts/ipamjm.ttf'); // Path to actual font
    let fontCss = "";
    if (fs.existsSync(fontPath)) {
        console.log("Subsetting font...");
        const { buffer, mimeType } = await subsetFont(fontPath, allText + "住民票の写し検証済みバイナリ員印氏名生年月日性別続柄個人番号本籍発行者役職");
        const fontDataUrl = bufferToDataUrl(buffer, mimeType);
        fontCss = `@font-face { font-family: 'TobariSubset'; src: url('${fontDataUrl}') format('woff2'); }`;
        console.log(`Font subsetted: ${buffer.length} bytes`);
    } else {
        console.warn(`Warning: Font not found at ${fontPath}. Skipping embedding.`);
    }

    // 3. Prepare Data URI
    const base64Data = tobariBinary.toString('base64');
    const dataUri = `data:application/cbor;base64,${base64Data}`;

    // 4. Bundle JS
    const buildResult = await Bun.build({
        entrypoints: [path.resolve('packages/codec/src/viewer-client.ts')],
        minify: true,
        target: 'browser',
    });

    if (!buildResult.success) {
        console.error("Build failed:", buildResult.logs);
        process.exit(1);
    }
    const bundledJs = await buildResult.outputs[0].text();

    // 5. Assemble HTML
    const templatePath = path.resolve('packages/codec/src/viewer-template.html');
    let html = fs.readFileSync(templatePath, 'utf-8');

    html = html.replace('/* BUNDLED_FONT_PLACEHOLDER */', fontCss);

    const scriptBlock = `<script type="module">
${bundledJs}
window.__TOBARI_DATA__ = "${dataUri}";
if (window.initTobari) {
    window.initTobari(window.__TOBARI_DATA__);
} else {
    console.error("initTobari not found in bundle");
}
</script>`;

    // Find the script tag and replace it
    const finalHtml = html.replace(/<script type="module">[\s\S]*?<\/script>/, scriptBlock);

    const outPath = path.resolve('juminhyo-verifiable.html');
    fs.writeFileSync(outPath, finalHtml);
    console.log(`Successfully generated verifiable viewer: ${outPath} (${finalHtml.length} bytes)`);
}

function collectAllText(obj: any): string {
    let text = "";
    if (typeof obj === 'string') {
        text += obj;
    } else if (Array.isArray(obj)) {
        obj.forEach(item => text += collectAllText(item));
    } else if (typeof obj === 'object' && obj !== null) {
        Object.values(obj).forEach(val => text += collectAllText(val));
    }
    return text;
}

buildViewer().catch(console.error);
