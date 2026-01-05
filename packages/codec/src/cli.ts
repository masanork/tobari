import { yamlToCddl } from './cddl-gen';
import fs from 'fs';
import path from 'path';

const yamlPath = process.argv[2];
if (!yamlPath) {
    console.error("Usage: bun run gen-cddl.ts <path-to-yaml>");
    process.exit(1);
}

const yamlContent = fs.readFileSync(path.resolve(yamlPath), 'utf-8');
const cddl = yamlToCddl(yamlContent);

console.log(cddl);
