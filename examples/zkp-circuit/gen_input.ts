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

    // 3. Extract Expiry Date (YYMMDD)
    // Line 2, char 22 (index 21 in line 2) -> "270101"
    const expiryDate = MRZ_LINE2.substring(21, 27);
    const expiryDateBits = stringToBitArray(expiryDate);
    console.log(`Expiry Date: ${expiryDate}`);

    // 4. Create Input JSON
    const input = {
        mrz_bits: stringToBitArray(MRZ),
        mrz_hash: hashBits,
        birth_date_bits: birthDateBits,
        expiry_date_bits: expiryDateBits
    };

    fs.writeFileSync('input.json', JSON.stringify(input, null, 2));
    console.log("Saved to input.json");
}

main().catch(console.error);
