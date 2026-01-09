
import http from 'http';
import { StartDemoServerSchema } from '../schemas.js';
import { decode } from 'cbor-x';
import { verifyPresentation } from '@tobari/codec/validator';
import { loadAllTrustedIssuers } from '../utils.js';

let server: http.Server | null = null;
let lastSubmission: any = null;
let trustedIssuers: Record<string, CryptoKey> = {};

const PORT = 22081;

export async function handleStartDemoServer(toolArgs: any) {
    try {
        const _ = StartDemoServerSchema.parse(toolArgs);

        if (server) {
            server.close();
        }

        console.log("Loading trusted issuers for demo server...");
        trustedIssuers = await loadAllTrustedIssuers();
        console.log(`Loaded ${Object.keys(trustedIssuers).length} trusted issuers.`);

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
                        console.log("Received submission:", data);

                        // Process and Verify if VP
                        let verificationResult = null;
                        if (data.vp_base64) {
                            try {
                                const vpBytes = new Uint8Array(Buffer.from(data.vp_base64, 'base64'));
                                const presentation = decode(vpBytes);
                                const results = await verifyPresentation(presentation, trustedIssuers);
                                const isValid = results.every(r => r.issuerValid && r.deviceValid);

                                verificationResult = {
                                    valid: isValid,
                                    details: results,
                                    // Extract simple summary
                                    summary: results.map(r => {
                                        const docType = r.docType;
                                        // Extract some claims for display
                                        // r.claims is not exposed by verifyPresentation directly in current version?
                                        // Let's rely on the decoded presentation for raw data display
                                        return { docType, valid: r.issuerValid && r.deviceValid };
                                    })
                                };
                            } catch (e: any) {
                                verificationResult = { valid: false, error: e.message };
                            }
                        }

                        lastSubmission = {
                            ...data,
                            _verification: verificationResult
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
             <p class="sub">Listening on http://localhost:${PORT}/submit</p>
           </div>`;
    } else {
        const verif = submission._verification;
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
        delete displayData.vp_base64; // Show count or something instead?

        content = `<div class="success-card">
             <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="icon">📄</div>
                <a href="/reset" class="btn">Reset</a>
             </div>
             <h2>申請を受け付けました</h2>
             ${badge}
             <p>以下の内容で電子申請が処理されました。</p>
             
             ${verif && verif.summary ? `
             <div class="doc-list">
                <h3>受信した証明書</h3>
                <ul>
                    ${verif.summary.map((s: any) => `<li>${s.docType} ${s.valid ? '✅' : '❌'}</li>`).join('')}
                </ul>
             </div>
             ` : ''}

             <div class="details">
                <h3>JSON Payload</h3>
                <pre>${JSON.stringify(displayData, null, 2)}</pre>
             </div>
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

