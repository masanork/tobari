
import http from 'http';
import { StartDemoServerSchema } from '../schemas.js';

let server: http.Server | null = null;
let lastSubmission: any = null;

const PORT = 22081;

export async function handleStartDemoServer(toolArgs: any) {
    try {
        const _ = StartDemoServerSchema.parse(toolArgs);

        if (server) {
            server.close();
        }

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

            if (req.method === 'POST' && url.pathname === '/submit') {
                let body = '';
                req.on('data', chunk => { body += chunk.toString(); });
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        console.log("Received submission:", data);
                        lastSubmission = data;

                        // If browser requested this directly (form submit), redirect to /
                        // If API call (fetch), return JSON
                        // Using simple JSON response for now
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'success', message: 'Application received' }));
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
    const status = submission
        ? `<div class="success-card">
             <div class="icon">✅</div>
             <h2>申請を受け付けました</h2>
             <p>以下の内容で電子申請が完了しました。</p>
             <div class="details">
                <h3>受信データ</h3>
                <pre>${JSON.stringify(submission, null, 2)}</pre>
             </div>
           </div>`
        : `<div class="waiting-card">
             <div class="loader"></div>
             <h2>申請待ち</h2>
             <p>電子申請データの送信を待機しています...</p>
             <p class="sub">Listening on http://localhost:${PORT}/submit</p>
           </div>`;

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>自治体申請受付システム (Demo)</title>
    <style>
        body { font-family: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif; background: #f0f2f5; margin: 0; padding: 2rem; color: #1d1d1f; }
        .container { max-width: 800px; margin: 0 auto; text-align: center; }
        .header { margin-bottom: 2rem; }
        .logo { font-size: 1.5rem; font-weight: bold; color: #0066cc; }
        
        .waiting-card, .success-card {
            background: white; padding: 3rem; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            transition: all 0.3s ease;
        }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
        h2 { margin: 0 0 1rem; font-size: 1.8rem; }
        p { color: #666; font-size: 1.1rem; }
        .sub { font-size: 0.9rem; color: #999; margin-top: 2rem; font-family: monospace; }
        
        .details { text-align: left; background: #f8f9fa; padding: 1.5rem; border-radius: 10px; margin-top: 2rem; border: 1px solid #e9ecef; }
        pre { white-space: pre-wrap; word-break: break-all; color: #333; font-size: 0.9rem; }

        .loader {
            display: inline-block; width: 50px; height: 50px; border: 3px solid rgba(0,102,204,0.3);
            border-radius: 50%; border-top-color: #0066cc; animation: spin 1s ease-in-out infinite;
            margin-bottom: 1rem;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
    <script>
        // Auto-refresh logic
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
            <div class="logo">Minato City Portal</div>
        </div>
        ${status}
    </div>
</body>
</html>`;
}
