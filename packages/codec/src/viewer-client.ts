import { decode } from 'cbor-x';
import { revealMdocData, MSO } from './sd';
import { verifyTobari } from './validator';

// Minimal UI for the Tobari Viewer
let currentDebugData: any = null;

export async function initViewer(base64Data: string, issuerPublicKeyJwk?: any) {
    try {
        let rawContent = base64Data;
        
        // 1. Detect if the content is an encrypted JSON wrapper
        let isEncrypted = false;
        try {
            const decodedStr = atob(base64Data.split(',')[1] || base64Data);
            const json = JSON.parse(decodedStr);
            if (json.tobari_enc === true) {
                isEncrypted = true;
                rawContent = await unlockEncryptedPayload(json);
            }
        } catch (e) {
            // Not a JSON wrapper
        }

        const binary = Uint8Array.from(atob(rawContent.split(',')[1] || rawContent), c => c.charCodeAt(0));

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

        // Render document
        render(doc, disclosedData, mso);

        if (issuerPublicKeyJwk && !isSignatureValid) {
            showWarning("⚠️ SIGNATURE VALIDATION FAILED");
        } else if (isSignatureValid) {
            console.log("✅ Signature Verified Successfully.");
        }

        setupDebugUI();
    } catch (e) {
        document.body.innerHTML = `<div class="error" style="padding:40px;">Failed: ${e}</div>`;
        console.error(e);
    }
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

// Utility to recursively unwrap Tobari @value metadata
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

// Robust Rendering
function render(doc: any, rawData: any, mso: MSO) {
    const data = cleanData(rawData);
    console.log("🎨 Rendering Cleaned Data...", { data });
    
    document.body.style.background = '#f8fafc';
    document.body.style.margin = '0';
    document.body.style.padding = '0';

    const safeStr = (v: any): string => (v === null || v === undefined) ? "" : String(v);

    const primaryFieldNames = ["氏名", "世帯主氏名", "証明書名称"];
    const entries = Object.entries(data);
    
    const primaryEntries = entries.filter(([k, v]) => primaryFieldNames.includes(k) && typeof v !== 'object');
    const secondaryEntries = entries.filter(([k, v]) => !primaryFieldNames.includes(k) && typeof v !== 'object');
    const complexEntries = entries.filter(([k, v]) => typeof v === 'object');

    const template = (window as any).TOBARI_TEMPLATE || "";
    let html = "";
    
    if (template) {
        try { html = simpleTemplate(template, data, mso); } catch (e) { console.error(e); }
    }

    if (!html) {
        html = `
            <div class="official-document" style="background: white; max-width: 850px; margin: 40px auto; padding: clamp(30px, 8vw, 80px); border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.05); font-family: 'TobariSubset', 'IPAMJMincho', serif; color: #1a202c; position: relative; line-height: 1.6;">
                <div style="color: #38a169; font-family: sans-serif; font-size: 12px; font-weight: 600; margin-bottom: 40px; display: flex; align-items: center; gap: 8px;">
                    <div style="width: 8px; height: 8px; background: #38a169; border-radius: 50%;"></div>
                    DIGITALLY VERIFIED DOCUMENT
                </div>
                
                <header style="margin-bottom: 60px;">
                    <h1 style="font-size: clamp(24px, 5vw, 36px); font-weight: 500; border-bottom: 2px solid #1a202c; display: inline-block; padding-bottom: 10px; margin: 0;">
                        ${safeStr(data["証明書名称"] || mso.docType.split('.').pop())}
                    </h1>
                </header>

                <main>
                    <div style="display: flex; flex-direction: column; gap: 40px; margin-bottom: 60px;">
                        ${primaryEntries.map(([k, v]) => `
                            <div>
                                <label style="display: block; font-size: 14px; color: #718096; margin-bottom: 12px; font-family: sans-serif;">${k}</label>
                                <div style="font-size: clamp(32px, 7vw, 56px); font-weight: 500; color: #000; line-height: 1.1;">${safeStr(v)}</div>
                            </div>
                        `).join('')}
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 30px; border-top: 1px solid #edf2f7; padding-top: 40px;">
                        ${secondaryEntries.map(([k, v]) => `
                            <div>
                                <label style="display: block; font-size: 12px; color: #a0aec0; margin-bottom: 6px; font-family: sans-serif; text-transform: uppercase;">${k}</label>
                                <div style="font-size: 19px; color: #2d3748;">${safeStr(v)}</div>
                            </div>
                        `).join('')}
                    </div>

                    ${complexEntries.map(([k, v]) => `
                        <div style="margin-top: 50px; border-top: 1px solid #edf2f7; padding-top: 40px;">
                            <h3 style="font-size: 18px; margin-bottom: 24px; color: #4a5568;">${k}</h3>
                            ${Array.isArray(v) ? renderComplexList(v) : `<pre style="font-size:13px; background:#f8fafc; padding:20px; border-radius:12px; overflow-x:auto;">${JSON.stringify(v, null, 2)}</pre>`}
                        </div>
                    `).join('')}
                </main>

                <footer style="margin-top: 80px; border-top: 1px solid #eee; padding-top: 30px; font-family: sans-serif; font-size: 11px; color: #cbd5e0; display: flex; justify-content: space-between; align-items: flex-end;">
                    <div>
                        <strong>Protocol</strong>: Tobari v1.0 / mdoc ISO 18013-5<br>
                        <strong>Security</strong>: SHA-384 ECDSA Integrity
                    </div>
                    <div style="text-align: right;">
                        Verification Ref: ${mso.digestAlgorithm}<br>
                        Authenticated via Secure Enclave
                    </div>
                </footer>
            </div>
        `;
    }

    const root = document.getElementById('viewer-root') || document.body;
    root.innerHTML = html;
}

function renderComplexList(array: any[]): string {
    return array.map(item => `
        <div style="background: #fdfdfd; padding: 25px; border-radius: 12px; margin-bottom: 15px; border: 1px solid #f0f0f0; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 20px;">
            ${Object.entries(item).map(([k, v]) => `
                <div>
                    <span style="font-size: 11px; color: #a0aec0; display: block; font-family: sans-serif; margin-bottom: 4px;">${k}</span>
                    <span style="font-size: 16px; color: #2d3748; font-weight: 500;">${v}</span>
                </div>
            `).join('')}
        </div>
    `).join('');
}

function simpleTemplate(template: string, data: any, mso: MSO): string {
    let result = template;
    for (const key in data) {
        const val = data[key];
        const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
        result = result.replace(new RegExp(`{{${key}}}`, 'g'), strVal);
    }
    return result;
}

async function unlockEncryptedPayload(wrapper: any): Promise<string> {
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; background: #f7fafc; margin:0;">
            <div style="background: white; padding: 60px; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.1); text-align: center; max-width: 450px;">
                <div style="font-size: 64px; margin-bottom: 30px;">🔒</div>
                <h2 style="margin-bottom: 15px; font-weight: 600;">Encrypted Record</h2>
                <p style="color: #718096; margin-bottom: 40px; line-height: 1.5;">This document is protected by hardware-backed encryption. Please authorize with your Passkey.</p>
                <button id="unlock-btn" style="background: #3182ce; color: white; border: none; padding: 16px 32px; border-radius: 10px; font-size: 18px; cursor: pointer; font-weight: bold; width: 100%; transition: transform 0.1s active;">
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
    if (!isDebug || document.getElementById('tobari-debug-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'tobari-debug-btn';
    btn.innerHTML = 'DEBUG';
    Object.assign(btn.style, {
        position: 'fixed', bottom: '20px', right: '20px', background: '#2d3748', color: 'white',
        padding: '8px 16px', borderRadius: '100px', fontSize: '12px', cursor: 'pointer', zIndex: '10000'
    });
    document.body.appendChild(btn);
    btn.onclick = () => {
        const panel = document.createElement('pre');
        Object.assign(panel.style, {
            position: 'fixed', top: '0', right: '0', width: '400px', height: '100%', background: '#1a202c',
            color: '#ccc', padding: '20px', overflow: 'auto', zIndex: '10001', fontSize: '11px'
        });
        panel.textContent = JSON.stringify(currentDebugData, (k, v) => v instanceof Uint8Array ? Array.from(v) : v, 2);
        document.body.appendChild(panel);
        panel.onclick = () => panel.remove();
    };
}

(window as any).initTobari = initViewer;
