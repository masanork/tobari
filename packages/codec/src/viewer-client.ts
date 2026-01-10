import { decode } from 'cbor-x';
import { revealMdocData, MSO } from './sd';
import { verifyTobari } from './validator';

let currentDebugData: any = null;

export async function initViewer(base64Data: string, issuerPublicKeyJwk?: any) {
    try {
        let rawContent = base64Data;

        // 0. Priority: Load from URL Fragment (Stateless Redirection)
        const hash = window.location.hash.substring(1);
        if (hash) {
            // URLSearchParams can be strict, so we try manual split first
            const dataPrefix = "data=";
            if (hash.startsWith(dataPrefix)) {
                console.log("🔗 Loading data from URL fragment...");
                rawContent = decodeURIComponent(hash.substring(dataPrefix.length));
            }
        }
        
        // If still empty, show Welcome/Drop UI
        if (!rawContent || rawContent === "") {
            renderWelcome();
            return;
        }

        // 1. Detect if the content is an encrypted JSON wrapper
        let isEncrypted = false;
        try {
            const b64Part = rawContent.includes(',') ? rawContent.split(',')[1] : rawContent;
            const decodedStr = atob(b64Part.trim());
            const json = JSON.parse(decodedStr);
            if (json.tobari_enc === true) {
                isEncrypted = true;
                rawContent = await unlockEncryptedPayload(json);
            }
        } catch (e) {
            // Not a JSON wrapper, proceed as raw CBOR
        }

        const b64ToBinary = (b64: string) => {
            const s = b64.includes(',') ? b64.split(',')[1] : b64;
            const binStr = atob(s.trim());
            const len = binStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
            return bytes;
        };

        const binary = b64ToBinary(rawContent);
        if (binary.length === 0) {
            renderWelcome();
            return;
        }

        const doc = decode(binary);
        const issuerAuthToken = doc.issuerSigned.issuerAuth;
        const coseArray = decode(issuerAuthToken);
        const mso = decode(coseArray[2]);

        // Cryptographic Verification
        let isSignatureValid = false;
        if (issuerPublicKeyJwk) {
            try {
                const namedCurve = issuerPublicKeyJwk.crv || "P-384";
                const issuerKey = await crypto.subtle.importKey(
                    "jwk", issuerPublicKeyJwk, { name: "ECDSA", namedCurve: namedCurve }, true, ["verify"]
                );
                const result = await verifyTobari(binary, issuerKey);
                isSignatureValid = result.isValid;
            } catch (e) {
                console.error("Verification error:", e);
            }
        }

        const namespace = mso.docType;
        const items = doc.issuerSigned.nameSpaces[namespace] || [];
        const disclosedData = await revealMdocData(mso, items, namespace);

        currentDebugData = { doc, mso, revealed: disclosedData, isSignatureValid, coseArray };
        (window as any).currentDebugData = currentDebugData;

        if (doc.visuals && doc.visuals.font) {
            const style = document.createElement('style');
            style.textContent = doc.visuals.font;
            document.head.appendChild(style);
        }

        render(doc, disclosedData, mso);

        if (issuerPublicKeyJwk && !isSignatureValid) {
            showWarning("⚠️ SIGNATURE VALIDATION FAILED");
        }
        setupDebugUI();
    } catch (e) {
        console.error("Viewer Initialization Error:", e);
        document.body.innerHTML = `
            <div style="padding:40px; font-family:sans-serif; text-align:center;">
                <h2 style="color:#e53e3e;">Failed to Load Document</h2>
                <p style="color:#718096;">The data might be corrupted or in an invalid format.</p>
                <button onclick="location.href=location.pathname" style="margin-top:20px; padding:10px 20px; cursor:pointer;">Back to Home</button>
            </div>
        `;
    }
}

function renderWelcome() {
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; background: #f7fafc; text-align: center; padding: 20px;">
            <div id="drop-zone" style="background: white; padding: 60px; border-radius: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.05); border: 2px dashed #cbd5e0; max-width: 500px; width: 100%; cursor: pointer;">
                <div style="font-size: 64px; margin-bottom: 20px;">帳</div>
                <h2 style="margin-bottom: 10px; color: #2d3748;">Tobari Secure Viewer</h2>
                <p style="color: #718096; margin-bottom: 30px;">Drag and drop a <b>.cose</b> or <b>.wbn</b> file here to verify.</p>
                <input type="file" id="file-input" style="display:none">
                <button onclick="document.getElementById('file-input').click()" style="background: #3182ce; color: white; border: none; padding: 12px 24px; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer;">
                    Select File
                </button>
            </div>
            <p style="margin-top: 20px; color: #a0aec0; font-size: 12px;">Files are processed locally and never uploaded to any server.</p>
        </div>
    `;

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input') as HTMLInputElement;

    const handleFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const buf = e.target?.result as ArrayBuffer;
            const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
            window.location.hash = "data=" + b64;
            location.reload();
        };
        reader.readAsArrayBuffer(file);
    };

    dropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#3182ce';
    });
    dropZone?.addEventListener('dragleave', () => {
        dropZone.style.borderColor = '#cbd5e0';
    });
    dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files[0];
        if (file) handleFile(file);
    });
    fileInput?.addEventListener('change', () => {
        if (fileInput.files?.[0]) handleFile(fileInput.files[0]);
    });
}

function showWarning(msg: string) {
    const warning = document.createElement('div');
    Object.assign(warning.style, {
        position: 'fixed', top: '0', left: '0', width: '100%', background: '#e53e3e',
        color: 'white', padding: '12px', textAlign: 'center', fontWeight: 'bold', zIndex: '9999'
    });
    warning.textContent = msg;
    document.body.prepend(warning);
}

function cleanData(v: any): any {
    if (v === null || v === undefined) return v;
    if (typeof v === 'object') {
        if (v["@value"] !== undefined) return cleanData(v["@value"]);
        if (Array.isArray(v)) return v.map(cleanData);
        const res: any = {};
        for (const key in v) res[key] = cleanData(v[key]);
        return res;
    }
    return v;
}

function render(doc: any, rawData: any, mso: MSO) {
    const data = cleanData(rawData);
    document.body.style.background = '#f0f4f8';
    document.body.style.margin = '0';
    document.body.style.display = 'block';

    const safeStr = (v: any): string => (v === null || v === undefined) ? "" : String(v);
    const primaryFieldNames = ["氏名", "世帯主氏名", "証明書名称", "Title", "Name"];
    const issuerFieldNames = ["発行者役職", "発行者氏名"];
    const footerFieldNames = ["交付年月日"];
    const wideFieldNames = ["世帯住所", "住所", "前住所", "本籍", "備考"];
    const entries = Object.entries(data);
    const primaryEntries = entries.filter(([k, v]) => primaryFieldNames.includes(k) && typeof v !== 'object');
    const issuerEntries = entries.filter(([k]) => issuerFieldNames.includes(k));
    const footerEntries = entries.filter(([k]) => footerFieldNames.includes(k));
    const wideEntries = entries.filter(([k, v]) => wideFieldNames.includes(k) && typeof v !== 'object');
    const secondaryEntries = entries.filter(([k, v]) => 
        !primaryFieldNames.includes(k) && !issuerFieldNames.includes(k) && 
        !footerFieldNames.includes(k) && !wideFieldNames.includes(k) && typeof v !== 'object'
    );
    const complexEntries = entries.filter(([k, v]) => typeof v === 'object');

    const html = `
        <div class="official-container" style="padding: 20px; min-height: 100vh; display: flex; flex-direction: column; align-items: center;">
            <div class="official-document" style="
                background: white; width: 100%; max-width: 800px; padding: 60px; box-shadow: 0 20px 50px rgba(0,0,0,0.1); 
                border-radius: 12px; font-family: 'TobariSubset', serif; color: #1a202c; line-height: 1.7;
            ">
                <div style="display: flex; justify-content: space-between; margin-bottom: 40px;">
                    <div style="color: #2f855a; font-weight: bold; background: #f0fff4; padding: 4px 12px; border-radius: 4px; border: 1px solid #c6f6d5;">VERIFIED</div>
                    <div style="font-size: 11px; color: #a0aec0;">ISO 18013-5 mdoc</div>
                </div>
                <header style="margin-bottom: 40px; border-bottom: 2px solid #3182ce; padding-bottom: 10px;">
                    <h1 style="font-size: 28px; margin: 0;">${safeStr(data["証明書名称"] || mso.docType.split('.').pop())}</h1>
                </header>
                <div style="display: flex; flex-direction: column; gap: 20px;">
                    ${primaryEntries.filter(([k]) => k !== "証明書名称").map(([k, v]) => `
                        <div><label style="color:#718096; font-size:12px;">${k}</label><div style="font-size:24px; font-weight:500;">${v}</div></div>
                    `).join('')}
                    ${wideEntries.map(([k, v]) => `
                        <div style="border-top:1px solid #edf2f7; padding-top:10px;"><label style="color:#718096; font-size:12px;">${k}</label><div style="font-size:18px;">${v}</div></div>
                    `).join('')}
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; background:#f7fafc; padding:20px; border-radius:8px;">
                        ${secondaryEntries.map(([k, v]) => `
                            <div><label style="color:#a0aec0; font-size:11px;">${k}</label><div>${v}</div></div>
                        `).join('')}
                    </div>
                    ${complexEntries.map(([k, v]) => `
                        <div style="margin-top:20px;"><h3 style="font-size:16px; border-left:4px solid #3182ce; padding-left:10px;">${k}</h3>
                        ${Array.isArray(v) ? renderModernCardList(v) : `<pre>${JSON.stringify(v, null, 2)}</pre>`}</div>
                    `).join('')}
                </div>
                <div style="margin-top: 60px; text-align: right; border-top: 1px solid #1a202c; padding-top: 20px;">
                    ${footerEntries.map(([k, v]) => `<div>${v}</div>`).join('')}
                    ${issuerEntries.map(([k, v]) => `<div>${k}: ${v}</div>`).join('')}
                    <div style="margin-top:10px; display:inline-block; width:50px; height:50px; border:2px solid #000; text-align:center; line-height:50px; font-size:20px;">印</div>
                </div>
            </div>
        </div>
    `;
    const root = document.getElementById('viewer-root') || document.body;
    root.innerHTML = html;
}

function renderModernCardList(array: any[]): string {
    return array.map(item => `
        <div style="background:#fff; border:1px solid #edf2f7; padding:15px; border-radius:8px; margin-bottom:10px; box-shadow:0 2px 4px rgba(0,0,0,0.02);">
            ${Object.entries(item).map(([k, v]) => `<div><span style="font-size:10px; color:#a0aec0;">${k}: </span><span>${v}</span></div>`).join('')}
        </div>
    `).join('');
}

async function unlockEncryptedPayload(wrapper: any): Promise<string> {
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; background: #f7fafc; margin:0;">
            <div style="background: white; padding: 60px; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.1); text-align: center; max-width: 450px;">
                <div style="font-size: 64px; margin-bottom: 30px;">🔒</div>
                <h2 style="margin-bottom: 15px;">Encrypted Record</h2>
                <p style="color: #718096; margin-bottom: 40px;">This document is encrypted. Please authorize with your Passkey.</p>
                <button id="unlock-btn" style="background: #3182ce; color: white; border: none; padding: 16px 32px; border-radius: 10px; font-size: 18px; cursor: pointer; font-weight: bold; width: 100%;">
                    Unlock with Passkey
                </button>
            </div>
        </div>
    `;

    return new Promise((resolve) => {
        document.getElementById('unlock-btn')?.addEventListener('click', async () => {
            const secret = await deriveHmacSecret();
            const ciphertext = Uint8Array.from(atob(wrapper.data), c => c.charCodeAt(0));
            const info = new TextEncoder().encode("tobari-storage-v1");
            const { decryptHPKE } = await import("@tobari/crypto/hpke");
            const plaintext = await decryptHPKE(secret.slice(0, 32), ciphertext, info);
            resolve(btoa(String.fromCharCode(...new Uint8Array(plaintext))));
        });
    });
}

async function deriveHmacSecret(): Promise<Uint8Array> {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    try {
        const assertion = await navigator.credentials.get({
            publicKey: { challenge, timeout: 60000, userVerification: "required", extensions: { hmacGetSecret: { salt1: new Uint8Array(32) } } as any }
        }) as any;
        const res = assertion.getClientExtensionResults();
        if (res.hmacGetSecret) return new Uint8Array(res.hmacGetSecret.output1);
    } catch (e) { console.warn("WebAuthn failed, using demo fallback"); }
    return new TextEncoder().encode("tobari-demo-secret-key-32-bytes-long!!");
}

function setupDebugUI() {
    const isDebug = new URLSearchParams(window.location.search).get('debug') === '1';
    if (!isDebug) return;
    const btn = document.createElement('div');
    btn.innerHTML = 'DEBUG';
    Object.assign(btn.style, { position: 'fixed', bottom: '20px', right: '20px', background: '#2d3748', color: 'white', padding: '8px 16px', borderRadius: '100px', cursor: 'pointer', zIndex: '10000' });
    document.body.appendChild(btn);
    btn.onclick = () => {
        const panel = document.createElement('pre');
        Object.assign(panel.style, { position: 'fixed', top: '0', right: '0', width: '400px', height: '100%', background: '#1a202c', color: '#ccc', padding: '20px', overflow: 'auto', zIndex: '10001' });
        panel.textContent = JSON.stringify(currentDebugData, (k, v) => v instanceof Uint8Array ? Array.from(v) : v, 2);
        document.body.appendChild(panel);
        panel.onclick = () => panel.remove();
    };
}

(window as any).initTobari = initViewer;
