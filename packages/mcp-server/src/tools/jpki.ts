import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import { DEFAULT_MYNA_PATH, DEFAULT_SIGNER_MACOS_PATH } from "../utils.js";
import {
    SignWithJPKISchema,
    ReadMyNumberSchema,
    ReadBasicInfoSchema,
    ReadPhotoSchema
} from "../schemas.js";

// Helper to run spawn and capture output
async function runCivCommand(exePath: string, args: string[]): Promise<string> {
    console.error(`Running: ${exePath} ${args.join(" ")}`);
    const proc = spawn(exePath, args);
    return new Promise<string>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data) => stdout += data.toString());
        proc.stderr.on("data", (data) => stderr += data.toString());
        proc.on("close", (code) => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(`Process exited with code ${code}: ${stderr || stdout}`));
        });
        proc.on("error", (err) => reject(err));
    });
}

function getNativeSignerPath(): string | undefined {
    const projectRoot = PROJECT_ROOT;
    const possiblePaths = [
        DEFAULT_SIGNER_MACOS_PATH,
        path.join(projectRoot, "packages/signer/src-tauri/target/release/tobari-signer"),
        path.join(projectRoot, "packages/signer/src-tauri/target/release/tobari-signer.exe"),
        path.join(projectRoot, "packages/signer/src-tauri/target/debug/tobari-signer"),
        path.join(projectRoot, "packages/signer/src-tauri/target/debug/tobari-signer.exe")
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) return p;
    }
    return process.env.TOBARI_SIGNER_PATH;
}

function resolveMynaPath(p: string): string {
    return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

function toBase64Url(buffer: Buffer): string {
    return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

export async function handleSignWithJpki(toolArgs: any) {
    try {
        const args = SignWithJPKISchema.parse(toolArgs);
        const nativeSigner = getNativeSignerPath();
        
        // Use native signer (Tauri or macOS) if available and no explicit mynaPath
        if (nativeSigner && !args.mynaPath) {
             const dataBuffer = Buffer.from(args.data, 'base64');
             const challenge = toBase64Url(dataBuffer);
             const isMacNative = nativeSigner === DEFAULT_SIGNER_MACOS_PATH;
             
             const requestJson = JSON.stringify({
                 challenge: challenge,
                 rp_id: "mcp-server-jpki",
                 pin: args.pin // JPKI pin is needed for both
             });
             
             const cmdArgs = ["--sign-jpki", "--pin", args.pin, "--request", requestJson];
             const output = await runCivCommand(nativeSigner, cmdArgs);
             const result = JSON.parse(output); 
             
             // SignResponse format: { signature: "base64url", ... }
             let sigB64 = result.signature
                 .replace(/-/g, '+')
                 .replace(/_/g, '/');
             while (sigB64.length % 4 !== 0) sigB64 += '=';
             
             return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            signature: sigB64,
                            format: args.format || "der",
                            digest: args.digest || "sha256",
                            detached: args.detached !== false,
                            publicKey: result.publicKey
                        }, null, 2),
                    },
                ],
            };
        }

        const civPath = resolveMynaPath(args.mynaPath || DEFAULT_MYNA_PATH);
        const dataBuffer = Buffer.from(args.data, 'base64');
        const tmpDir = os.tmpdir();
        const inputFile = path.join(tmpDir, `civ-input-${Date.now()}.bin`);
        const outputFile = path.join(tmpDir, `civ-output-${Date.now()}.sig`);

        try {
            await fs.writeFile(inputFile, dataBuffer);

            const cmdArgs = ["jpki", "sign", "--input", inputFile, "--output", outputFile, "--type", "sign", "--pin", args.pin];
            if (args.demo) cmdArgs.unshift("--demo");

            await runCivCommand(civPath, cmdArgs);

            const signatureBuffer = await fs.readFile(outputFile);
            const signatureBase64 = signatureBuffer.toString('base64');

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            signature: signatureBase64,
                            format: args.format || "der", // We claim it's DER but might be raw
                            digest: args.digest || "sha256",
                            detached: args.detached !== false
                        }, null, 2),
                    },
                ],
            };
        } finally {
            try { await fs.unlink(inputFile); } catch { }
            try { await fs.unlink(outputFile); } catch { }
        }
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error signing with JPKI: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleReadMyNumber(toolArgs: any) {
    try {
        const args = ReadMyNumberSchema.parse(toolArgs);
        const nativeSigner = getNativeSignerPath();
        
        if (nativeSigner && !args.mynaPath) {
             const cmdArgs = ["--read-mynumber", "--pin", args.pin];
             const output = await runCivCommand(nativeSigner, cmdArgs);
             const result = JSON.parse(output); 
             
             return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ mynumber: result.myNumber || result.my_number }, null, 2),
                    },
                ],
            };
        }

        const civPath = resolveMynaPath(args.mynaPath || DEFAULT_MYNA_PATH);
        const cmdArgs = ["jpki", "num", "--pin", args.pin, "--json"];
        if (args.demo) cmdArgs.unshift("--demo");

        const jsonOutput = await runCivCommand(civPath, cmdArgs);
        const parsed = JSON.parse(jsonOutput);

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ mynumber: parsed.mynumber }, null, 2),
                },
            ],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error reading My Number: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleReadBasicInfo(toolArgs: any) {
    try {
        const args = ReadBasicInfoSchema.parse(toolArgs);
        const nativeSigner = getNativeSignerPath();
        
        if (nativeSigner && !args.mynaPath) {
             const cmdArgs = ["--read-attributes", "--pin", args.pin];
             const output = await runCivCommand(nativeSigner, cmdArgs);
             const result = JSON.parse(output);
             
             // Normalize to match Civ output (snake_case)
             const normalized = {
                 name: result.name,
                 address: result.address,
                 birth_date: result.birthDate || result.birth_date,
                 gender: result.gender
             };
             
             return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(normalized, null, 2),
                    },
                ],
            };
        }

        const civPath = resolveMynaPath(args.mynaPath || DEFAULT_MYNA_PATH);
        const cmdArgs = ["jpki", "attr", "--pin", args.pin, "--json"];
        if (args.demo) cmdArgs.unshift("--demo");

        const jsonOutput = await runCivCommand(civPath, cmdArgs);
        const info = JSON.parse(jsonOutput);

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(info, null, 2),
                },
            ],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error reading basic info: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleReadPhoto(toolArgs: any) {
    try {
        const args = ReadPhotoSchema.parse(toolArgs);
        const nativeSigner = getNativeSignerPath();
        
        if (nativeSigner && !args.mynaPath) {
             const cmdArgs = ["--read-face-photo", "--pin", args.pin];
             const output = await runCivCommand(nativeSigner, cmdArgs);
             const result = JSON.parse(output); 
             
             return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ photo: result.photo || result.face_photo, format: "jpeg2000" }, null, 2),
                    },
                ],
            };
        }

        const civPath = resolveMynaPath(args.mynaPath || DEFAULT_MYNA_PATH);
        const cmdArgs = ["jpki", "attr", "--pin", args.pin, "--json"];
        if (args.demo) cmdArgs.unshift("--demo");

        const jsonOutput = await runCivCommand(civPath, cmdArgs);
        const info = JSON.parse(jsonOutput);

        // Extract photo from JSON
        const photoBase64 = info.face_photo;
        if (!photoBase64) {
            throw new Error("Photo not found in response (check PIN or card status)");
        }

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ photo: photoBase64, format: "jpeg2000" }, null, 2),
                },
            ],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error reading photo: ${error.message}` }],
            isError: true,
        };
    }
}
