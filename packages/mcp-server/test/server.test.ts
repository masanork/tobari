import { spawn } from "node:child_process";
import { describe, it, expect, afterAll } from "bun:test";
import path from "path";
import { decode } from "cbor-x";
import * as fs from "fs/promises";

describe("MCP Server", () => {
    const serverPath = path.resolve(import.meta.dir, "../src/index.ts");
    // Use a temporary key file for testing to avoid Touch ID prompts
    const tmpKeyFile = path.resolve(import.meta.dir, "tmp_test_key.bin");

    afterAll(async () => {
        // Clean up temporary key file
        try {
            await fs.unlink(tmpKeyFile);
        } catch {}
    });

    async function callTool(name: string, args: any) {
        const proc = spawn("bun", ["run", serverPath], {
            stdio: ["pipe", "pipe", "pipe"],
            env: {
                ...process.env,
                TOBARI_SIGNER_SOFTWARE_KEY: "1",  // Use software key for tests
                TOBARI_SIGNER_KEY_FILE: tmpKeyFile,  // Persist key across processes
                TOBARI_SIGNER_PATH: "disabled" // Force JS implementation fallback
            }
        });

        const initReq = {
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0" }
            }
        };

        const toolReq = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: args }
        };

        if (!proc.stdin || !proc.stdout) throw new Error("No stdio");

        proc.stdin.write(JSON.stringify(initReq) + "\n");
        proc.stdin.write(JSON.stringify(toolReq) + "\n");

        let outputBuffer = "";
        proc.stdout.on("data", (chunk) => {
            outputBuffer += chunk.toString();
        });

        const waitForResponse = async () => {
            for (let i = 0; i < 150; i++) {
                if (outputBuffer.includes('"id":1')) return;
                await new Promise(r => setTimeout(r, 200));
            }
            throw new Error(`Timeout waiting for response. Output: ${outputBuffer}`);
        };

        try {
            await waitForResponse();
        } finally {
            proc.kill();
        }

        const lines = outputBuffer.split("\n");
        const responseLine = lines.find(l => {
            try { return JSON.parse(l).id === 1; } catch { return false; }
        });

        if (!responseLine) throw new Error("No response line found in: " + outputBuffer);
        return JSON.parse(responseLine);
    }

    it("should read ininjo.html", async () => {
        const targetFile = path.resolve(import.meta.dir, "../../../examples/ininjo/ininjo.html");
        const response = await callTool("read_tobari_file", { path: targetFile });
        
        if (response.error) throw new Error(`MCP Error: ${response.error.message}`);
        
        const content = response.result.content[0].text;
        expect(content).toContain("io.github.masanork.tobari.ininjo.v1");
        const data = JSON.parse(content);
        expect(data.principal.name).toBe("山田太郎");
    }, 60000);

    it("should read juminhyo-plain.cose", async () => {
        const targetFile = path.resolve(import.meta.dir, "../../../examples/juminhyo/juminhyo-plain.cose");
        const response = await callTool("read_tobari_file", { path: targetFile });
        
        if (response.error) throw new Error(`MCP Error: ${response.error.message}`);
        
        const content = response.result.content[0].text;
        expect(content).toContain("io.github.masanork.tobari.juminhyo.v1");
    }, 60000);

    it("should list documents", async () => {
        const response = await callTool("demo_list_examples", {});
        if (response.error) throw new Error(`MCP Error: ${response.error.message}`);
        
        const data = JSON.parse(response.result.content[0].text);
        expect(data.documents.length).toBeGreaterThan(0);
    }, 60000);

    it("should create a VP", async () => {
        const ininjoFile = path.resolve(import.meta.dir, "../../../examples/ininjo/ininjo.cose");
        const juminhyoFile = path.resolve(import.meta.dir, "../../../examples/juminhyo/juminhyo-plain.cose");
        
        const response = await callTool("create_presentation", {
            requests: [
                { path: ininjoFile, fields: ["id"] },
                { path: juminhyoFile, fields: ["世帯主氏名"] }
            ],
            ephemeralKey: true
        });

        if (response.error) throw new Error(`MCP Error: ${response.error.message}`);
        
        const data = JSON.parse(response.result.content[0].text);
        expect(data.vp_base64).toBeDefined();
        expect(data.document_count).toBe(2);
    }, 60000);
});
