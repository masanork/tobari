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

export async function handleSignWithJpki(toolArgs: any) {
    try {
        const args = SignWithJPKISchema.parse(toolArgs);

        const mynaPath = args.mynaPath || DEFAULT_MYNA_PATH;
        const resolvedMynaPath = mynaPath.startsWith("~")
            ? path.join(os.homedir(), mynaPath.slice(1))
            : mynaPath;

        const dataBuffer = Buffer.from(args.data, 'base64');
        const tmpDir = os.tmpdir();
        const inputFile = path.join(tmpDir, `jpki-input-${Date.now()}.bin`);
        const outputFile = path.join(tmpDir, `jpki-output-${Date.now()}.cms`);

        try {
            await fs.writeFile(inputFile, dataBuffer);

            const cmdArgs = [
                "jpki", "cms", "sign",
                "-i", inputFile,
                "-o", outputFile,
                "-p", args.pin,
                "-m", args.digest || "sha256",
                "-f", args.format || "der"
            ];

            if (args.detached !== false) {
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
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            signature: signatureBase64,
                            format: args.format || "der",
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
        const mynaPath = args.mynaPath || DEFAULT_MYNA_PATH;
        const resolvedMynaPath = mynaPath.startsWith("~")
            ? path.join(os.homedir(), mynaPath.slice(1))
            : mynaPath;

        const cmdArgs = ["text", "mynumber", "-p", args.pin];
        const mynaProcess = spawn(resolvedMynaPath, cmdArgs);

        const mynumber = await new Promise<string>((resolve, reject) => {
            let stdout = "";
            let stderr = "";
            mynaProcess.stdout.on("data", (data) => stdout += data.toString());
            mynaProcess.stderr.on("data", (data) => stderr += data.toString());
            mynaProcess.on("close", (code) => {
                if (code === 0) resolve(stdout.trim());
                else reject(new Error(`myna exited with code ${code}: ${stderr || stdout}`));
            });
            mynaProcess.on("error", (err) => reject(err));
        });

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ mynumber: mynumber }, null, 2),
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
        const mynaPath = args.mynaPath || DEFAULT_MYNA_PATH;
        const resolvedMynaPath = mynaPath.startsWith("~")
            ? path.join(os.homedir(), mynaPath.slice(1))
            : mynaPath;

        const cmdArgs = ["text", "attr", "-p", args.pin, "-f", "json"];
        const mynaProcess = spawn(resolvedMynaPath, cmdArgs);

        const jsonOutput = await new Promise<string>((resolve, reject) => {
            let stdout = "";
            let stderr = "";
            mynaProcess.stdout.on("data", (data) => stdout += data.toString());
            mynaProcess.stderr.on("data", (data) => stderr += data.toString());
            mynaProcess.on("close", (code) => {
                if (code === 0) resolve(stdout.trim());
                else reject(new Error(`myna exited with code ${code}: ${stderr || stdout}`));
            });
            mynaProcess.on("error", (err) => reject(err));
        });

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(JSON.parse(jsonOutput), null, 2),
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
        const mynaPath = args.mynaPath || DEFAULT_MYNA_PATH;
        const resolvedMynaPath = mynaPath.startsWith("~")
            ? path.join(os.homedir(), mynaPath.slice(1))
            : mynaPath;

        const tmpDir = os.tmpdir();
        const outputFile = path.join(tmpDir, `mynumber-photo-${Date.now()}.jp2`);

        try {
            const cmdArgs = ["visual", "photo", "-p", args.pin, "-o", outputFile];
            const mynaProcess = spawn(resolvedMynaPath, cmdArgs);

            await new Promise<void>((resolve, reject) => {
                let stdout = "";
                let stderr = "";
                mynaProcess.stdout.on("data", (data) => stdout += data.toString());
                mynaProcess.stderr.on("data", (data) => stderr += data.toString());
                mynaProcess.on("close", (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`myna exited with code ${code}: ${stderr || stdout}`));
                });
                mynaProcess.on("error", (err) => reject(err));
            });

            const photoBuffer = await fs.readFile(outputFile);
            const photoBase64 = photoBuffer.toString('base64');

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ photo: photoBase64, format: "jpeg2000" }, null, 2),
                    },
                ],
            };
        } finally {
            try { await fs.unlink(outputFile); } catch { }
        }
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error reading photo: ${error.message}` }],
            isError: true,
        };
    }
}
