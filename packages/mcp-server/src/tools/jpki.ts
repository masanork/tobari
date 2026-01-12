import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import { DEFAULT_MYNA_PATH, DEFAULT_SIGNER_MACOS_PATH, getNativeSignerPath } from "../utils.js";
import {
    SignWithJPKISchema,
    ReadMyNumberSchema,
    ReadBasicInfoSchema,
    ReadPhotoSchema,
    ReadPassportSchema,
    ReadDriverLicenseSchema,
    ReadResidenceCardSchema
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
            else {
                const combined = (stderr + stdout).trim();
                try {
                    const jsonMatch = combined.match(/\{.*"type".*details".*\}/s);
                    if (jsonMatch) {
                        const errObj = JSON.parse(jsonMatch[0]);
                        if (errObj.type === "IncorrectPin") {
                            reject(new Error(`Incorrect PIN. ${errObj.details.retries} retries remaining. Please warn the user carefully.`));
                            return;
                        }
                        if (errObj.type === "PinLocked") {
                            reject(new Error(`The PIN is locked. The user must visit their local municipal office to reset it.`));
                            return;
                        }
                    }
                } catch (e) { /* ignore parse error and use default */ }
                
                reject(new Error(`Signer failed (code ${code}): ${combined}`));
            }
        });
        proc.on("error", (err) => reject(err));
    });
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

export async function handleReadPassport(toolArgs: any) {
    try {
        const args = ReadPassportSchema.parse(toolArgs);
        const nativeSigner = getNativeSignerPath();
        if (!nativeSigner) throw new Error("Native signer not found.");

        const isMacNative = nativeSigner === DEFAULT_SIGNER_MACOS_PATH;
        let cmdArgs: string[] = [];

        if (isMacNative) {
            cmdArgs = ["--read-passport"];
            if (args.can) cmdArgs.push("--can", args.can);
            else if (args.mrz) cmdArgs.push("--mrz", args.mrz);
            if (args.usePace) cmdArgs.push("--use-pace");
        } else {
            const req = {
                mrz: args.mrz || "",
            };
            cmdArgs = ["--read-passport", "--request", JSON.stringify(req)];
        }

        const output = await runCivCommand(nativeSigner, cmdArgs);
        const result = JSON.parse(output);

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    dg1: result.dg1,
                    dg2: result.dg2,
                    sod: result.sod,
                    dg11: result.dg11,
                    dg12: result.dg12,
                    dg14: result.dg14,
                    dg15: result.dg15,
                    protocolUsed: result.protocolUsed,
                    format: "base64",
                    description: "Passport data read successfully. sod contains the Document Security Object (signature)."
                }, null, 2)
            }],
        };
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error reading passport: ${error.message}` }], isError: true };
    }
}

export async function handleReadDriverLicense(toolArgs: any) {
    try {
        const args = ReadDriverLicenseSchema.parse(toolArgs);
        const nativeSigner = getNativeSignerPath();
        if (!nativeSigner) throw new Error("Native signer not found.");

        const isMacNative = nativeSigner === DEFAULT_SIGNER_MACOS_PATH;
        let cmdArgs: string[] = [];

        if (isMacNative) {
            cmdArgs = ["--read-driver-license", "--pin1", args.pin1, "--pin2", args.pin2];
        } else {
            const req = { pin1: args.pin1, pin2: args.pin2 };
            cmdArgs = ["--read-driver-license", "--request", JSON.stringify(req)];
        }

        const output = await runCivCommand(nativeSigner, cmdArgs);
        const result = JSON.parse(output);

        const normalized = {
            ...result,
            raw_data_group1: result.rawDataGroup1 || result.raw_data_group1
        };

        return {
            content: [{ type: "text", text: JSON.stringify(normalized, null, 2) }],
        };
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error reading driver license: ${error.message}` }], isError: true };
    }
}

export async function handleReadResidenceCard(toolArgs: any) {
    try {
        const nativeSigner = getNativeSignerPath();
        if (!nativeSigner) throw new Error("Native signer not found.");

        const cmdArgs = ["--read-residence-card"];
        const output = await runCivCommand(nativeSigner, cmdArgs);
        const result = JSON.parse(output);

        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error reading residence card: ${error.message}` }], isError: true };
    }
}

export async function handleSignWithJpki(toolArgs: any) {
    try {
        const args = SignWithJPKISchema.parse(toolArgs);
        const nativeSigner = getNativeSignerPath();
        
        if (nativeSigner && !args.mynaPath) {
             const dataBuffer = Buffer.from(args.data, 'base64');
             const challenge = toBase64Url(dataBuffer);
             
             const requestJson = JSON.stringify({
                 challenge: challenge,
                 rp_id: "mcp-server-jpki",
                 pin: args.pin
             });
             
             const cmdArgs = ["--sign-jpki", "--pin", args.pin, "--request", requestJson, "--type", args.type || "auth"];
             const output = await runCivCommand(nativeSigner, cmdArgs);
             const result = JSON.parse(output); 
             
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
            const cmdArgs = ["jpki", "sign", "--input", inputFile, "--output", outputFile, "--type", args.type || "auth", "--pin", args.pin];
            if (args.demo) cmdArgs.unshift("--demo");
            await runCivCommand(civPath, cmdArgs);
            const signatureBuffer = await fs.readFile(outputFile);
            const signatureBase64 = signatureBuffer.toString('base64');
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        signature: signatureBase64,
                        format: args.format || "der",
                        digest: args.digest || "sha256",
                        detached: args.detached !== false
                    }, null, 2),
                }],
            };
        } finally {
            try { await fs.unlink(inputFile); } catch { }
            try { await fs.unlink(outputFile); } catch { }
        }
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error signing with JPKI: ${error.message}` }], isError: true };
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
                content: [{
                    type: "text",
                    text: JSON.stringify({ mynumber: result.myNumber || result.my_number }, null, 2),
                }],
            };
        }

        const civPath = resolveMynaPath(args.mynaPath || DEFAULT_MYNA_PATH);
        const cmdArgs = ["jpki", "num", "--pin", args.pin, "--json"];
        if (args.demo) cmdArgs.unshift("--demo");
        const jsonOutput = await runCivCommand(civPath, cmdArgs);
        const parsed = JSON.parse(jsonOutput);
        return {
            content: [{
                type: "text",
                text: JSON.stringify({ mynumber: parsed.mynumber }, null, 2),
            }],
        };
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error reading My Number: ${error.message}` }], isError: true };
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
             const normalized = {
                 name: result.name,
                 address: result.address,
                 birth_date: result.birthDate || result.birth_date,
                 gender: result.gender,
                 auth_cert: result.authCert || result.auth_cert,
                 sign_cert: result.signCert || result.sign_cert,
                 auth_ca_cert: result.authCACert || result.auth_ca_cert,
                 sign_ca_cert: result.signCACert || result.sign_ca_cert
             };
             return {
                content: [{
                    type: "text",
                    text: JSON.stringify(normalized, null, 2),
                }],
            };
        }

        const civPath = resolveMynaPath(args.mynaPath || DEFAULT_MYNA_PATH);
        const cmdArgs = ["jpki", "attr", "--pin", args.pin, "--json"];
        if (args.demo) cmdArgs.unshift("--demo");
        const jsonOutput = await runCivCommand(civPath, cmdArgs);
        const info = JSON.parse(jsonOutput);
        return {
            content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
        };
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error reading basic info: ${error.message}` }], isError: true };
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
                content: [{
                    type: "text",
                    text: JSON.stringify({ photo: result.photo || result.face_photo, format: "jpeg2000" }, null, 2),
                }],
            };
        }

        const civPath = resolveMynaPath(args.mynaPath || DEFAULT_MYNA_PATH);
        const cmdArgs = ["jpki", "attr", "--pin", args.pin, "--json"];
        if (args.demo) cmdArgs.unshift("--demo");
        const jsonOutput = await runCivCommand(civPath, cmdArgs);
        const info = JSON.parse(jsonOutput);
        const photoBase64 = info.face_photo;
        if (!photoBase64) throw new Error("Photo not found in response");
        return {
            content: [{
                type: "text",
                text: JSON.stringify({ photo: photoBase64, format: "jpeg2000" }, null, 2),
            }],
        };
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error reading photo: ${error.message}` }], isError: true };
    }
}