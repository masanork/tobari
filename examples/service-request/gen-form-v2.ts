import { file, write } from 'bun';
import { gzipSync } from 'bun';
import yaml from 'js-yaml';
import path from 'path';

async function generate() {
    // 1. Load Definition
    const yamlPath = path.join(import.meta.dir, 'child-allowance-v2.yaml');
    const yamlText = await file(yamlPath).text();
    const definition = yaml.load(yamlText) as any;

    // 2. Mock Identity Data (VPから取得したと想定)
    const identityData: any = {
        jpki: {
            name: "多張 太郎",
            address: "東京都渋谷区桜丘町1-1",
            birthDate: "1985-04-01",
            gender: "1"
        }
    };

    // 3. Simple Autofill Logic
    const initialData: any = {};
    
    function processFields(fields: any[], target: any) {
        for (const field of fields) {
            if (field.autofill) {
                const [source, pathStr] = field.autofill.split(':');
                if (identityData[source] && identityData[source][pathStr]) {
                    target[field.key] = identityData[source][pathStr];
                }
            }
            if (field.type === 'group' && field.fields) {
                target[field.key] = {};
                processFields(field.fields, target[field.key]);
            }
        }
    }
    processFields(definition.fields, initialData);

    // 4. Load Engine Script (Gzipped)
    const engineScriptPath = path.resolve(import.meta.dir, '../../packages/form-engine/dist/index.js');
    let engineScriptCompressed = "";
    try {
        const scriptBuffer = await file(engineScriptPath).arrayBuffer();
        const compressed = gzipSync(new Uint8Array(scriptBuffer));
        engineScriptCompressed = btoa(String.fromCharCode(...compressed));
    } catch (e) {
        console.error("Engine script not found. Run 'bun run build' in packages/form-engine.");
        process.exit(1);
    }

    // 5. Generate HTML
    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${definition.meta.title}</title>
    <style>
        body { background: #f0f2f5; padding: 2rem; font-family: sans-serif; }
        .container { max-width: 900px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    </style>
</head>
<body>
    <div class="container">
        <tobari-form id="myForm"></tobari-form>
    </div>

    <script type="module">
        (async () => {
            const compressedData = '${engineScriptCompressed}';
            const binaryString = atob(compressedData);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) { bytes[i] = binaryString.charCodeAt(i); }
            const decompressedStream = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
            const decompressed = await new Response(decompressedStream).arrayBuffer();
            const code = new TextDecoder().decode(decompressed);
            const blob = new Blob([code], { type: 'text/javascript' });
            const url = URL.createObjectURL(blob);
            await import(url);
            URL.revokeObjectURL(url);
            
            // Initialize Form
            const schema = ${JSON.stringify(definition, null, 2)};
            const initialData = ${JSON.stringify(initialData, null, 2)};
            const form = document.getElementById('myForm');
            form.setSchema(schema, initialData);
        })();
    </script>
</body>
</html>`;

    const outputPath = path.join(import.meta.dir, 'child-allowance-v2.html');
    await write(outputPath, html);
    console.log(`Generated: ${outputPath}`);
}

generate().catch(console.error);
