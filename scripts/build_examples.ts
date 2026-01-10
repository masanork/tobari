import { readdir } from 'fs/promises';
import { join } from 'path';
import fs from 'fs';

const EXAMPLES_DIR = 'examples';
const BUNDLE_VIEWER_SCRIPT = 'packages/codec/src/bundle-viewer.ts';
const BUNDLE_WBN_SCRIPT = 'packages/codec/src/bundle-webbundle.ts';

async function main() {
    console.log("🏗️  Building all examples...");

    const entries = await readdir(EXAMPLES_DIR, { withFileTypes: true });
    const exampleDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    for (const dirName of exampleDirs) {
        const dirPath = join(EXAMPLES_DIR, dirName);
        const files = await readdir(dirPath);
        const genScript = files.find(f => f.startsWith('gen-') && f.endsWith('.ts'));

        if (!genScript) continue;

        const genScriptPath = join(dirPath, genScript);
        
        // 1. Build Demo Version
        await runCommand("bun", ["run", genScriptPath, "--encrypt"]);
        
        // 2. Build Locked Version if pubkey exists
        const hasRecipientKey = files.includes('recipient-pubkey.json');
        if (hasRecipientKey) {
            console.log(`   🔒 Recipient key found for ${dirName}. Generating locked version...`);
            await runCommand("bun", ["run", genScriptPath, "--locked"]);
        }

        // 3. Post-process (HTML and WBN) for all generated .cose files
        const filesAfter = await readdir(dirPath);
        const coseFiles = filesAfter.filter(f => f.endsWith('.cose'));

        for (const cose of coseFiles) {
            const cosePath = join(dirPath, cose);
            const htmlPath = cosePath.replace('.cose', '.html');
            
            await runCommand("bun", ["run", BUNDLE_VIEWER_SCRIPT, cosePath, htmlPath]);
            await runCommand("bun", ["run", BUNDLE_WBN_SCRIPT, htmlPath]);
        }
    }
}

async function runCommand(cmd: string, args: string[]) {
    const proc = Bun.spawn([cmd, ...args], { stdout: "inherit", stderr: "inherit" });
    return await proc.exited;
}

main().catch(console.error);
