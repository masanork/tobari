import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";

/**
 * Test for JPKI signing functionality
 *
 * Usage:
 *   bun test/jpki-test.ts <pin>
 *
 * Requirements:
 *   - マイナンバーカード and card reader
 *   - myna binary at ~/go/bin/myna
 *   - Valid JPKI signature PIN (6-16 digits)
 */

async function signWithJPKI(data: string, pin: string, options?: {
    digest?: "sha1" | "sha256" | "sha512";
    detached?: boolean;
    format?: "pem" | "der";
    mynaPath?: string;
}): Promise<{ signature: string; format: string; digest: string; detached: boolean }> {
    const mynaPath = options?.mynaPath || "~/go/bin/myna";
    const resolvedMynaPath = mynaPath.startsWith("~")
        ? path.join(os.homedir(), mynaPath.slice(1))
        : mynaPath;

    const dataBuffer = Buffer.from(data, 'base64');

    const tmpDir = os.tmpdir();
    const inputFile = path.join(tmpDir, `jpki-input-${Date.now()}.bin`);
    const outputFile = path.join(tmpDir, `jpki-output-${Date.now()}.cms`);

    try {
        await fs.writeFile(inputFile, dataBuffer);

        const cmdArgs = [
            "jpki", "cms", "sign",
            "-i", inputFile,
            "-o", outputFile,
            "-p", pin,
            "-m", options?.digest || "sha256",
            "-f", options?.format || "der"
        ];

        if (options?.detached !== false) {
            cmdArgs.push("--detached");
        }

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

        const signatureBuffer = await fs.readFile(outputFile);
        const signatureBase64 = signatureBuffer.toString('base64');

        return {
            signature: signatureBase64,
            format: options?.format || "der",
            digest: options?.digest || "sha256",
            detached: options?.detached !== false
        };
    } finally {
        try {
            await fs.unlink(inputFile);
        } catch {}
        try {
            await fs.unlink(outputFile);
        } catch {}
    }
}

async function main() {
    console.log('Testing JPKI Signing...\n');

    const pin = process.argv[2];
    if (!pin) {
        console.error('Error: PIN is required');
        console.error('Usage: bun test/jpki-test.ts <pin>');
        process.exit(1);
    }

    // Test data
    const testData = "Hello, this is a test message for JPKI signing.";
    const testDataBase64 = Buffer.from(testData, 'utf-8').toString('base64');

    console.log(`Test data: ${testData}`);
    console.log(`Test data (base64): ${testDataBase64}`);
    console.log('');

    // Test 1: Default settings (SHA256, DER, detached)
    console.log('Test 1: Default settings (SHA256, DER, detached)');
    try {
        const result1 = await signWithJPKI(testDataBase64, pin);
        console.log('✓ Signature created successfully');
        console.log(`  Format: ${result1.format}`);
        console.log(`  Digest: ${result1.digest}`);
        console.log(`  Detached: ${result1.detached}`);
        console.log(`  Signature (first 50 chars): ${result1.signature.substring(0, 50)}...`);
        console.log('');
    } catch (error: any) {
        console.error('✗ Test 1 failed:', error.message);
        process.exit(1);
    }

    // Test 2: SHA512 with PEM format
    console.log('Test 2: SHA512 with PEM format');
    try {
        const result2 = await signWithJPKI(testDataBase64, pin, {
            digest: "sha512",
            format: "pem"
        });
        console.log('✓ Signature created successfully');
        console.log(`  Format: ${result2.format}`);
        console.log(`  Digest: ${result2.digest}`);
        console.log(`  Signature (first 100 chars):\n${Buffer.from(result2.signature, 'base64').toString('utf-8').substring(0, 100)}...`);
        console.log('');
    } catch (error: any) {
        console.error('✗ Test 2 failed:', error.message);
        process.exit(1);
    }

    // Test 3: Non-detached signature
    console.log('Test 3: Non-detached signature (includes data)');
    try {
        const result3 = await signWithJPKI(testDataBase64, pin, {
            detached: false
        });
        console.log('✓ Signature created successfully');
        console.log(`  Detached: ${result3.detached}`);
        console.log(`  Signature length: ${result3.signature.length} chars (includes original data)`);
        console.log('');
    } catch (error: any) {
        console.error('✗ Test 3 failed:', error.message);
        process.exit(1);
    }

    console.log('All tests passed! ✓');
}

main();
