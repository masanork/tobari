import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const CERTS_DIR = "shared/certs";
const CSCA_DIR = path.join(CERTS_DIR, "csca");
const JPKI_DIR = path.join(CERTS_DIR, "jpki");

const GERMAN_ML_URL = "https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/ElekAusweise/CSCA/GermanMasterList.zip?__blob=publicationFile&v=102";

const JPKI_CERTS = [
    "https://www.jpki.go.jp/ca/pdf/signca01.cer",
    "https://www.jpki.go.jp/ca/pdf/signca02.cer",
    "https://www.jpki.go.jp/ca/pdf/signca03.cer",
    "https://www.jpki.go.jp/ca/pdf/authca01.cer",
    "https://www.jpki.go.jp/ca/pdf/authca02.cer",
    "https://www.jpki.go.jp/ca/pdf/authca03.cer"
];

async function downloadFile(url: string, dest: string) {
    console.log(`Downloading ${url}...`);
    execSync(`curl -L "${url}" -o "${dest}"`);
}

function extractCertsFromMasterList(mlPath: string, outputDir: string) {
    console.log(`Extracting certificates from ${mlPath}...`);
    const tmpEContent = path.join(CERTS_DIR, "econtent.bin");
    
    // Use openssl to extract eContent from CMS
    try {
        execSync(`openssl cms -verify -noverify -inform DER -in "${mlPath}" -out "${tmpEContent}"`, { stdio: 'ignore' });
    } catch (e) {
        console.error("Failed to extract eContent using openssl cms. Ensure openssl is installed.");
        return;
    }

    const buffer = fs.readFileSync(tmpEContent);
    let offset = 13; // Skip SEQUENCE, INTEGER 0, SET header
    let count = 0;

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    while (offset < buffer.length) {
        if (buffer[offset] !== 0x30) break;

        let length = 0;
        let hl = 0;
        if (buffer[offset + 1] < 0x80) {
            length = buffer[offset + 1];
            hl = 2;
        } else {
            const numBytes = buffer[offset + 1] & 0x7F;
            hl = 2 + numBytes;
            for (let i = 0; i < numBytes; i++) {
                length = (length << 8) | buffer[offset + 2 + i];
            }
        }

        const certBytes = buffer.slice(offset, offset + hl + length);
        const fileName = `csca_${count.toString().padStart(4, '0')}.der`;
        fs.writeFileSync(path.join(outputDir, fileName), certBytes);
        
        offset += hl + length;
        count++;
    }
    fs.unlinkSync(tmpEContent);
    console.log(`Extracted ${count} certificates to ${outputDir}`);
}

async function main() {
    if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true });
    if (!fs.existsSync(JPKI_DIR)) fs.mkdirSync(JPKI_DIR, { recursive: true });

    // 1. German Master List
    const zipPath = path.join(CERTS_DIR, "GermanMasterList.zip");
    await downloadFile(GERMAN_ML_URL, zipPath);
    
    const extractDir = path.join(CERTS_DIR, "extracted");
    if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir);
    execSync(`unzip -o "${zipPath}" -d "${extractDir}"`);
    
    const mlFile = fs.readdirSync(extractDir).find(f => f.endsWith(".ml"));
    if (mlFile) {
        extractCertsFromMasterList(path.join(extractDir, mlFile), CSCA_DIR);
    }

    // 2. JPKI Certificates
    for (const url of JPKI_CERTS) {
        const name = path.basename(url);
        await downloadFile(url, path.join(JPKI_DIR, name));
    }

    console.log("\nSetup complete. Certificates are located in shared/certs/");
    console.log("Note: This directory is ignored by git.");
}

main().catch(console.error);
