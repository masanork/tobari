import { readdir } from 'fs/promises';
import { join } from 'path';

const EXAMPLES_DIR = 'examples';
const BUNDLE_VIEWER_SCRIPT = 'packages/codec/src/bundle-viewer.ts';
const BUNDLE_WBN_SCRIPT = 'packages/codec/src/bundle-webbundle.ts';

async function main() {
    console.log("🏗️  Building all examples...");

    const entries = await readdir(EXAMPLES_DIR, { withFileTypes: true });
    const exampleDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    let successCount = 0;
    let failCount = 0;

    for (const dirName of exampleDirs) {
        const dirPath = join(EXAMPLES_DIR, dirName);
        console.log(`\n👉 Processing usage example: ${dirName}`);

        // 1. Find generation script (gen-*.ts)
        const files = await readdir(dirPath);
        const genScript = files.find(f => f.startsWith('gen-') && f.endsWith('.ts'));

        if (!genScript) {
            console.log(`   ⚠️  No generation script (gen-*.ts) found in ${dirName}, skipping.`);
            continue;
        }

        const genScriptPath = join(dirPath, genScript);
        console.log(`   Running generator: ${genScriptPath}`);

        const genProc = Bun.spawn(["bun", "run", genScriptPath], {
            stdout: "inherit",
            stderr: "inherit"
        });
        const genExit = await genProc.exited;

        if (genExit !== 0) {
            console.error(`   ❌ Generator failed for ${dirName}`);
            failCount++;
            continue;
        }

        // 2. Find generated COSE file
        const filesAfter = await readdir(dirPath);
        const coseFiles = filesAfter.filter(f => f.endsWith('.cose'));

        let targetCose = coseFiles.find(f => f === `${dirName}.cose`);
        if (!targetCose && coseFiles.length > 0) {
            targetCose = coseFiles[0];
        }

        if (!targetCose) {
            console.error(`   ❌ No .cose file generated in ${dirName}`);
            failCount++;
            continue;
        }

        const cosePath = join(dirPath, targetCose);

        // 3. Run Viewer Bundler
        console.log(`   Bundling viewer for: ${cosePath}`);
        const bundleProc = Bun.spawn(["bun", "run", BUNDLE_VIEWER_SCRIPT, cosePath], {
            stdout: "inherit",
            stderr: "inherit"
        });
        const bundleExit = await bundleProc.exited;

        if (bundleExit !== 0) {
            console.error(`   ❌ Viewer bundling failed for ${dirName}`);
            failCount++;
            continue;
        }

        // 4. Generate Web Bundle (.wbn)
        const htmlPath = cosePath.replace('.cose', '.html');
        console.log(`   Packaging Web Bundle for: ${htmlPath}`);
        const wbnProc = Bun.spawn(["bun", "run", BUNDLE_WBN_SCRIPT, htmlPath], {
            stdout: "inherit",
            stderr: "inherit"
        });
        const wbnExit = await wbnProc.exited;

        if (wbnExit !== 0) {
            console.error(`   ❌ Web Bundle packaging failed for ${dirName}`);
            failCount++;
        } else {
            console.log(`   ✅ Success: ${dirName}`);
            successCount++;
        }
    }

    console.log(`\n🎉 Build complete: ${successCount} successful, ${failCount} failed.`);
    if (failCount > 0) process.exit(1);
}

main();