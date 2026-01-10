import fs from 'fs';
import path from 'path';

// This script generates a standalone viewer.html for deployment to GitHub Pages.
// It has no embedded document data, but can load it from the URL fragment.

async function buildAppViewer() {
    console.log("📦 Bundling Stateless App Viewer for GitHub Pages...");

    const wasmPath = path.resolve('packages/crypto-wasm/pkg/tobari_crypto_wasm_bg.wasm');
    const wasmBase64 = fs.readFileSync(wasmPath).toString('base64');

    const buildResult = await Bun.build({
        entrypoints: [path.resolve('packages/codec/src/viewer-client.ts')],
        minify: true,
        target: 'browser',
    });
    const bundledJs = await buildResult.outputs[0].text();

    const gzipAndBase64 = (text: string) => {
        const compressed = Bun.gzipSync(new TextEncoder().encode(text));
        return Buffer.from(compressed).toString('base64');
    };

    const compressedJs = gzipAndBase64(bundledJs);

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8"><title>Tobari Secure Viewer</title>
    <style>body { background: #f7fafc; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; }</style>
</head>
<body>
    <div id="viewer-root">Loading Viewer...</div>
    <script type="module">
        async function inflate(b64) {
            const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const stream = new ReadableStream({
                start(controller) { controller.enqueue(bin); controller.close(); }
            }).pipeThrough(new DecompressionStream("gzip"));
            return await new Response(stream).text();
        }
        (async () => {
            const js = await inflate("${compressedJs}");
            const script = document.createElement("script");
            script.type = "module";
            script.textContent = js;
            document.body.appendChild(script);
            window.__TOBARI_WASM__ = "${wasmBase64}";
            
            const checkInit = setInterval(() => {
                if (window.initTobari) {
                    clearInterval(checkInit);
                    window.initTobari("", null); // Will load from #fragment
                }
            }, 10);
        })();
    </script>
</body></html>`;

    fs.writeFileSync('docs/public/viewer.html', html);
    console.log("✅ Generated docs/public/viewer.html for GitHub Pages.");
}

buildAppViewer();
