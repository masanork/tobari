import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import { decode } from "cbor-x";
import { readTobariFileAsBuffer, PROJECT_ROOT } from "../utils.js";
import {
    ListAvailableDocumentsSchema,
    GenerateExampleDocumentSchema
} from "../schemas.js";

// --- Demo: List Examples ---

export async function handleDemoListExamples(toolArgs: any) {
    try {
        const args = ListAvailableDocumentsSchema.parse(toolArgs);
        // Default to the project root's examples directory
        const baseDir = args.rootPath || path.join(PROJECT_ROOT, "examples");

        const files: any[] = [];
        const scan = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory() && entry.name !== "node_modules") {
                    await scan(fullPath);
                } else if (entry.isFile() && (entry.name.endsWith(".html") || entry.name.endsWith(".cose"))) {
                    if (entry.name === "verifier-tool.html" || entry.name === "viewer-template.html") continue;

                    try {
                        const buffer = await readTobariFileAsBuffer(fullPath, args.decrypt);
                        const cose = decode(buffer);
                        let docType = cose.docType || "Unknown";

                        if (Array.isArray(cose) && cose.length >= 3) {
                            try {
                                const payload = decode(cose[2]);
                                if (payload.docType) docType = payload.docType;
                            } catch { } // Ignore errors during payload decoding
                        }

                        // Check for associated keys in the same directory
                        const fileDir = path.dirname(fullPath);
                        const keys: any = {};
                        
                        const classicKeyPath = path.join(fileDir, "issuer-key.json");
                        try {
                            await fs.access(classicKeyPath);
                            keys.classic = classicKeyPath;
                        } catch {} // Ignore if key doesn't exist

                        const pqcKeyPath = path.join(fileDir, "issuer-pqc-public-key.json");
                        try {
                            await fs.access(pqcKeyPath);
                            keys.pqc = pqcKeyPath;
                        } catch {} // Ignore if key doesn't exist

                        files.push({
                            name: entry.name,
                            path: fullPath,
                            type: docType,
                            category: docType.includes("service_request") ? "Administrative Request" : "Credential",
                            keys: Object.keys(keys).length > 0 ? keys : undefined
                        });
                    } catch (e) { } // Ignore errors during file processing
                }
            }
        };

        await scan(baseDir);

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        baseDir,
                        documents: files
                    }, null, 2),
                },
            ],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error listing examples: ${error.message}` }],
            isError: true,
        };
    }
}

// --- Demo: Generate Example ---

export async function handleDemoGenerateExample(toolArgs: any) {
    try {
        const args = GenerateExampleDocumentSchema.parse(toolArgs);
        const examplesDir = path.join(PROJECT_ROOT, "examples");
        const targetDir = path.join(examplesDir, args.exampleName);

        try {
            await fs.access(targetDir);
        } catch {
            throw new Error(`Example directory '${args.exampleName}' not found in ${examplesDir}`);
        }

        // Find the generation script (gen-*.ts)
        const files = await fs.readdir(targetDir);
        const scriptName = files.find(f => f.startsWith("gen-") && f.endsWith(".ts"));

        if (!scriptName) {
            throw new Error(`No generation script (gen-*.ts) found in ${targetDir}`);
        }

        const scriptPath = path.join(targetDir, scriptName);
        const cmdArgs = ["run", scriptPath];
        if (args.pqc) cmdArgs.push("--pqc");
        if (args.encrypt) cmdArgs.push("--encrypt");

        console.error(`Executing: bun ${cmdArgs.join(" ")}`);

        const bunCommand = process.env.BUN_PATH || path.join(os.homedir(), ".bun/bin/bun");
        const proc = spawn(bunCommand, cmdArgs, { cwd: PROJECT_ROOT });
        
        const output = await new Promise<string>((resolve, reject) => {
            let stdout = "";
            let stderr = "";
            proc.stdout.on("data", d => stdout += d);
            proc.stderr.on("data", d => stderr += d);
            proc.on("close", code => {
                if (code === 0) resolve(stdout);
                else reject(new Error(`Script exited with code ${code}:\n${stderr}\n${stdout}`));
            });
            proc.on("error", (err: NodeJS.ErrnoException) => {
                if (err.code === "ENOENT") {
                    reject(new Error("bun not found. Install bun or set BUN_PATH to the bun binary path."));
                } else {
                    reject(err);
                }
            });
        });

        // Parse output to find generated file path (convention: "✅ Generated: /path/to/file")
        const match = output.match(/✅ Generated: (.+)/);
        const generatedFile = match ? match[1].trim() : "Unknown location (check logs)";

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        message: "Example document generated successfully.",
                        script: scriptName,
                        generatedFile,
                        logs: output.trim()
                    }, null, 2),
                },
            ],
        };

    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error generating example: ${error.message}` }],
            isError: true,
        };
    }
}
