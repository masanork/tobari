import { createHash } from 'crypto';
import * as fs from 'fs';

// Dummy MRZ (TD3)
// Line 1: P<JPNGAIMU<<TARO<<<<<<<<<<<<<<<<<<<<<<<<<<<<
// Line 2: TZ00000004JPN8001014M2701010<<<<<<<<<<<<<<00
const MRZ_LINE1 = "P<JPNGAIMU<<TARO<<<<<<<<<<<<<<<<<<<<<<<<<<<<";
const MRZ_LINE2 = "TZ00000004JPN8001014M2701010<<<<<<<<<<<<<<00";
const MRZ = MRZ_LINE1 + MRZ_LINE2;

function bufferToBitArray(buf: Buffer): number[] {
    const bits: number[] = [];
    for (let i = 0; i < buf.length; i++) {
        for (let j = 7; j >= 0; j--) {
            bits.push((buf[i] >> j) & 1);
        }
    }
    return bits;
}

function stringToBitArray(str: string): number[] {
    return bufferToBitArray(Buffer.from(str, 'ascii'));
}

async function main() {
    console.log("Generating ZKP Input for Passport...");
    console.log(`MRZ: ${MRZ}`);

    // 1. Calculate SHA-256 Hash
    const hash = createHash('sha256').update(MRZ).digest();
    const hashBits = bufferToBitArray(hash);

    // 2. Extract Birth Date (YYMMDD)
    // Line 2, char 14 (index 13 in line 2) -> "800101"
    const birthDate = MRZ_LINE2.substring(13, 19);
    const birthDateBits = stringToBitArray(birthDate);
    console.log(`Birth Date: ${birthDate}`);

    // 3. Extract Expiry Date (YYMMDD) - No longer used in ZKP explicitly but kept for ref
    // Line 2, char 22 (index 21 in line 2) -> "270101"
    const expiryDate = MRZ_LINE2.substring(21, 27);
    console.log(`Expiry Date: ${expiryDate}`);

    // 4. Create Input JSON
    // New Inputs: current_date [YYYY, MM, DD], age_threshold
    const today = new Date();
    const current_date = [
        today.getFullYear(),
        today.getMonth() + 1, // 0-indexed in JS
        today.getDate()
    ];
    const age_threshold = 18;

    // 5. Generate Secret for Nullifier
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);
    const secretBits = bufferToBitArray(Buffer.from(secret));

    const input = {
        mrz_bits: stringToBitArray(MRZ),
        mrz_hash: hashBits,
        // birth_date_bits removed
        // expiry_date_bits removed
        current_date: current_date,
        age_threshold: age_threshold,
        secret: secretBits
    };

    fs.writeFileSync('input.json', JSON.stringify(input, null, 2));
    console.log(`Saved to input.json (Threshold: ${age_threshold}, Current: ${current_date.join('/')})`);
}

main().catch(console.error);
