import { spawn } from "node:child_process";
import path from "path";

async function run() {
    const serverPath = path.resolve("packages/mcp-server/src/index.ts");
    console.log("Starting server:", serverPath);
    const proc = spawn("bun", ["run", serverPath], {
        stdio: ["pipe", "pipe", "pipe"],
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

    if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("No stdio");

    proc.stdout.on("data", (data) => console.log("STDOUT:", data.toString()));
    proc.stderr.on("data", (data) => console.error("STDERR:", data.toString()));

    proc.stdin.write(JSON.stringify(initReq) + "\n");

    const toolReq = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
            name: "list_available_documents",
            arguments: {}
        }
    };
    proc.stdin.write(JSON.stringify(toolReq) + "\n");

    setTimeout(() => {
        console.log("Killing server...");
        proc.kill();
        process.exit(0);
    }, 2000);
}

run().catch(console.error);

