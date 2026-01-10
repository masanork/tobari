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
    
    let dataText = "";
    let fields: any[] = [];
    let skipPlaintextFont = false;

    // Check if it's an encrypted JSON wrapper
    let isEncrypted = false;
    try {
        const json = JSON.parse(tobariBinary.toString());
        if (json.tobari_enc === true) {
            isEncrypted = true;
            skipPlaintextFont = true; // Protect privacy
            console.log("Encrypted payload detected. Skipping content subsetting to prevent leaks.");
        }
    } catch (e) {
        // Assume raw CBOR
    }

    if (!isEncrypted) {
        try {
            const doc = decode(tobariBinary);
            // If the document already has a font (even if plain CBOR), we can skip subsetting here
            if (doc.visuals && doc.visuals.font) {
                skipPlaintextFont = true;
                console.log("Document already contains embedded visuals. Skipping plain subsetting.");
            }
            fields = doc.fields;
// ... (rest of text extraction)
            const { issuerSigned } = doc;
            const issuerAuth = decode(issuerSigned.issuerAuth);
            const mso = decode(issuerAuth[2]);

            const namespace = mso.docType;
            const items = issuerSigned.nameSpaces[namespace] || [];

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
        } catch (e) {
            console.warn("Failed to parse CBOR for subsetting:", e);
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

    // Improve unique character extraction to handle IVS (Ideographic Variation Sequences)
    // Naive Set() splits Base char and VS, causing IVS glyphs to be lost in subsetting.
    // We need to keep Base+VS as a single unit or ensure VS follows Base in the subset string?
    // Actually, subset-font usually takes a string and looks up glyphs. If we scramble the order,
    // the shaper sees "Base" then later "VS" separately, it won't pick the IVS glyph.
    // So we must prioritize keeping the sequence intact in the minimal text, 
    // OR just pass the full text (but that's too big).
    // Better approach: Extract all grapheme clusters or at least explicit IVS sequences.

    const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
    const segments = segmenter.segment(combinedText);
    const uniqueSegments = new Set<string>();

    for (const seg of segments) {
        uniqueSegments.add(seg.segment);
    }

    // Join them back. Now IVS sequences like "藤󠄃" are kept as one string in the Set,
    // and joined back together.
    // Note: The order doesn't matter for the subsetter as long as the sequence is intact in the input string?
    // Wait, if the subsetter takes "A B", it sees glyph A and glyph B. 
    // If it takes "AB", it might see ligature AB.
    // For IVS, we need "Base VS".
    // If we join the set ie. "BaseVS" + "Other", the resulting string contains "Base" "VS" "Other".
    // The font engine (harfbuzz or opentype) should handle it if they appear sequentially.
    const uniqueChars = Array.from(uniqueSegments).join('');
    console.log(`Unique characters (graphemes) to subset: ${uniqueSegments.size}`);

    // 2. Subset Font (IPA MJ Mincho)
    const fontPath = path.resolve('shared/fonts/ipamjm.ttf');
    let fontCss = "";
    if (fs.existsSync(fontPath) && !skipPlaintextFont) {
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
    } else if (!skipPlaintextFont) {
        console.warn(`WARNING: IPA Font not found at ${fontPath}. Generic serif will be used.`);
    }

    // 3. Assemble HTML
    const templatePath = path.resolve('packages/codec/src/viewer-template.html');
    let html = fs.readFileSync(templatePath, 'utf-8');


    const buildResult = await Bun.build({
        entrypoints: [path.resolve('packages/codec/src/viewer-client.ts')],
        minify: true,
        target: 'browser',
        naming: '[name].[ext]',
        // Inline all dependencies
    });
    const bundledJs = await buildResult.outputs[0].text();

    // Gzip Compression Helper
    const gzipAndBase64 = (text: string) => {
        const compressed = Bun.gzipSync(new TextEncoder().encode(text));
        return Buffer.from(compressed).toString('base64');
    };

        const compressedCss = gzipAndBase64(fontCss);

        const compressedJs = gzipAndBase64(bundledJs);

    

        // Read and Inline WASM binary

        const wasmPath = path.resolve('packages/crypto-wasm/pkg/tobari_crypto_wasm_bg.wasm');

        let wasmBase64 = "";

        if (fs.existsSync(wasmPath)) {

            wasmBase64 = fs.readFileSync(wasmPath).toString('base64');

        }

    

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

    // Create Data URI for the payload
    const base64Data = tobariBinary.toString('base64');
    const mimeType = isEncrypted ? 'application/json' : 'application/cbor';
    const dataUri = `data:${mimeType};base64,${base64Data}`;

    // Bootstrap script that inflates and executes
    const scriptBlock = `<script type="module">
async function inflate(b64) {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const stream = new ReadableStream({
        start(controller) { controller.enqueue(bin); controller.close(); }
    }).pipeThrough(new DecompressionStream("gzip"));
    const text = await new Response(stream).text();
    return text;
}

(async () => {
    // 1. Inflate CSS and inject
    const css = await inflate("${compressedCss}");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    // 2. Inflate JS and execute
    const js = await inflate("${compressedJs}");
    const script = document.createElement("script");
    script.type = "module";
    script.textContent = js;
    document.body.appendChild(script);

    // 3. Init Tobari
    window.__TOBARI_DATA__ = "${dataUri}";
    window.__ISSUER_KEY__ = ${issuerKeyJson};
    window.__TOBARI_WASM__ = "${wasmBase64}";
    
    // Redirect logic for file:// protocols to support WebAuthn
    if (window.location.protocol === 'file:') {
        const secureViewerUrl = "https://masanork.github.io/tobari/viewer.html";
        const b64 = window.__TOBARI_DATA__.split(',')[1];
        const redirectUrl = secureViewerUrl + "#data=" + encodeURIComponent(b64);

        document.body.innerHTML = \`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; background: #f7fafc; text-align: center; padding: 20px;">
                <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); max-width: 500px;">
                    <div style="font-size: 48px; margin-bottom: 20px;">🌐</div>
                    <h2 style="margin-bottom: 10px;">Secure Access Required</h2>
                    <p style="color: #718096; margin-bottom: 30px; line-height: 1.5;">To use your <strong>Hardware Passkey</strong> for decryption, this document needs to be opened in a Secure Context.</p>
                    <a href="\${redirectUrl}" style="display: block; background: #3182ce; color: white; text-decoration: none; padding: 14px 24px; border-radius: 6px; font-size: 16px; font-weight: bold; margin-bottom: 15px;">
                        Open in Secure Viewer
                    </a>
                    <p style="font-size: 12px; color: #a0aec0;">Your encrypted data is passed via URL fragment and is <strong>never sent to the server</strong>.</p>
                    <hr style="border: none; border-top: 1px solid #edf2f7; margin: 20px 0;">
                    <button onclick="window.initTobari(window.__TOBARI_DATA__, window.__ISSUER_KEY__)" style="background: none; border: none; color: #3182ce; cursor: pointer; text-decoration: underline; font-size: 14px;">
                        Stay here (Fallback mode)
                    </button>
                </div>
            </div>
        \`;
        return;
    }

    let attempts = 0;
    const checkInit = setInterval(() => {
        attempts++;
        if (window.initTobari) {
            clearInterval(checkInit);
            window.initTobari(window.__TOBARI_DATA__, window.__ISSUER_KEY__).catch(err => {
                console.error("Tobari Init Error:", err);
                document.body.innerHTML = '<div style="color:red; padding:20px;">Init Error: ' + err + '</div>';
            });
        }
        if (attempts > 500) {
            clearInterval(checkInit);
            document.body.innerHTML = '<div style="color:red; padding:20px;">Fatal: Tobari initialization timed out.</div>';
        }
    }, 10);
})();
</script>`;

    const finalHtml = html
        .replace('/* BUNDLED_FONT_PLACEHOLDER */', '/* CSS Loaded dynamically via JS inflation */')
        .replace(/<script type="module">[\s\S]*?<\/script>/, () => scriptBlock);

    fs.writeFileSync(outPath, finalHtml);
    console.log(`Successfully generated verifiable viewer: ${outPath} (Gzipped & Embedded)`);
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
