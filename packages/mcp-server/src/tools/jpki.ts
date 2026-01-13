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
export async function runCivCommand(exePath: string, args: string[]): Promise<string> {
    if (process.env.TOBARI_DEBUG === "1") {
        console.error(`Running: ${exePath} ${args.join(" ")}`);
    }
    const proc = spawn(exePath, args);
    return new Promise<string>((resolve, reject) => {
        let stdout = "";
        let stderrData = "";
        proc.stdout.on("data", (data) => stdout += data.toString());
        proc.stderr.on("data", (data) => {
            const str = data.toString();
            stderrData += str;
            if (process.env.TOBARI_DEBUG === "1") {
                process.stderr.write(str);
            }
        });
        proc.on("close", (code) => {
            if (code === 0) {
                const combined = stdout.trim();
                try {
                    // Try to parse as Unified Response
                    const response = JSON.parse(combined);
                    if (response.status === "error") {
                        const err = response.error;
                        if (err.type === "IncorrectPin") {
                            reject(new Error(`Incorrect PIN. ${err.details?.retries ?? "?"} retries remaining.`));
                            return;
                        }
                        if (err.type === "PinLocked") {
                            reject(new Error(`The PIN is locked.`));
                            return;
                        }
                        reject(new Error(`${err.type}: ${err.message}`));
                        return;
                    }
                    // If it's a success response, we can just return the raw string or the result part
                    // For compatibility with existing callers, return the raw string if not a unified success
                    resolve(combined);
                } catch (e) {
                    resolve(combined);
                }
            }
            else {
                const combined = (stderrData + stdout).trim();
                reject(new Error(combined || `Signer failed with code ${code}`));
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

        const request = {
            command: "read_card",
            params: {
                cardType: "passport",
                mrz: args.mrz,
                can: args.can,
                usePace: args.usePace
            }
        };

        const output = await runCivCommand(nativeSigner, ["--request", JSON.stringify(request)]);
        const response = JSON.parse(output);
        const result = response.result.data;

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
                    description: "Passport data read successfully."
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

        const request = {
            command: "read_card",
            params: {
                cardType: "drivers_license",
                pin1: args.pin1,
                pin2: args.pin2
            }
        };

        const output = await runCivCommand(nativeSigner, ["--request", JSON.stringify(request)]);
        const response = JSON.parse(output);
        const result = response.result.data;

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

        const request = {
            command: "read_card",
            params: { cardType: "residence_card" }
        };
        const output = await runCivCommand(nativeSigner, ["--request", JSON.stringify(request)]);
        const response = JSON.parse(output);
        const result = response.result.data;

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
        
        if (nativeSigner) {
             const request = {
                 command: "read_card",
                 params: { cardType: "jpki", pin: args.pin, includeMyNumber: true }
             };
             const output = await runCivCommand(nativeSigner, ["--request", JSON.stringify(request)]);
             const response = JSON.parse(output);
             const result = response.result.data;
             return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ mynumber: result.myNumber || result.my_number }, null, 2),
                }],
            };
        }
        throw new Error("Native signer not found. Please build packages/signer or packages/signer-macos.");
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error reading My Number: ${error.message}` }], isError: true };
    }
}

export async function handleReadBasicInfo(toolArgs: any) {
    try {
        const args = ReadBasicInfoSchema.parse(toolArgs);
        const nativeSigner = getNativeSignerPath();
        
        if (nativeSigner) {
             const request = {
                 command: "read_card",
                 params: { cardType: "jpki", pin: args.pin }
             };
             const output = await runCivCommand(nativeSigner, ["--request", JSON.stringify(request)]);
             const response = JSON.parse(output);
             const result = response.result.data;
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
        throw new Error("Native signer not found.");
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error reading basic info: ${error.message}` }], isError: true };
    }
}

export async function handleReadPhoto(toolArgs: any) {
    try {
        const args = ReadPhotoSchema.parse(toolArgs);
        const nativeSigner = getNativeSignerPath();
        
        if (nativeSigner) {
             const request = {
                 command: "read_card",
                 params: { cardType: "jpki", pin: args.pin, includeFacePhoto: true }
             };
             const output = await runCivCommand(nativeSigner, ["--request", JSON.stringify(request)]);
             const response = JSON.parse(output);
             const result = response.result.data;
             return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ photo: result.photo || result.face_photo, format: "jpeg2000" }, null, 2),
                }],
            };
        }
        throw new Error("Native signer not found.");
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error reading photo: ${error.message}` }], isError: true };
    }
}
import { McpTool } from "../mcp-tool.js";

export const jpkiTools: McpTool<any>[] = [
    { name: "sign_with_jpki", description: "Signs data using JPKI via myna CLI.", schema: SignWithJPKISchema, handler: handleSignWithJpki },
    { name: "read_mynumber", description: "Reads My Number from My Number Card.", schema: ReadMyNumberSchema, handler: handleReadMyNumber },
    { name: "read_basic_info", description: "Reads basic info from My Number Card.", schema: ReadBasicInfoSchema, handler: handleReadBasicInfo },
    { name: "read_photo", description: "Reads photo from My Number Card.", schema: ReadPhotoSchema, handler: handleReadPhoto },
    { name: "read_passport", description: "Reads info from ePassport.", schema: ReadPassportSchema, handler: handleReadPassport },
    { name: "read_driver_license", description: "Reads info from Driver's License.", schema: ReadDriverLicenseSchema, handler: handleReadDriverLicense },
    { name: "read_residence_card", description: "Reads info from Residence Card.", schema: ReadResidenceCardSchema, handler: handleReadResidenceCard }
];

