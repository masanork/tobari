import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const PORT = 3000;
const PROJECT_ROOT = process.cwd();
const SIGNER_PATH = path.join(PROJECT_ROOT, "packages/signer-macos/bin/tobari-signer-macos");
const DEMO_ASSETS_DIR = path.join(PROJECT_ROOT, "examples/demo-assets/generated");

console.log(`
🚀 Tobari Prefill Demo Server starting...
-----------------------------------------
URL: http://localhost:${PORT}/examples/service-request/prefill-demo.html
Signer: ${SIGNER_PATH}
-----------------------------------------
`);

async function runSignerCommand(command: string, params: any = {}) {
    return new Promise((resolve, reject) => {
        const request = JSON.stringify({ command, params });
        const child = spawn(SIGNER_PATH, ["--request", request]);
        
        let stdout = "";
        let stderr = "";
        
        child.stdout.on("data", (data) => stdout += data);
        child.stderr.on("data", (data) => stderr += data);
        
        child.on("close", (code) => {
            if (code === 0) {
                try {
                    resolve(JSON.parse(stdout));
                } catch (e) {
                    reject(new Error("Failed to parse signer output"));
                }
            } else {
                reject(new Error(stderr || `Signer exited with code ${code}`));
            }
        });
    });
}

const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);
        const filePath = path.join(PROJECT_ROOT, url.pathname === "/" ? "index.html" : url.pathname);

        // API: Scan Card
        if (url.pathname === "/api/scan") {
            console.log("🔍 Scanning for physical card...");
            try {
                // 1. Detect Card Type
                // For demo simplicity, let's try to read JPKI if possible
                // In a real scenario, we'd do a detection pass first
                const result: any = await runSignerCommand("read_card", { 
                    cardType: "jpki",
                    includeMyNumber: true
                });

                if (result.status === "success") {
                    console.log("✅ Physical card read successfully!");
                    return Response.json({ source: 'jpki', data: result.result.data });
                }
            } catch (e) {
                console.log("ℹ️ No physical card found or error occurred. Falling back to Demo Asset.");
            }

            // Fallback: Return "Taro Saito" from generated assets
            const taroJpkiPath = path.join(DEMO_ASSETS_DIR, "taro-jpki.cose");
            if (fs.existsSync(taroJpkiPath)) {
                // Here we'd normally decode the COSE, but for the demo we'll return the JSON directly
                // matched to what the form expects
                return Response.json({
                    source: 'jpki',
                    data: {
                        name: "斉藤 太朗",
                        address: "東京都千代田区千代田1-1",
                        birthDate: "1985-01-01",
                        mynumber: "123456789012"
                    }
                });
            }
            
            return new Response("No data available", { status: 404 });
        }

        // Serve Static Files
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return new Response(Bun.file(filePath));
        }

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`Server listening on http://localhost:${server.port}`);
