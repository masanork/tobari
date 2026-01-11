import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import { DEFAULT_SIGNER_MACOS_PATH, PROJECT_ROOT, getNativeSignerPath } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CREDENTIALS_FILE = path.resolve(__dirname, '../../.tobari-credentials.json');

interface StoredCredential {
    id: string; // Base64URL
    rpId: string;
    createdAt: string;
    userName?: string;
}

export interface WebAuthnSignRequest {
    mode?: 'sign' | 'register';
    challenge: string; // Base64URL
    rpId?: string;
    userName?: string;
    userDisplayName?: string;
    allowCredentials?: { id: string; type: "public-key"; transports?: AuthenticatorTransport[] }[];
}

export interface WebAuthnSignResponse {
    mode: 'sign' | 'register';
    id: string;
    rawId: string;
    type: string;
    response: {
        authenticatorData?: string;
        clientDataJSON: string;
        signature?: string;
        userHandle?: string | null;
        attestationObject?: string;
    };
}

export class WebAuthnHandler {
    private server: http.Server | null = null;

    private loadCredentials(rpId: string): StoredCredential[] {
        try {
            if (fs.existsSync(CREDENTIALS_FILE)) {
                const content = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
                const list = JSON.parse(content) as StoredCredential[];
                return list.filter(c => c.rpId === rpId);
            }
        } catch (e) {
            console.error("Failed to load credentials file:", e);
        }
        return [];
    }

    private saveCredential(cred: StoredCredential) {
        try {
            let list: StoredCredential[] = [];
            if (fs.existsSync(CREDENTIALS_FILE)) {
                list = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
            }
            // Avoid duplicates
            if (!list.find(c => c.id === cred.id)) {
                list.push(cred);
                fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(list, null, 2));
            }
        } catch (e) {
            console.error("Failed to save credential:", e);
        }
    }

    async sign(request: WebAuthnSignRequest): Promise<WebAuthnSignResponse> {
        const signerPath = getNativeSignerPath();
        if (signerPath) {
            return this.signNative(signerPath, request);
        }
        return this.signBrowser(request);
    }

    private async signNative(signerPath: string, request: WebAuthnSignRequest): Promise<WebAuthnSignResponse> {
        return new Promise((resolve, reject) => {
            const isMacNative = signerPath === DEFAULT_SIGNER_MACOS_PATH;
            const mode = request.mode || 'sign';
            
            const signRequest = {
                challenge: request.challenge,
                rp_id: request.rpId || 'localhost',
                message: mode === 'register' ? 'Register new Passkey' : 'Sign with Passkey',
                user_verification: 'preferred'
            };

            let args: string[] = [];
            if (isMacNative) {
                args = [mode === 'register' ? '--register-passkey' : '--sign-passkey', '--request', JSON.stringify(signRequest)];
            } else {
                // Tauri signer handles mode internally or via distinct commands? 
                // For now use --request and let the app decide, or we might need to add flags.
                args = ['--request', JSON.stringify(signRequest)];
            }

            console.error(`[WebAuthn] Using native signer: ${signerPath}`);
            const proc = spawn(signerPath, args, { env: { ...process.env, TOBARI_SIGNER_USE_KEYCHAIN: '1' } });

            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (d) => stdout += d);
            proc.stderr.on('data', (d) => stderr += d);

            proc.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Native signer failed (code ${code}): ${stderr}`));
                    return;
                }

                try {
                    const output = JSON.parse(stdout);
                    // Map unified SignResponse to WebAuthnSignResponse
                    const res: WebAuthnSignResponse = {
                        mode: mode,
                        id: output.publicKey || '', // Placeholder
                        rawId: output.publicKey || '',
                        type: 'public-key',
                        response: {
                            authenticatorData: output.authData,
                            clientDataJSON: Buffer.from(output.clientDataJSON || '').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
                            signature: output.signature,
                        }
                    };

                    if (mode === 'register') {
                         this.saveCredential({
                            id: output.credentialId || output.publicKey,
                            rpId: request.rpId || 'localhost',
                            createdAt: new Date().toISOString(),
                            userName: request.userName
                        });
                    }

                    resolve(res);
                } catch (e) {
                    reject(new Error(`Failed to parse native signer output: ${e}\nOutput: ${stdout}`));
                }
            });
        });
    }

    /**
     * Starts a local server, opens the browser, and waits for the signature.
     */
    async signBrowser(request: WebAuthnSignRequest): Promise<WebAuthnSignResponse> {
            const templatePath = path.join(__dirname, 'templates', 'webauthn.html');

            // Create server
            this.server = http.createServer((req, res) => {
                const url = new URL(req.url || '/', `http://${req.headers.host}`);

                // 1. Serve HTML
                if (req.method === 'GET' && url.pathname === '/') {
                    fs.readFile(templatePath, 'utf8', (err, data) => {
                        if (err) {
                            res.writeHead(500);
                            res.end('Error loading template');
                            return;
                        }
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(data);
                    });
                    return;
                }

                // 2. Handle Callback (POST)
                if (req.method === 'POST' && url.pathname === '/callback') {
                    let body = '';
                    req.on('data', chunk => { body += chunk.toString(); });
                    req.on('end', () => {
                        try {
                            const response = JSON.parse(body) as WebAuthnSignResponse;
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 'ok' }));

                            // Save if it was a registration
                            if (response.mode === 'register') {
                                this.saveCredential({
                                    id: response.rawId, // rawId is Base64URL
                                    rpId: request.rpId || 'localhost',
                                    createdAt: new Date().toISOString(),
                                    userName: request.userName
                                });
                            }

                            // Successful signature/registration received
                            this.close();
                            resolve(response);
                        } catch (e) {
                            res.writeHead(400);
                            res.end('Invalid JSON');
                            this.close();
                            reject(e);
                        }
                    });
                    return;
                }

                res.writeHead(404);
                res.end('Not Found');
            });

            // Start server on a fixed port to maintain origin for localStorage/WebAuthn
            const BASE_PORT = 22022;
            const MAX_RETRIES = 10;

            const tryListen = (attempt: number) => {
                const port = BASE_PORT + attempt;
                this.server?.listen(port, '127.0.0.1');

                this.server?.on('error', (e: any) => {
                    if (e.code === 'EADDRINUSE') {
                        console.error(`Port ${port} is in use, trying next...`);
                        if (attempt < MAX_RETRIES) {
                            this.server?.close();
                            this.server = http.createServer(this.server?.listeners('request')[0] as any);
                            tryListen(attempt + 1);
                        } else {
                            reject(new Error(`Could not find a free port after ${MAX_RETRIES} attempts`));
                        }
                    } else {
                        reject(e);
                    }
                });

                this.server?.on('listening', () => {
                    const address = this.server?.address();
                    if (typeof address === 'object' && address) {
                        const port = address.port;
                        const challenge = encodeURIComponent(request.challenge);
                        // Force RP ID to localhost because we are running a local server.
                        // WebAuthn requires the RP ID to match the effective domain (localhost).
                        // We cannot masquerade as an external domain.
                        const rpId = encodeURIComponent('localhost');
                        console.error(`[WebAuthn] Overriding RP ID to 'localhost' for local signature execution. Requested was: ${request.rpId}`);

                        const mode = request.mode || 'sign';

                        let targetUrl = `http://localhost:${port}/?mode=${mode}&challenge=${challenge}&rpId=${rpId}`;

                        if (request.userName) targetUrl += `&userName=${encodeURIComponent(request.userName)}`;
                        if (request.userDisplayName) targetUrl += `&userDisplayName=${encodeURIComponent(request.userDisplayName)}`;

                        if (request.allowCredentials && request.allowCredentials.length > 0) {
                            const json = JSON.stringify(request.allowCredentials);
                            // Base64URL encode the JSON to avoid URL encoding mess
                            const b64 = Buffer.from(json).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                            targetUrl += `&allowCredentials=${b64}`;
                        }

                        console.error(`[WebAuthn] Opening browser at ${targetUrl}`);

                        // Open browser
                        const openCmd = process.platform === 'darwin' ? `open "${targetUrl}"`
                            : process.platform === 'win32' ? `start "${targetUrl}"`
                                : `xdg-open "${targetUrl}"`;

                        exec(openCmd, (err) => {
                            if (err) {
                                console.error('Failed to open browser:', err);
                                // Don't reject yet, user might open manually if we output the URL
                            }
                        });
                    }
                });
            };

            tryListen(0);

            // Timeout safety (e.g., 2 minutes)
            setTimeout(() => {
                if (this.server) {
                    this.close();
                    reject(new Error('WebAuthn interaction timed out. Please check if the browser window opened, or try manually visiting the URL visible in the logs. If using a Passkey for the first time, you may need to register one first.'));
                }
            }, 120000);
        });
    }

    private close() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
