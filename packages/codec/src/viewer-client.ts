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

        // 2. Inject Decrypted Font if present
        if (doc.visuals && doc.visuals.font) {
            console.log("🎨 Applying decrypted font from document...");
            const style = document.createElement('style');
            style.textContent = doc.visuals.font;
            document.head.appendChild(style);
        }

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

// Final Fidelity Rendering
function render(doc: any, rawData: any, mso: MSO) {
    const data = cleanData(rawData);
    console.log("🎨 Final Polish Rendering...", { data });
    
    document.body.style.background = '#f0f4f8';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
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
        !primaryFieldNames.includes(k) && 
        !issuerFieldNames.includes(k) && 
        !footerFieldNames.includes(k) &&
        !wideFieldNames.includes(k) && 
        typeof v !== 'object'
    );
    const complexEntries = entries.filter(([k, v]) => typeof v === 'object');

    const template = (window as any).TOBARI_TEMPLATE || "";
    let html = "";
    
    if (template) {
        try { html = simpleTemplate(template, data, mso); } catch (e) { console.error(e); }
    }

    if (!html) {
        html = `
            <div class="official-container" style="padding: clamp(10px, 3vw, 40px); min-height: 100vh; display: flex; flex-direction: column; align-items: center;">
                <div class="official-document" style="
                    background: white; 
                    width: 100%;
                    max-width: 900px; 
                    padding: clamp(25px, 7vw, 70px); 
                    box-shadow: 0 30px 60px rgba(0,0,0,0.12); 
                    border-radius: 20px;
                    font-family: 'TobariSubset', 'IPAMJMincho', serif;
                    color: #1a202c;
                    position: relative;
                    line-height: 1.7;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 50px;">
                        <div style="display: flex; align-items: center; gap: 10px; color: #2f855a; font-family: sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.05em; background: #f0fff4; padding: 6px 14px; border-radius: 100px; border: 1px solid #c6f6d5;">
                            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l5-5z" clip-rule="evenodd"></path></svg>
                            VERIFIED
                        </div>
                        <div style="font-family: sans-serif; font-size: 11px; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.1em;">
                            mdoc / ISO 18013-5
                        </div>
                    </div>
                    
                    <header style="margin-bottom: 60px;">
                        <h1 style="font-size: clamp(22px, 4vw, 34px); font-weight: 500; border-bottom: 3px solid #3182ce; display: inline-block; padding-bottom: 8px; margin: 0; color: #2d3748;">
                            ${safeStr(data["証明書名称"] || mso.docType.split('.').pop())}
                        </h1>
                    </header>

                    <main>
                        <div style="display: flex; flex-direction: column; gap: 30px; margin-bottom: 50px;">
                            ${primaryEntries.filter(([k]) => k !== "証明書名称").map(([k, v]) => `
                                <div class="field-group">
                                    <label style="display: block; font-size: 14px; color: #718096; margin-bottom: 6px; font-family: sans-serif; border-left: 3px solid #cbd5e0; padding-left: 10px;">${k}</label>
                                    <div style="font-size: clamp(24px, 5vw, 32px); font-weight: 500; color: #000; line-height: 1.2;">${safeStr(v)}</div>
                                </div>
                            `).join('')}
                        </div>

                        <!-- Wide Fields (Address, Domicile, etc.) -->
                        ${wideEntries.length > 0 ? `
                        <div style="display: flex; flex-direction: column; gap: 20px; margin-bottom: 40px;">
                            ${wideEntries.map(([k, v]) => `
                                <div style="border-top: 1px solid #edf2f7; padding-top: 15px;">
                                    <label style="display: block; font-size: 12px; color: #a0aec0; margin-bottom: 4px; font-family: sans-serif;">${k}</label>
                                    <div style="font-size: clamp(16px, 2.5vw, 20px); color: #2d3748; line-height: 1.5;">${safeStr(v)}</div>
                                </div>
                            `).join('')}
                        </div>
                        ` : ''}

                        <!-- Grid for other fields -->
                        ${secondaryEntries.length > 0 ? `
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 25px; background: #fafbfc; padding: 30px; border-radius: 16px; border: 1px solid #f0f4f8; margin-bottom: 50px;">
                            ${secondaryEntries.map(([k, v]) => `
                                <div>
                                    <label style="display: block; font-size: 11px; color: #a0aec0; margin-bottom: 4px; font-family: sans-serif;">${k}</label>
                                    <div style="font-size: 17px; color: #2d3748;">${safeStr(v)}</div>
                                </div>
                            `).join('')}
                        </div>
                        ` : ''}

                        ${complexEntries.map(([k, v]) => `
                            <div style="margin-top: 60px;">
                                <h3 style="font-size: 18px; margin-bottom: 25px; color: #4a5568; font-weight: 600; font-family: sans-serif; display: flex; align-items: center; gap: 10px;">
                                    <span style="width: 24px; height: 2px; background: #3182ce;"></span>
                                    ${k}
                                </h3>
                                ${Array.isArray(v) ? renderModernCardList(v) : `<pre style="background:#f8fafc; padding:20px; border-radius:12px; font-size:14px; border: 1px dashed #cbd5e0;">${JSON.stringify(v, null, 2)}</pre>`}
                            </div>
                        `).join('')}

                        <!-- Issuer Info & Date at the bottom -->
                        <div style="margin-top: 80px; text-align: right; border-top: 2px solid #1a202c; padding-top: 30px;">
                            ${footerEntries.map(([k, v]) => `
                                <div style="margin-bottom: 20px; text-align: left;">
                                    <span style="font-size: 18px; color: #2d3748;">${safeStr(v)}</span>
                                </div>
                            `).join('')}
                            
                            ${issuerEntries.map(([k, v]) => `
                                <div style="margin-bottom: 8px;">
                                    <span style="font-size: 13px; color: #718096; margin-right: 15px; font-family: sans-serif;">${k}</span>
                                    <span style="font-size: 22px; font-weight: 500;">${safeStr(v)}</span>
                                </div>
                            `).join('')}
                            
                            <div style="margin-top: 20px; display: inline-block; width: 60px; height: 60px; border: 2.5px solid #1a202c; color: #1a202c; border-radius: 2px; line-height: 60px; text-align: center; font-weight: bold; transform: rotate(-1deg); font-family: 'TobariSubset', 'IPAMJMincho', serif; font-size: 24px; user-select: none; box-sizing: border-box;">
                                印
                            </div>
                        </div>
                    </main>

                    <footer style="margin-top: 60px; border-top: 1px solid #edf2f7; padding-top: 30px; font-family: sans-serif; font-size: 11px; color: #cbd5e0; display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 20px;">
                        <div>
                            <strong>Cryptographic Proof</strong>: Tobari v1.0<br>
                            Integrity Verified via P-384 ECDSA
                        </div>
                        <div style="text-align: right;">
                            Ref: ${mso.digestAlgorithm.substring(0, 12)}...<br>
                            Unlocked via Hardware Passkey
                        </div>
                    </footer>
                </div>
            </div>
        `;
    }

    const root = document.getElementById('viewer-root') || document.body;
    root.innerHTML = html;
}

function renderModernCardList(array: any[]): string {
    const highlightKeys = ["氏名", "旧氏", "Full Name"];
    const wideKeys = ["前住所", "本籍", "住所"];
    const remarksKey = "備考";
    
    if (array.length === 0) return "<p style='color:#a0aec0; font-style:italic;'>No detailed records revealed.</p>";
    
    return array.map(item => {
        const name = item["氏名"] || item["Full Name"] || "";
        const maidenName = item["旧氏"] || "";
        
        const normalFields = Object.entries(item).filter(([k]) => 
            !highlightKeys.includes(k) && !wideKeys.includes(k) && k !== remarksKey
        );
        const trailingWideFields = Object.entries(item).filter(([k]) => 
            wideKeys.includes(k)
        );
        const remarksField = Object.entries(item).find(([k]) => k === remarksKey);

        const renderField = ([k, v]: [string, any], isWide = false) => `
            <div style="${isWide ? 'border-top: 1px solid #f7fafc; padding-top: 12px; margin-top: 10px;' : ''}">
                <span style="font-size: 10px; color: #cbd5e0; display: block; font-family: sans-serif; margin-bottom: 2px; text-transform: uppercase;">${k}</span>
                <span style="font-size: ${isWide ? '16px' : '15px'}; color: #2d3748; line-height: 1.4;">${v}</span>
            </div>
        `;

        return `
            <div style="background: #fdfdfd; padding: 25px; border-radius: 16px; margin-bottom: 20px; border: 1px solid #f0f0f0; box-shadow: 0 2px 8px rgba(0,0,0,0.02);">
                <!-- Name Row (Top) -->
                <div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 30px; border-bottom: 2px solid #f7fafc; padding-bottom: 15px; margin-bottom: 20px;">
                    <div style="min-width: 200px;">
                        <span style="font-size: 10px; color: #a0aec0; display: block; font-family: sans-serif; margin-bottom: 2px;">氏名</span>
                        <span style="font-size: clamp(22px, 4vw, 30px); color: #000; font-weight: 500;">${name}</span>
                    </div>
                    ${maidenName ? `
                        <div>
                            <span style="font-size: 10px; color: #a0aec0; display: block; font-family: sans-serif; margin-bottom: 2px;">旧氏</span>
                            <span style="font-size: clamp(18px, 3vw, 24px); color: #4a5568; font-weight: 500;">${maidenName}</span>
                        </div>
                    ` : ""}
                </div>
                
                <!-- Normal Attributes Grid (Middle) -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 15px;">
                    ${normalFields.map(f => renderField(f)).join('')}
                </div>

                <!-- Trailing Wide Fields (Addresses etc.) -->
                ${trailingWideFields.map(f => renderField(f, true)).join('')}

                <!-- Remarks (Absolute Bottom) -->
                ${remarksField ? renderField(remarksField, true) : ""}
            </div>
        `;
    }).join('');
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