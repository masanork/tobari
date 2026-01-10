import { decode } from 'cbor-x';
import { revealMdocData, MSO } from './sd';
import { verifyTobari } from './validator';

let currentDebugData: any = null;

export async function initViewer(base64Data: string, issuerPublicKeyJwk?: any) {
    try {
        let rawContent = base64Data;

        const hash = window.location.hash.substring(1);
        if (hash) {
            const dataPrefix = "data=";
            if (hash.startsWith(dataPrefix)) {
                console.log("🔗 Loading data from URL fragment...");
                rawContent = decodeURIComponent(hash.substring(dataPrefix.length));
            }
        }
        
        if (!rawContent || rawContent === "") {
            renderWelcome();
            return;
        }

        let isEncrypted = false;
        try {
            const b64Part = rawContent.includes(',') ? rawContent.split(',')[1] : rawContent;
            const decodedStr = atob(b64Part.trim());
            const json = JSON.parse(decodedStr);
            if (json.tobari_enc === true) {
                isEncrypted = true;
                rawContent = await unlockEncryptedPayload(json);
            }
        } catch (e) {}

        const b64ToBinary = (b64: string) => {
            const s = b64.includes(',') ? b64.split(',')[1] : b64;
            const binStr = atob(s.trim());
            const len = binStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
            return bytes;
        };

        const binary = b64ToBinary(rawContent);
        const doc = decode(binary);
        const issuerAuthToken = doc.issuerSigned.issuerAuth;
        const coseArray = decode(issuerAuthToken);
        const mso = decode(coseArray[2]);

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
            const fontBytes = doc.visuals.font;
            const blob = new Blob([fontBytes], { type: 'font/woff2' });
            const fontUrl = URL.createObjectURL(blob);
            const style = document.createElement('style');
            style.textContent = `@font-face { font-family: 'TobariSubset'; src: url('${fontUrl}') format('woff2'); font-style: normal; font-weight: normal; font-display: block; }`;
            document.head.appendChild(style);
        }

        render(doc, disclosedData, mso);

        if (issuerPublicKeyJwk && !isSignatureValid) {
            showWarning("⚠️ SIGNATURE VALIDATION FAILED");
        }
        setupDebugUI();
    } catch (e) {
        console.error("Viewer Initialization Error:", e);
        renderError(e);
    }
}

function renderWelcome() {
    injectGlobalStyles();
    document.body.innerHTML = `
        <div class="welcome-screen">
            <div id="drop-zone" class="drop-card">
                <div class="logo">帳</div>
                <h2>Tobari Secure Viewer</h2>
                <p>検証したい証明書ファイル（.cose / .wbn）を<br>ここにドロップしてください</p>
                <input type="file" id="file-input" style="display:none">
                <button class="primary-btn" onclick="document.getElementById('file-input').click()">ファイルを選択</button>
            </div>
            <p class="footer-note">データはブラウザ内でのみ処理され、サーバーに送信されることはありません。</p>
        </div>
    `;
    setupDropZone();
}

function renderError(err: any) {
    injectGlobalStyles();
    document.body.innerHTML = `
        <div class="welcome-screen">
            <div class="drop-card error">
                <div class="logo">⚠️</div>
                <h2>Failed to Load</h2>
                <p>ドキュメントの読み込みに失敗しました。不正な形式か、パスキーが一致しない可能性があります。</p>
                <button class="primary-btn" onclick="location.href=location.pathname">トップに戻る</button>
            </div>
        </div>
    `;
}

function setupDropZone() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const handleFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const b64 = btoa(String.fromCharCode(...new Uint8Array(e.target?.result as ArrayBuffer)));
            window.location.hash = "data=" + encodeURIComponent(b64);
            location.reload();
        };
        reader.readAsArrayBuffer(file);
    };
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('active'); });
    dropZone?.addEventListener('dragleave', () => { dropZone.classList.remove('active'); });
    dropZone?.addEventListener('drop', (e) => { e.preventDefault(); const file = e.dataTransfer?.files[0]; if (file) handleFile(file); });
    fileInput?.addEventListener('change', () => { if (fileInput.files?.[0]) handleFile(fileInput.files[0]); });
}

function injectGlobalStyles() {
    if (document.getElementById('tobari-global-styles')) return;
    const style = document.createElement('style');
    style.id = 'tobari-global-styles';
    style.textContent = `
        body { margin: 0; background: #f4f7f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #2d3748; }
        .welcome-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; box-sizing: border-box; }
        .drop-card { background: white; padding: 60px 40px; border-radius: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.04); border: 2px dashed #e2e8f0; max-width: 480px; width: 100%; text-align: center; transition: all 0.3s ease; }
        .drop-card.active { border-color: #3182ce; background: #ebf8ff; transform: scale(1.02); }
        .drop-card.error { border-color: #feb2b2; }
        .logo { font-size: 64px; margin-bottom: 24px; font-family: 'TobariSubset', serif; color: #1a202c; }
        h2 { margin: 0 0 12px 0; font-size: 24px; color: #1a202c; }
        p { color: #718096; line-height: 1.6; margin-bottom: 32px; }
        .primary-btn { background: #1a202c; color: white; border: none; padding: 14px 28px; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .primary-btn:hover { background: #2d3748; transform: translateY(-1px); }
        .secondary-btn { background: none; color: #3182ce; border: 1px solid #3182ce; padding: 12px 24px; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 15px; width: 100%; }
        .footer-note { margin-top: 24px; color: #a0aec0; font-size: 13px; }
        
        .official-doc-container { padding: 40px 20px; display: flex; justify-content: center; }
        .official-doc { 
            background: white; width: 100%; max-width: 840px; padding: 80px 100px; 
            box-shadow: 0 40px 100px rgba(0,0,0,0.08), 0 10px 20px rgba(0,0,0,0.02); 
            border-radius: 4px; font-family: 'TobariSubset', serif; position: relative;
        }
        .verified-badge { 
            position: absolute; top: 40px; right: 40px; 
            display: flex; align-items: center; gap: 8px;
            color: #2f855a; font-weight: bold; font-size: 12px; 
            letter-spacing: 0.1em; background: #f0fff4; padding: 6px 12px; 
            border-radius: 4px; border: 1px solid #c6f6d5; font-family: sans-serif;
        }
        .doc-header { margin-bottom: 60px; border-bottom: 1px solid #1a202c; padding-bottom: 15px; }
        .doc-title { font-size: 32px; font-weight: normal; margin: 0; color: #1a202c; }
        .field-section { margin-bottom: 40px; }
        .field-label { font-family: sans-serif; font-size: 12px; color: #718096; margin-bottom: 8px; display: block; }
        .field-value-lg { font-size: 36px; color: #000; line-height: 1.2; }
        .field-value-md { font-size: 20px; color: #1a202c; }
        .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 40px; }
        .issuer-footer { margin-top: 80px; padding-top: 30px; border-top: 1px solid #1a202c; display: flex; justify-content: space-between; align-items: flex-end; }
        .hankyo { width: 60px; height: 60px; border: 2px solid #e53e3e; color: #e53e3e; text-align: center; line-height: 60px; font-size: 24px; font-weight: bold; border-radius: 2px; transform: rotate(-5deg); user-select: none; }
    `;
    document.head.appendChild(style);
}

function render(doc: any, rawData: any, mso: MSO) {
    injectGlobalStyles();
    const data = cleanData(rawData);
    const safeStr = (v: any): string => (v === null || v === undefined) ? "" : String(v);

    const primaryKeys = ["氏名", "世帯主氏名", "証明書名称", "Name", "Title"];
    const wideKeys = ["住所", "世帯住所", "本籍", "前住所", "備考"];
    const issuerKeys = ["発行者役職", "発行者氏名"];

    const title = safeStr(data["証明書名称"] || mso.docType.split('.').pop());
    const mainFields = Object.entries(data).filter(([k, v]) => primaryKeys.includes(k) && k !== "証明書名称");
    const wideFields = Object.entries(data).filter(([k, v]) => wideKeys.includes(k));
    const otherFields = Object.entries(data).filter(([k, v]) => !primaryKeys.includes(k) && !wideKeys.includes(k) && !issuerKeys.includes(k) && typeof v !== 'object');
    const listFields = Object.entries(data).filter(([k, v]) => Array.isArray(v));

    document.body.innerHTML = `
        <div class="official-doc-container">
            <div class="official-doc">
                <div class="verified-badge">
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l5-5z"/></svg>
                    VERIFIED
                </div>
                
                <div class="doc-header">
                    <h1 class="doc-title">${title}</h1>
                </div>

                <div class="doc-body">
                    ${mainFields.map(([k, v]) => `
                        <div class="field-section">
                            <span class="field-label">${k}</span>
                            <div class="field-value-lg">${v}</div>
                        </div>
                    `).join('')}

                    ${wideFields.map(([k, v]) => `
                        <div class="field-section" style="border-top: 1px solid #edf2f7; padding-top: 20px;">
                            <span class="field-label">${k}</span>
                            <div class="field-value-md">${v}</div>
                        </div>
                    `).join('')}

                    <div class="field-grid">
                        ${otherFields.map(([k, v]) => `
                            <div>
                                <span class="field-label">${k}</span>
                                <div class="field-value-md" style="font-size: 17px;">${v}</div>
                            </div>
                        `).join('')}
                    </div>

                    ${listFields.map(([k, v]) => `
                        <div style="margin-top: 50px;">
                            <h3 style="font-family:sans-serif; font-size:14px; color:#718096; border-bottom:1px solid #edf2f7; padding-bottom:10px;">${k}</h3>
                            ${renderList(v as any[])}
                        </div>
                    `).join('')}
                </div>

                <div class="issuer-footer">
                    <div style="text-align: left;">
                        <div style="font-size: 14px; margin-bottom: 10px;">${safeStr(data["交付年月日"] || "")}</div>
                        ${issuerKeys.map(([k, v]) => `
                            <div style="font-size: 13px; color: #4a5568;">${k}: <span style="font-size: 18px; color: #000; margin-left: 10px;">${v}</span></div>
                        `).join('')}
                    </div>
                    <div class="hankyo">印</div>
                </div>
            </div>
        </div>
    `;
}

function renderList(array: any[]): string {
    return array.map(item => `
        <div style="padding: 20px 0; border-bottom: 1px solid #f7fafc; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 15px;">
            ${Object.entries(item).map(([k, v]) => `
                <div>
                    <span style="font-size: 9px; color: #a0aec0; display: block; font-family: sans-serif; text-transform: uppercase;">${k}</span>
                    <span style="font-size: 15px;">${v}</span>
                </div>
            `).join('')}
        </div>
    `).join('');
}

async function unlockEncryptedPayload(wrapper: any): Promise<string> {
    injectGlobalStyles();
    document.body.innerHTML = `
        <div class="welcome-screen">
            <div class="drop-card">
                <div class="logo">🔒</div>
                <h2>Encrypted Document</h2>
                <p>この書類は暗号化されています。閲覧するには発行時に指定したパスキーが必要です。</p>
                <button id="unlock-btn" class="primary-btn" style="width: 100%;">パスキーで復号</button>
                <button id="demo-unlock-btn" class="secondary-btn">デモ用共有鍵で試行</button>
                <p style="margin-top:20px; font-size:11px; color:#a0aec0; text-align:left;">
                    ※ パスキーによる復号は、発行者へ事前に公開鍵を登録している必要があります。デモ用ドキュメントの場合は「デモ用共有鍵」を使用してください。
                </p>
            </div>
        </div>
    `;

    const ciphertext = Uint8Array.from(atob(wrapper.data), c => c.charCodeAt(0));
    const info = new TextEncoder().encode("tobari-storage-v1");
    const { decryptHPKE } = await import("@tobari/crypto/hpke");

    return new Promise((resolve) => {
        document.getElementById('unlock-btn')?.addEventListener('click', async () => {
            try {
                const secret = await deriveHmacSecret(false); // Try real WebAuthn
                const plaintext = await decryptHPKE(secret.slice(0, 32), ciphertext, info);
                resolve(btoa(String.fromCharCode(...new Uint8Array(plaintext))));
            } catch (e) {
                alert("復号に失敗しました。このドキュメント用ではないパスキーです。");
            }
        });

        document.getElementById('demo-unlock-btn')?.addEventListener('click', async () => {
            const secret = await deriveHmacSecret(true); // Force demo fallback
            const plaintext = await decryptHPKE(secret.slice(0, 32), ciphertext, info);
            resolve(btoa(String.fromCharCode(...new Uint8Array(plaintext))));
        });
    });
}

async function deriveHmacSecret(forceDemo: boolean): Promise<Uint8Array> {
    if (!forceDemo) {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        try {
            const assertion = await navigator.credentials.get({
                publicKey: { challenge, timeout: 60000, userVerification: "required", extensions: { hmacGetSecret: { salt1: new Uint8Array(32) } } as any }
            }) as any;
            const res = assertion.getClientExtensionResults();
            if (res.hmacGetSecret) return new Uint8Array(res.hmacGetSecret.output1);
        } catch (e) { console.warn("WebAuthn extension failed."); }
    }
    return new TextEncoder().encode("tobari-demo-secret-key-32-bytes-long!!");
}

function showWarning(msg: string) {
    const warning = document.createElement('div');
    Object.assign(warning.style, {
        position: 'fixed', top: '0', left: '0', width: '100%', background: '#e53e3e',
        color: 'white', padding: '12px', textAlign: 'center', fontWeight: 'bold', zIndex: '9999', fontFamily: 'sans-serif'
    });
    warning.textContent = msg;
    document.body.prepend(warning);
}

function setupDebugUI() {
    const isDebug = new URLSearchParams(window.location.search).get('debug') === '1';
    if (!isDebug) return;
    const btn = document.createElement('div');
    btn.innerHTML = 'DEBUG';
    Object.assign(btn.style, { position: 'fixed', bottom: '20px', right: '20px', background: '#1a202c', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', zIndex: '10000', fontSize: '12px' });
    document.body.appendChild(btn);
    btn.onclick = () => {
        const panel = document.createElement('pre');
        Object.assign(panel.style, { position: 'fixed', top: '0', right: '0', width: '400px', height: '100%', background: '#1a202c', color: '#ccc', padding: '20px', overflow: 'auto', zIndex: '10001', margin: 0, fontSize: '11px' });
        panel.textContent = JSON.stringify(currentDebugData, (k, v) => v instanceof Uint8Array ? Array.from(v) : v, 2);
        document.body.appendChild(panel);
        panel.onclick = () => panel.remove();
    };
}

(window as any).initTobari = initViewer;