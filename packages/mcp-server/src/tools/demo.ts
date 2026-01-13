import * as fs from "fs/promises";
import * as path from "path";
import { decode } from "cbor-x";
import { readTobariFileAsBuffer, PROJECT_ROOT } from "../utils.js";
import {
    ListAvailableDocumentsSchema
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

import { McpTool } from "../mcp-tool.js";
export const demoTools: McpTool<any>[] = [
    { name: "demo_list_examples", description: "Lists example documents.", schema: ListAvailableDocumentsSchema, handler: handleDemoListExamples }
];

