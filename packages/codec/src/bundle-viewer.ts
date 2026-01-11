import fs from 'fs';
import path from 'path';
import { decode } from 'cbor-x';
import { subsetFont, bufferToDataUrl } from './font-engine';

export async function bundleViewer(
    tobariBinary: Uint8Array,
    templatePath: string = path.resolve('packages/codec/src/viewer-template.html'),
    options: { usePqc?: boolean } = {}
): Promise<string> {
    console.log(`Bundling High-Fidelity Tobari Viewer... (PQC: ${options.usePqc ? 'Enabled' : 'Disabled'})`);

    // 1. Extract ALL text for total font subsetting
    console.log("Extracting all possible text characters for subsetting...");
    
    let dataText = "";
    let fields: any[] = [];
    let skipPlaintextFont = false;

    // Check if it's an encrypted JSON wrapper
    let isEncrypted = false;
    try {
        const text = new TextDecoder().decode(tobariBinary);
        const json = JSON.parse(text);
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

    const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
    const segments = segmenter.segment(combinedText);
    const uniqueSegments = new Set<string>();

    for (const seg of segments) {
        uniqueSegments.add(seg.segment);
    }

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
    // const templatePath = path.resolve('packages/codec/src/viewer-template.html'); // Passed as arg
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
        const wasmDir = path.resolve('packages/crypto-wasm/pkg');
        let wasmPath = options.usePqc
            ? path.join(wasmDir, 'full/tobari_crypto_wasm_full_bg.wasm')
            : path.join(wasmDir, 'core/tobari_crypto_wasm_core_bg.wasm');

        if (!fs.existsSync(wasmPath)) {
             // Fallback to default build path
             wasmPath = path.resolve('packages/crypto-wasm/pkg/tobari_crypto_wasm_bg.wasm');
        }

        let wasmBase64 = "";

        if (fs.existsSync(wasmPath)) {
            console.log(`Embedding WASM from: ${wasmPath}`);
            wasmBase64 = fs.readFileSync(wasmPath).toString('base64');
        } else {
            console.warn(`WARNING: WASM binary not found at ${wasmPath}. Viewer will lack crypto functions.`);
        }

    

    // Try to load issuer-key.json from the same directory as the input file (if possible? No context here)
    // We will just pass null for issuer key if we are in library mode.
    // The calling script should handle key embedding if needed? 
    // Actually the current implementation embeds it.
    // But in library mode we don't know the path.
    // Let's make issuerKeyJson an optional arg or just leave it null/placeholder.
    // The viewer client fetches key or it is embedded.
    
    // For now, keep it simple: no key embedding in library function unless passed.
    // But `window.__ISSUER_KEY__` is written.
    let issuerKeyJson = "null";

    // Create Data URI for the payload
    const base64Data = Buffer.from(tobariBinary).toString('base64');
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

    return finalHtml;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    let tobariBinaryPath: string;
    let outPath: string;

    if (args.length > 0) {
        tobariBinaryPath = path.resolve(args[0]);
        const parsed = path.parse(tobariBinaryPath);
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
    bundleViewer(tobariBinary).then(html => {
        fs.writeFileSync(outPath, html);
        console.log(`Successfully generated verifiable viewer: ${outPath} (Gzipped & Embedded)`);
    });
}

function collectAllText(obj: any): string {
    if (obj === undefined || obj === null) return "";
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    if (Array.isArray(obj)) return obj.map(collectAllText).join("");
    if (typeof obj === 'object') return Object.values(obj).map(collectAllText).join("");
    return "";
}
