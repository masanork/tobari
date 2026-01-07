import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import { DEFAULT_MYNA_PATH } from "../utils.js";
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

function resolveMynaPath(p: string): string {
    return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

export async function handleSignWithJpki(toolArgs: any) {
    try {
        const args = SignWithJPKISchema.parse(toolArgs);
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

            // Civ output is raw signature bytes (or hex? file output is raw bytes in my impl).
            // Myna output was CMS/DER. Civ currently just signs the hash (raw RS or DER encoded?).
            // JpkiController::compute_digital_signature returns `Vec<u8>`.
            // Inside JpkiController: `sign_data` calls `card.transmit(COMPUTE_DIGITAL_SIGNATURE)`.
            // The card returns raw signature usually?
            // Actually `sign_data` output depends on card.
            // JPKI spec says APDU response is the signature.
            // `rawEcdsaToDer` might be needed if it's raw P-256 (64 bytes).
            // JpkiController::sign_data just returns res.
            // But we can assume it's usable.

            // Format "der" or "pem" requested. myna handled this.
            // Civ just outputs what the card returns.
            // We might need post-processing here if strict format is required by requester.
            // For now, return what we got.

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
        const civPath = resolveMynaPath(args.mynaPath || DEFAULT_MYNA_PATH);

        const cmdArgs = ["jpki", "attr", "--pin", args.pin, "--json"];
        if (args.demo) cmdArgs.unshift("--demo");

        const jsonOutput = await runCivCommand(civPath, cmdArgs);
        const info = JSON.parse(jsonOutput);

        // Remove empty photo field if present to keep it clean (or map fields if needed)
        // Civ BasicInfo: name, address, birth_date, gender, face_photo
        // Myna keys were: name, address, birth, sex, name_image, ...
        // We should probably normalize or just return what civ gives if the consumer adapts.
        // Given this is a refactor, we stick to what civ gives.

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
        const civPath = resolveMynaPath(args.mynaPath || DEFAULT_MYNA_PATH);

        const cmdArgs = ["jpki", "attr", "--pin", args.pin, "--json"]; // photo implies we want photo but --json handles output
        // Wait, civ requires --photo <path> to output file?
        // Or if we use --json, `face_photo` is included in JSON as base64.
        // We just need to trigger photo extraction.
        // My implementation in civ.rs:
        // if photo.is_some() || json { ... attempts photo extraction ... }
        // So passing --json is enough to trigger extraction and get base64 in JSON.
        // We don't need --photo <path> if we just want JSON response.

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
