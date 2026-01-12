import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import { DEFAULT_MYNA_PATH, DEFAULT_SIGNER_MACOS_PATH } from "../utils.js";
import {
    SignWithJPKISchema,
    ReadMyNumberSchema,
    ReadBasicInfoSchema,
    ReadPhotoSchema,
    ReadPassportSchema,
    ReadDriverLicenseSchema,
    ReadResidenceCardSchema
} from "../schemas.js";

// ... (omitted getNativeSignerPath and other helpers) ...

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
            // Tauri: wrap in request JSON
            const req = {
                mrz: args.mrz || "",
                // CAN support could be added to Tauri if needed
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
                    format: "base64",
                    description: "Passport data read successfully. dg1 contains MRZ, dg2 contains face photo."
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

        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
