import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";

/**
 * Test for マイナンバーカード reading functionality
 *
 * Usage:
 *   bun test/mynumber-card-test.ts <4-digit-pin> [test]
 *
 * Available tests:
 *   mynumber - Read My Number (個人番号)
 *   basic    - Read basic info (氏名、生年月日、性別、住所)
 *   photo    - Read photo
 *   all      - Run all tests (default)
 *
 * Requirements:
 *   - マイナンバーカード and card reader
 *   - myna binary at ~/go/bin/myna
 *   - Valid 4-digit PIN for券面事項入力補助用
 */

async function readMyNumber(pin: string, mynaPath?: string): Promise<string> {
    const resolvedMynaPath = mynaPath?.startsWith("~")
        ? path.join(os.homedir(), mynaPath.slice(1))
        : mynaPath || path.join(os.homedir(), "go/bin/myna");

    const cmdArgs = ["text", "mynumber", "-p", pin];
    const mynaProcess = spawn(resolvedMynaPath, cmdArgs);

    return new Promise<string>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        mynaProcess.stdout.on("data", (data) => stdout += data.toString());
        mynaProcess.stderr.on("data", (data) => stderr += data.toString());
        mynaProcess.on("close", (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                reject(new Error(`myna exited with code ${code}: ${stderr || stdout}`));
            }
        });
        mynaProcess.on("error", (err) => reject(err));
    });
}

async function readBasicInfo(pin: string, mynaPath?: string): Promise<any> {
    const resolvedMynaPath = mynaPath?.startsWith("~")
        ? path.join(os.homedir(), mynaPath.slice(1))
        : mynaPath || path.join(os.homedir(), "go/bin/myna");

    const cmdArgs = ["text", "attr", "-p", pin, "-f", "json"];
    const mynaProcess = spawn(resolvedMynaPath, cmdArgs);

    return new Promise<any>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        mynaProcess.stdout.on("data", (data) => stdout += data.toString());
        mynaProcess.stderr.on("data", (data) => stderr += data.toString());
        mynaProcess.on("close", (code) => {
            if (code === 0) {
                try {
                    const parsed = JSON.parse(stdout.trim());
                    resolve(parsed);
                } catch (e) {
                    reject(new Error(`Failed to parse JSON: ${e}`));
                }
            } else {
                reject(new Error(`myna exited with code ${code}: ${stderr || stdout}`));
            }
        });
        mynaProcess.on("error", (err) => reject(err));
    });
}

async function readPhoto(pin: string, mynaPath?: string): Promise<string> {
    const resolvedMynaPath = mynaPath?.startsWith("~")
        ? path.join(os.homedir(), mynaPath.slice(1))
        : mynaPath || path.join(os.homedir(), "go/bin/myna");

    const tmpDir = os.tmpdir();
    const outputFile = path.join(tmpDir, `mynumber-photo-${Date.now()}.jp2`);

    try {
        const cmdArgs = ["visual", "photo", "-p", pin, "-o", outputFile];
        const mynaProcess = spawn(resolvedMynaPath, cmdArgs);

        await new Promise<void>((resolve, reject) => {
            let stdout = "";
            let stderr = "";
            mynaProcess.stdout.on("data", (data) => stdout += data.toString());
            mynaProcess.stderr.on("data", (data) => stderr += data.toString());
            mynaProcess.on("close", (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`myna exited with code ${code}: ${stderr || stdout}`));
                }
            });
            mynaProcess.on("error", (err) => reject(err));
        });

        const photoBuffer = await fs.readFile(outputFile);
        return photoBuffer.toString('base64');
    } finally {
        try {
            await fs.unlink(outputFile);
        } catch {}
    }
}

async function main() {
    console.log('Testing マイナンバーカード Reading...\n');

    const pin = process.argv[2];
    const testType = process.argv[3] || "all";

    if (!pin) {
        console.error('Error: 4-digit PIN is required');
        console.error('Usage: bun test/mynumber-card-test.ts <4-digit-pin> [test]');
        console.error('Tests: mynumber, basic, photo, all');
        process.exit(1);
    }

    if (pin.length !== 4 || !/^\d+$/.test(pin)) {
        console.error('Error: PIN must be exactly 4 digits');
        process.exit(1);
    }

    const runMyNumber = testType === "all" || testType === "mynumber";
    const runBasic = testType === "all" || testType === "basic";
    const runPhoto = testType === "all" || testType === "photo";

    // Test 1: Read My Number
    if (runMyNumber) {
        console.log('Test 1: Reading My Number (個人番号)...');
        try {
            const mynumber = await readMyNumber(pin);
            console.log('✓ My Number retrieved successfully');
            console.log(`  My Number: ${mynumber}`);
            console.log('');
        } catch (error: any) {
            console.error('✗ Test 1 failed:', error.message);
            process.exit(1);
        }
    }

    // Test 2: Read Basic Info
    if (runBasic) {
        console.log('Test 2: Reading Basic Personal Information (基本4情報)...');
        try {
            const basicInfo = await readBasicInfo(pin);
            console.log('✓ Basic information retrieved successfully');
            console.log(`  Name (氏名): ${basicInfo.name || basicInfo.氏名 || 'N/A'}`);
            console.log(`  Birth Date (生年月日): ${basicInfo.birth || basicInfo.生年月日 || 'N/A'}`);
            console.log(`  Gender (性別): ${basicInfo.sex || basicInfo.性別 || 'N/A'}`);
            console.log(`  Address (住所): ${basicInfo.address || basicInfo.住所 || 'N/A'}`);
            console.log('\n  Full JSON:');
            console.log(JSON.stringify(basicInfo, null, 2));
            console.log('');
        } catch (error: any) {
            console.error('✗ Test 2 failed:', error.message);
            process.exit(1);
        }
    }

    // Test 3: Read Photo
    if (runPhoto) {
        console.log('Test 3: Reading Photo (顔写真)...');
        try {
            const photoBase64 = await readPhoto(pin);
            console.log('✓ Photo retrieved successfully');
            console.log(`  Format: JPEG2000`);
            console.log(`  Size: ${photoBase64.length} characters (base64)`);
            console.log(`  First 50 chars: ${photoBase64.substring(0, 50)}...`);
            console.log('');
        } catch (error: any) {
            console.error('✗ Test 3 failed:', error.message);
            process.exit(1);
        }
    }

    console.log('All tests passed! ✓');
}

main();
