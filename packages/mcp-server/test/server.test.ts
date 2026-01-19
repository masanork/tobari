import { describe, it, expect, afterAll } from "bun:test";
import path from "path";
import * as fs from "fs/promises";

describe("MCP Server", () => {
    const serverPath = path.resolve(import.meta.dir, "../src/index.ts");
    // Use a temporary key file for testing
    const tmpKeyFile = path.resolve(import.meta.dir, "tmp_server_test_key.bin");

    afterAll(async () => {
        try {
            await fs.unlink(tmpKeyFile);
        } catch {} // Ignore errors during cleanup
    });

    async function callTool(name: string, args: any) {
        const proc = Bun.spawn(["bun", "run", serverPath], {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
            env: {
                ...process.env,
                TOBARI_SIGNER_SOFTWARE_KEY: "1",
                TOBARI_SIGNER_KEY_FILE: tmpKeyFile,
                TOBARI_SIGNER_PATH: "disabled"
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

        proc.stdin.write(JSON.stringify(initReq) + "\n");
        proc.stdin.write(JSON.stringify(toolReq) + "\n");
        proc.stdin.end();

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        
        const lines = stdout.split("\n");
        const responseLine = lines.find(l => {
            try { return JSON.parse(l).id === 1; } catch { return false; }
        });

        if (!responseLine) throw new Error(`No response line found in: ${stdout}\nStderr: ${stderr}`);
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