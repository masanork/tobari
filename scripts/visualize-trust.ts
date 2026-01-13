import { X509Certificate } from "crypto";
import * as fs from "fs";
import * as path from "path";

const CERTS_DIR = "shared/certs";

function scanDirectory(dir: string, fileList: string[] = []): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            scanDirectory(fullPath, fileList);
        } else if (entry.name.endsWith(".der") || entry.name.endsWith(".cer")) {
            fileList.push(fullPath);
        }
    }
    return fileList;
}

function shorten(dn: string): string {
    // Extract CN or O for cleaner labels
    const cnMatch = dn.match(/CN=([^,]+)/);
    if (cnMatch) return cnMatch[1];
    const oMatch = dn.match(/O=([^,]+)/);
    if (oMatch) return oMatch[1];
    return dn.substring(0, 20) + "...";
}

async function main() {
    const files = scanDirectory(CERTS_DIR);
    const certs: X509Certificate[] = [];

    for (const file of files) {
        try {
            certs.push(new X509Certificate(fs.readFileSync(file)));
        } catch { }
    }

    const showAll = process.argv.includes("--all");

    console.log("```mermaid");
    console.log("graph TD");
    console.log("  %% Trust Relationships Visualized from parsed certificates");
    if (!showAll) {
        console.log("  %% Defaulting to Japan domestic certs only. Use --all to see global.");
    }

    const seenEdges = new Set<string>();

    for (const cert of certs) {
        // Default filter: Japan only (C=JP)
        if (!showAll && !cert.subject.includes("C=JP")) {
            continue;
        }

        const sub = shorten(cert.subject);
        const iss = shorten(cert.issuer);

        if (cert.subject === cert.issuer) {
            // Root CA
            console.log(`  ${iss}:::root`);
        } else {
            // Relationship
            const edge = `  ${iss} --> ${sub}`;
            if (!seenEdges.has(edge)) {
                console.log(edge);
                seenEdges.add(edge);
            }
        }
    }

    console.log("  classDef root fill:#f9f,stroke:#333,stroke-width:2px;");
    console.log("```");
}

main().catch(console.error);
