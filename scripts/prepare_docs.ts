import fs from 'fs';
import path from 'path';

console.log("📝 Preparing documentation...");

// 1. Copy civ docs
const civDestDir = path.resolve('docs/civ');
fs.mkdirSync(civDestDir, { recursive: true });
const civDocsDir = path.resolve('packages/civ/docs');

if (fs.existsSync(civDocsDir)) {
    const civDocs = fs.readdirSync(civDocsDir).filter(f => f.endsWith('.md'));
    for (const doc of civDocs) {
        fs.copyFileSync(path.join(civDocsDir, doc), path.join(civDestDir, doc));
    }
    console.log(`✅ Copied ${civDocs.length} files from packages/civ/docs to docs/civ`);
} else {
    console.warn(`⚠️  Warning: ${civDocsDir} does not exist.`);
}

// 2. Copy README to getting-started.md and fix links
const readmePath = path.resolve('README.md');
if (fs.existsSync(readmePath)) {
    let readme = fs.readFileSync(readmePath, 'utf-8');

    // Fix links: "(docs/foo.md)" -> "(foo.md)" because getting-started.md is inside docs/
    // Example: [Architecture](docs/ARCHITECTURE.md) -> [Architecture](ARCHITECTURE.md)
    readme = readme.replace(/\(docs\//g, '(');

    // Also fix any image paths if they exist (assuming assets are in docs/public or similar)
    // For now, just fixing relative markdown links is sufficient for the current README.

    fs.writeFileSync(path.resolve('docs/getting-started.md'), readme);
    console.log("✅ Copied README.md to docs/getting-started.md (with link adjustments)");
} else {
    console.warn("⚠️  Warning: README.md not found.");
}
