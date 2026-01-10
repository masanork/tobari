import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';

async function createSignedWebBundle() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error("Usage: bun run bundle-swbn.ts <input_html_path>");
        process.exit(1);
    }

    const htmlPath = path.resolve(args[0]);
    const parsed = path.parse(htmlPath);
    const outPath = path.resolve(parsed.dir, parsed.name + '.swbn');
    
    // 1. Handle Signing Key
    const keyPath = path.resolve(process.cwd(), 'iwa-key.pem');
    if (!fs.existsSync(keyPath)) {
        console.log("🎲 Generating new IWA signing key...");
        const keyPair = crypto.generateKeyPairSync('ed25519');
        fs.writeFileSync(keyPath, keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    }

    // 2. Prepare temp directory for IWA content
    const tempDir = path.resolve(process.cwd(), '.tmp_iwa_' + parsed.name);
    if (fs.existsSync(tempDir)) fs.removeSync(tempDir);
    fs.ensureDirSync(tempDir);

    // Copy files
    fs.copyFileSync(htmlPath, path.join(tempDir, 'index.html'));
    
    const manifestPath = path.resolve(__dirname, 'iwa-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.name = `Tobari: ${parsed.name}`;
    fs.writeFileSync(path.join(tempDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
    
    const iconPath = path.resolve(__dirname, 'iwa-icon.svg');
    fs.copyFileSync(iconPath, path.join(tempDir, 'icon.svg'));

    // 3. Packaging into WBN
    // Note: We use a placeholder origin first, wbn-sign will overwrite the ID anyway
    const tmpWbn = path.resolve(process.cwd(), `.tmp_${parsed.name}.wbn`);
    try {
        // Packaging
        execSync(`npx wbn --dir ${tempDir} --baseURL isolated-app://tobari-iwa/ --output ${tmpWbn}`, { stdio: 'ignore' });
        
        // 4. Signing
        // wbn-sign prints the ID to stdout. We capture it.
        console.log(`🔏 Signing Web Bundle into ${parsed.name}.swbn...`);
        const output = execSync(`npx wbn-sign --input ${tmpWbn} --private-key ${keyPath} --output ${outPath}`, { encoding: 'utf-8' });
        const id = output.trim();
        
        console.log(`🆔 Isolated Web App ID: ${id}`);
        console.log(`🔗 Origin: isolated-app://${id}/`);
        console.log(`✅ Successfully generated Signed Web Bundle: ${outPath}`);
    } catch (e) {
        console.error("❌ Failed to bundle/sign:", e);
    } finally {
        // Clean up
        if (fs.existsSync(tempDir)) fs.removeSync(tempDir);
        if (fs.existsSync(tmpWbn)) fs.removeSync(tmpWbn);
    }
}

createSignedWebBundle().catch(console.error);
