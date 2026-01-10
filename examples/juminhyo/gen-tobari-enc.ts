import { spawnSync } from 'child_process';
import path from 'path';

console.log("Generating ENCRYPTED Resident Record (Juminhyo)...");

const scriptPath = path.resolve(__dirname, 'gen-tobari.ts');
const result = spawnSync('bun', [scriptPath, '--encrypt'], { stdio: 'inherit' });

if (result.status === 0) {
    console.log("\nDone! Now run 'bun run build' to update the HTML viewer.");
    console.log("When you open the HTML, it will ask for a Passkey (or 'tobari' password).");
} else {
    process.exit(result.status || 1);
}

