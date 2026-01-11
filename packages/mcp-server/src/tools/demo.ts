import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import http from 'http';
import { decode } from "cbor-x";
import { verifyPresentation } from "@tobari/codec/validator";
import { readTobariFileAsBuffer, loadAllTrustedIssuers, PROJECT_ROOT } from "../utils.js";
import {
    ListAvailableDocumentsSchema,
    GenerateExampleDocumentSchema,
    StartDemoServerSchema
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

// --- Demo: Start Server ---

let server: http.Server | null = null;
let lastSubmission: any = null;
let trustedIssuers: Record<string, CryptoKey | { classic: CryptoKey; pqcPublicKey?: Uint8Array }> = {};

const PORT = 22081;

export async function handleDemoStartServer(toolArgs: any) {
    try {
        const _ = StartDemoServerSchema.parse(toolArgs);

        if (server) {
            server.close();
        }

        console.error("Loading trusted issuers for demo server...");
        trustedIssuers = await loadAllTrustedIssuers();
        console.error(`Loaded ${Object.keys(trustedIssuers).length} trusted issuers.`);

        server = http.createServer((req, res) => {
            // Enable CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            const url = new URL(req.url || '/', `http://${req.headers.host}`);

            if (req.method === 'GET' && url.pathname === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(renderPage(lastSubmission));
                return;
            }

            if (req.method === 'GET' && url.pathname === '/reset') {
                lastSubmission = null;
                res.writeHead(302, { 'Location': '/' });
                res.end();
                return;
            }

            if (req.method === 'POST' && url.pathname === '/submit') {
                let body = '';
                req.on('data', chunk => { body += chunk.toString(); });
                req.on('end', async () => {
                    try {
                        const data = JSON.parse(body);
                        console.error("Received submission:", data);

                        // Process and Verify if VP
                        let verificationResult = null;
                        let vpSummary: any = null;
                        let vpDecoded: any = null;
                        if (typeof data.vp_base64 === "string") {
                            try {
                                const vpBytes = new Uint8Array(Buffer.from(data.vp_base64, 'base64'));
                                const presentation = decode(vpBytes);
                                vpSummary = summarizeVp(presentation);
                                vpDecoded = normalizeForJson(presentation);
                                const results = await verifyPresentation(presentation, trustedIssuers);
                                const isValid = results.every(r => r.issuerValid && r.deviceValid);

                                verificationResult = {
                                    valid: isValid,
                                    details: results,
                                    // Extract simple summary
                                    summary: results.map(r => {
                                        const docType = r.docType;
                                        return {
                                            docType,
                                            valid: r.issuerValid && r.deviceValid,
                                            pqcPresent: r.issuerPqcPresent,
                                            pqcValid: r.issuerPqcValid
                                        };
                                    })
                                };
                            } catch (e: any) {
                                verificationResult = { valid: false, error: e.message };
                                if (!vpSummary) {
                                    vpSummary = { error: `Failed to decode VP: ${e.message}` };
                                }
                            }
                        }

                        lastSubmission = {
                            ...data,
                            _verification: verificationResult,
                            _vp_summary: vpSummary,
                            _vp_decoded: vpDecoded
                        };

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'success', message: 'Application received', verification: verificationResult }));
                    } catch (e) {
                        res.writeHead(400);
                        res.end('Invalid JSON');
                    }
                });
                return;
            }

            // Poll for updates (simple long polling or just refresh)
            if (req.method === 'GET' && url.pathname === '/status') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ hasSubmission: !!lastSubmission }));
                return;
            }

            res.writeHead(404);
            res.end('Not Found');
        });

        server.listen(PORT, '127.0.0.1');

        // Reset state
        lastSubmission = null;

        return {
            content: [
                {
                    type: "text",
                    text: `Demo server started at http://localhost:${PORT}\nSubmission Endpoint: http://localhost:${PORT}/submit`,
                },
            ],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error starting demo server: ${error.message}` }],
            isError: true,
        };
    }
}

function renderPage(submission: any) {
    let content = '';

    if (!submission) {
        content = `<div class="waiting-card">
             <div class="loader"></div>
             <h2>電子申請・届出 受付システム</h2>
             <p>申請データの送信を待機しています...</p>
             <div class="timeline waiting">
               <div class="step">証明書を取得中</div>
               <div class="step">VPを生成中</div>
               <div class="step">提出先へ送信中</div>
             </div>
             <p class="sub">Listening on http://localhost:${PORT}/submit</p>
           </div>`;
    } else {
        const verif = submission._verification;
        const vpSummary = submission._vp_summary;
        const vpDecoded = submission._vp_decoded;
        let badge = '';
        if (verif) {
            if (verif.valid) {
                badge = `<div class="badge success">✅ Identity Verified (Tobari)</div>`;
            } else {
                badge = `<div class="badge error">❌ Verification Failed: ${verif.error || 'Invalid Signature'}</div>`;
            }
        } else {
            badge = `<div class="badge warn">⚠️ Unverified Data</div>`;
        }

        // Clean up display data
        const displayData = { ...submission };
        delete displayData._verification;
        delete displayData._vp_summary;
        delete displayData._vp_decoded;
        delete displayData.vp_base64; // Show count or something instead?

        content = `<div class="success-card">
             <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="icon">📄</div>
                <a href="/reset" class="btn">Reset</a>
             </div>
             <h2>申請を受け付けました</h2>
             ${badge}
             <p>以下の内容で電子申請が処理されました。</p>

             <div class="timeline complete">
               <div class="step">証明書を取得</div>
               <div class="step">VPを生成</div>
               <div class="step">提出先で検証</div>
             </div>
             
             ${verif && verif.summary ? `
             <div class="doc-list">
                <h3>受信した証明書</h3>
                <ul>
                    ${verif.summary.map((s: any) => {
                        const pqcBadge = s.pqcPresent ? (s.pqcValid ? 'PQC ✅' : 'PQC ❌') : 'PQC —';
                        return `<li>${s.docType} ${s.valid ? '✅' : '❌'} <span class="pqc">${pqcBadge}</span></li>`;
                    }).join('')}
                </ul>
             </div>
             ` : ''}

             ${vpSummary ? `
             <div class="doc-list">
                <h3>VP Summary</h3>
                ${vpSummary.error ? `<p class="error-text">${vpSummary.error}</p>` : `
                <ul>
                    ${vpSummary.documents.map((d: any) => {
                        const count = typeof d.fieldCount === "number" ? ` (${d.fieldCount} fields)` : "";
                        return `<li>${d.docType || 'Unknown'}${count}</li>`;
                    }).join('')}
                </ul>
                <p class="sub">Documents: ${vpSummary.documentCount ?? 0}</p>
                `}
             </div>
             ` : ''}

             <div class="details">
                <h3>JSON Payload</h3>
                <pre>${JSON.stringify(displayData, null, 2)}</pre>
             </div>

             ${vpDecoded ? `
             <div class="details">
                <h3>VP JSON (decoded)</h3>
                <pre>${JSON.stringify(vpDecoded, null, 2)}</pre>
             </div>
             ` : ''}
           </div>`;
    }


    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>港区 電子申請・届出サービス (Demo)</title>
    <style>
        body { font-family: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif; background: #f0f2f5; margin: 0; padding: 2rem; color: #1d1d1f; }
        .container { max-width: 800px; margin: 0 auto; text-align: center; }
        .header { margin-bottom: 2rem; display: flex; align-items: center; justify-content: center; gap: 15px; }
        .logo-img { width: 40px; height: 40px; background: #0066cc; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 20px; }
        .logo-text { font-size: 1.5rem; font-weight: bold; color: #333; }
        .pqc { margin-left: 8px; font-size: 0.9rem; color: #556; }
        
        .waiting-card, .success-card {
            background: white; padding: 3rem; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); /* Flatter, more administrative look */
            transition: all 0.3s ease; text-align: left;
        }
        .waiting-card { text-align: center; }
        
        .icon { font-size: 3rem; margin-bottom: 1rem; }
        h2 { margin: 0 0 1rem; font-size: 1.6rem; color: #333; border-bottom: 2px solid #0066cc; display: inline-block; padding-bottom: 5px; }
        p { color: #666; font-size: 1rem; line-height: 1.6; }
        .sub { font-size: 0.9rem; color: #999; margin-top: 2rem; font-family: monospace; }
        
        .badge { display: inline-block; padding: 0.4rem 0.8rem; border-radius: 4px; color: white; font-weight: bold; margin-bottom: 1.5rem; font-size: 0.9rem; }
        .badge.success { background: #28a745; }
        .badge.error { background: #dc3545; }
        .badge.warn { background: #ffc107; color: #333; }

        .doc-list { background: #f8f9fa; padding: 1.5rem; border: 1px solid #dee2e6; margin-top: 1.5rem; }
        .doc-list h3 { margin-top: 0; font-size: 1rem; color: #333; border-left: 4px solid #0066cc; padding-left: 10px; }
        .doc-list ul { margin: 0; padding-left: 1.5rem; margin-top: 10px; }
        .doc-list li { margin-bottom: 5px; }
        .error-text { color: #dc3545; }

        .details { background: #f8f9fa; padding: 1.5rem; border: 1px solid #dee2e6; margin-top: 1.5rem; }
        .details h3 { margin-top: 0; font-size: 0.9rem; text-transform: uppercase; color: #666; }
        pre { white-space: pre-wrap; word-break: break-all; color: #333; font-size: 0.85rem; max-height: 300px; overflow-y: auto; background: white; padding: 10px; border: 1px solid #eee; }

        .btn { display: inline-block; padding: 0.5rem 1rem; background: #6c757d; color: white; text-decoration: none; border-radius: 4px; font-size: 0.9rem; }
        .btn:hover { background: #5a6268; }

        .loader {
            display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3;
            border-radius: 50%; border-top: 4px solid #0066cc; animation: spin 1s linear infinite;
            margin-bottom: 1rem;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        .timeline { margin-top: 1.5rem; display: grid; gap: 0.75rem; }
        .timeline .step { padding: 0.75rem 1rem; border-radius: 6px; background: #eef1f4; color: #556; position: relative; opacity: 0.6; }
        .timeline.complete .step { opacity: 1; }
        .timeline.complete .step.done { background: #e6f6ea; color: #1e7e34; }
        .timeline.waiting .step { animation: pulse 1.6s ease-in-out infinite; }
        .timeline.waiting .step:nth-child(2) { animation-delay: 0.2s; }
        .timeline.waiting .step:nth-child(3) { animation-delay: 0.4s; }
        @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.9; } }
    </style>
    <script>
        if (!${!!submission}) {
            setInterval(async () => {
                try {
                    const res = await fetch('/status');
                    const data = await res.json();
                    if (data.hasSubmission) location.reload();
                } catch(e) {}
            }, 1000);
        } else {
            const steps = Array.from(document.querySelectorAll('.timeline.complete .step'));
            steps.forEach((step, idx) => {
                setTimeout(() => step.classList.add('done'), 400 + idx * 500);
            });
        }
    </script>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo-img">港</div>
            <div class="logo-text">港区 (Minato City) 電子申請ポータル</div>
        </div>
        ${content}
    </div>
</body>
</html>`;
}

function summarizeVp(vp: any) {
    if (!vp || !Array.isArray(vp.documents)) {
        return { error: "VP does not contain documents." };
    }
    return {
        documentCount: vp.documents.length,
        documents: vp.documents.map((doc: any) => ({
            docType: doc?.docType,
            fieldCount: countNamespaceItems(doc?.issuerSigned?.nameSpaces)
        }))
    };
}

function countNamespaceItems(ns: any): number | null {
    if (!ns) return null;
    let count = 0;
    if (ns instanceof Map) {
        for (const value of ns.values()) {
            if (Array.isArray(value)) count += value.length;
        }
        return count;
    }
    if (typeof ns === "object") {
        for (const key of Object.keys(ns)) {
            const value = (ns as any)[key];
            if (Array.isArray(value)) count += value.length;
        }
        return count;
    }
    return null;
}

function normalizeForJson(value: any): any {
    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString("base64");
    }
    if (value instanceof Map) {
        const obj: Record<string, any> = {};
        for (const [k, v] of value.entries()) {
            obj[String(k)] = normalizeForJson(v);
        }
        return obj;
    }
    if (Array.isArray(value)) {
        return value.map((v) => normalizeForJson(v));
    }
    if (value && typeof value === "object") {
        const obj: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            obj[k] = normalizeForJson(v);
        }
        return obj;
    }
    return value;
}
