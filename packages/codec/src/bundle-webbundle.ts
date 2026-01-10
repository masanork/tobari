import path from 'path';
import fs from 'fs';
import { BundleBuilder } from 'wbn';

async function createWebBundle() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error("Usage: bun run bundle-webbundle.ts <input_html_path>");
        process.exit(1);
    }

    const htmlPath = path.resolve(args[0]);
    if (!fs.existsSync(htmlPath)) {
        console.error(`Error: File not found ${htmlPath}`);
        process.exit(1);
    }

    const parsed = path.parse(htmlPath);
    const outPath = path.resolve(parsed.dir, parsed.name + '.wbn');

    console.log(`📦 Packaging ${parsed.base} into Web Bundle via 'wbn' npm package...`);

    const htmlContent = fs.readFileSync(htmlPath);
    
    // Create a new bundle builder
    const builder = new BundleBuilder();
    
    // In Web Bundles, the primary URL identifies the main resource.
    const baseUrl = `https://tobari.local/${parsed.name}/`;
    const indexUrl = `${baseUrl}index.html`;

    // Add the HTML file as the index
    builder.addExchange(
        indexUrl,
        200,
        {
            'Content-Type': 'text/html; charset=utf-8'
        },
        htmlContent
    );

    // Set the primary URL
    // Note: older versions of wbn might use different method names or properties.
    // Given 0.0.9, we'll try the standard approach.
    
    const bundle = builder.createBundle();

    fs.writeFileSync(outPath, Buffer.from(bundle));

    console.log(`✅ Successfully generated Web Bundle: ${outPath} (${bundle.byteLength} bytes)`);
}

createWebBundle().catch(err => {
    console.error("❌ Web Bundle generation failed:", err);
    process.exit(1);
});