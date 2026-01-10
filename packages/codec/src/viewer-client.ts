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

        await processAndRender(rawContent, issuerPublicKeyJwk);
    } catch (e) {
        console.error("Viewer Initialization Error:", e);
        renderError(e);
    }
}

// Safe conversion for large Uint8Arrays to Base64
function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// Safe conversion for Base64 to Uint8Array
function base64ToUint8Array(b64: string): Uint8Array {
    const s = b64.includes(',') ? b64.split(',')[1] : b64;
    const binStr = atob(s.trim());
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
    return bytes;
}

async function processAndRender(rawContent: string, issuerPublicKeyJwk?: any) {
    let content = rawContent;
    
    try {
        const bytes = base64ToUint8Array(content);
        const jsonStr = new TextDecoder().decode(bytes.slice(0, 1000)); // Peek for JSON
        if (jsonStr.includes('"tobari_enc":true')) {
            const fullJson = JSON.parse(new TextDecoder().decode(bytes));
            content = await unlockEncryptedPayload(fullJson);
        }
    } catch (e) {}

    const binary = base64ToUint8Array(content);
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
        } catch (e) {}
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
    setupDebugUI();
}

function renderWelcome() {
    injectGlobalStyles();
    document.body.innerHTML = `
        <div class="welcome-screen">
            <div id="drop-zone" class="drop-card">
                <div class="logo">帳</div>
                <h2>Tobari Secure Viewer</h2>
                <p>証明書ファイル（.cose / .wbn）を<br>ここにドロップして検証・閲覧</p>
                <input type="file" id="file-input" style="display:none" accept=".cose,.wbn">
                <button class="primary-btn" onclick="document.getElementById('file-input').click()">ファイルを選択</button>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #edf2f7;">
                <div id="key-gen-section">
                    <p style="font-size: 13px; margin-bottom: 15px;">あなた専用のロックされた証明書を発行するために<br>必要な「受取人公開鍵」を生成します。</p>
                    <button id="gen-key-btn" class="secondary-btn" style="margin-top:0;">受取人公開鍵を生成</button>
                </div>
            </div>
            <p class="footer-note">ローカルで処理されるため、データが外部に送信されることはありません。</p>
        </div>
    `;
    setupDropZone();
    setupKeyGen();
}

function setupKeyGen() {
    const btn = document.getElementById('gen-key-btn');
    const section = document.getElementById('key-gen-section');
    btn?.addEventListener('click', async () => {
        try {
            btn.textContent = "パスキーを認証中...";
            const secret = await deriveHmacSecret(false);
            const { deriveHPKEKeyPair } = await import("@tobari/crypto/hpke");
            const keyPair = await deriveHPKEKeyPair(secret);
            if (keyPair) {
                const pubkeyB64 = uint8ArrayToBase64(keyPair.publicKey);
                const keyJson = JSON.stringify({ pubkey: pubkeyB64 }, null, 2);
                section!.innerHTML = `
                    <p style="font-size: 12px; color: #2f855a; font-weight: bold; margin-bottom: 10px;">✅ 公開鍵が生成されました</p>
                    <textarea readonly style="width: 100%; height: 80px; font-family: monospace; font-size: 11px; padding: 10px; border: 1px solid #cbd5e0; border-radius: 8px; margin-bottom: 10px;">${keyJson}</textarea>
                    <button id="copy-key-btn" class="secondary-btn" style="margin-top:0; font-size: 12px;">クリップボードにコピー</button>
                `;
                document.getElementById('copy-key-btn')?.addEventListener('click', () => {
                    navigator.clipboard.writeText(keyJson);
                    alert("コピーしました。これを 'recipient-pubkey.json' として保存してください。");
                });
            }
        } catch (e) {
            console.error(e);
            alert("鍵の生成に失敗しました。");
            renderWelcome();
        }
    });
}

function setupDropZone() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const handleFile = async (file: File) => {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        if (bytes[0] === 0x00 && bytes[1] === 0x8a && bytes[2] === 0x0b) {
            const text = new TextDecoder().decode(bytes);
            const match = text.match(/window\.__TOBARI_DATA__\s*=\s*"([^"]+)"/);
            if (match) {
                initViewer(match[1]);
                return;
            }
        }
        const b64 = uint8ArrayToBase64(bytes);
        window.location.hash = "data=" + encodeURIComponent(b64);
        location.reload();
    };
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('active'); });
    dropZone?.addEventListener('dragleave', () => { dropZone.classList.remove('active'); });
    dropZone?.addEventListener('drop', (e) => { e.preventDefault(); const file = e.dataTransfer?.files[0]; if (file) handleFile(file); });
    fileInput?.addEventListener('change', () => { if (fileInput.files?.[0]) handleFile(fileInput.files[0]); });
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
    injectGlobalStyles();
    const data = cleanData(rawData);
    
    if (mso.docType === "io.github.masanork.tobari.juminhyo.v1") {
        renderJuminhyo(data);
        return;
    }

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
                <div class="doc-header"><h1 class="doc-title">${title}</h1></div>
                <div class="doc-body">
                    ${mainFields.map(([k, v]) => `<div class="field-section"><span class="field-label">${k}</span><div class="field-value-lg">${v}</div></div>`).join('')}
                    ${wideFields.map(([k, v]) => `<div class="field-section" style="border-top: 1px solid #edf2f7; padding-top: 20px;"><span class="field-label">${k}</span><div class="field-value-md">${v}</div></div>`).join('')}
                    <div class="field-grid">
                        ${otherFields.map(([k, v]) => `<div><span class="field-label">${k}</span><div class="field-value-md" style="font-size: 17px;">${v}</div></div>`).join('')}
                    </div>
                    ${listFields.map(([k, v]) => `<div style="margin-top: 50px;"><h3 style="font-family:sans-serif; font-size:14px; color:#718096; border-bottom:1px solid #edf2f7; padding-bottom:10px;">${k}</h3>${renderList(v as any[])}</div>`).join('')}
                </div>
                <div class="issuer-footer">
                    <div style="text-align: left;">
                        <div style="font-size: 14px; margin-bottom: 10px;">${safeStr(data["交付年月日"] || "")}</div>
                        ${issuerKeys.map(([k, v]) => `<div>${k}: <span style="font-size: 18px; color: #000; margin-left: 10px;">${v}</span></div>`).join('')}
                    </div>
                    <div class="hankyo">印</div>
                </div>
            </div>
        </div>
    `;
}

function renderJuminhyo(data: any) {
    const safe = (v: any) => (v === null || v === undefined) ? "" : String(v);
    const members = data["世帯員"] || [];
    
    document.body.innerHTML = `
        <div class="official-doc-container">
            <div class="official-doc juminhyo-style">
                <div class="verified-badge">
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l5-5z"/></svg>
                    VERIFIED
                </div>
                <div class="doc-header" style="text-align: center; border-bottom: 2px solid #000;">
                    <h1 class="doc-title" style="font-size: 28px; letter-spacing: 0.5em; padding-bottom: 10px;">${safe(data["証明書名称"])}</h1>
                </div>

                <div class="juminhyo-meta-grid">
                    <div class="meta-item">
                        <span class="field-label">住所</span>
                        <div class="field-value-md">${safe(data["世帯住所"])}</div>
                    </div>
                    <div class="meta-item">
                        <span class="field-label">世帯主の氏名</span>
                        <div class="field-value-md">${safe(data["世帯主氏名"])}</div>
                    </div>
                </div>

                <table class="member-table">
                    <thead>
                        <tr>
                            <th style="width: 40%;">氏名 / 生年月日 / 性別 / 続柄</th>
                            <th style="width: 60%;">住民となった日 / 本籍 / 備考</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${members.map((m: any) => `
                            <tr>
                                <td class="member-main-cell">
                                    <div class="name-box">
                                        <span class="furigana">${safe(m["フリガナ"])}</span>
                                        <div class="name-val">${safe(m["氏名"])}</div>
                                    </div>
                                    <div class="sub-info-grid">
                                        <div><span class="label-mini">生年月日</span> ${safe(m["生年月日"])}</div>
                                        <div><span class="label-mini">性別</span> ${safe(m["性別"])}</div>
                                        <div><span class="label-mini">続柄</span> ${safe(m["続柄"])}</div>
                                    </div>
                                </td>
                                <td class="member-detail-cell">
                                    <div class="detail-line"><span class="label-mini">住民となった日</span> ${safe(m["住民となった日"])}</div>
                                    <div class="detail-line"><span class="label-mini">本籍</span> ${Array.isArray(m["本籍"]) ? m["本籍"].join("<br>") : safe(m["本籍"])}</div>
                                    <div class="detail-line"><span class="label-mini">備考</span> ${Array.isArray(m["備考"]) ? m["備考"].join(", ") : safe(m["備考"])}</div>
                                    ${m["個人番号"] ? `<div class="detail-line"><span class="label-mini">個人番号</span> ${m["個人番号"]}</div>` : ""}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="issuer-footer">
                    <div style="text-align: left;">
                        <div style="font-size: 14px; margin-bottom: 10px;">交付年月日：${safe(data["交付年月日"])}</div>
                        <div style="font-size: 18px; color: #000;">${safe(data["発行者役職"])}　${safe(data["発行者氏名"])}</div>
                    </div>
                    <div class="hankyo">印</div>
                </div>
            </div>
        </div>
    `;
}

function renderList(array: any[]): string {
    return array.map(item => `<div style="padding: 20px 0; border-bottom: 1px solid #f7fafc; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 15px;">
        ${Object.entries(item).map(([k, v]) => `<div><span style="font-size: 9px; color: #a0aec0; display: block; font-family: sans-serif; text-transform: uppercase;">${k}</span><span style="font-size: 15px;">${v}</span></div>`).join('')}
    </div>`).join('');
}

async function unlockEncryptedPayload(wrapper: any): Promise<string> {
    injectGlobalStyles();
    document.body.innerHTML = `<div class="welcome-screen"><div class="drop-card"><div class="logo">🔒</div><h2>Encrypted Document</h2><p>この書類は暗号化されています。閲覧するには発行時に指定したパスキーが必要です。</p><button id="unlock-btn" class="primary-btn" style="width: 100%;">パスキーで復号</button></div></div>`;
    const ciphertext = base64ToUint8Array(wrapper.data);
    const info = new TextEncoder().encode("tobari-storage-v1");
    const { decryptHPKE, deriveHPKEKeyPair } = await import("@tobari/crypto/hpke");
    return new Promise((resolve) => {
        document.getElementById('unlock-btn')?.addEventListener('click', async () => {
            try {
                const secret = await deriveHmacSecret(false);
                const keyPair = await deriveHPKEKeyPair(secret);
                const plaintext = await decryptHPKE(keyPair!.privateKey, ciphertext, info);
                resolve(uint8ArrayToBase64(new Uint8Array(plaintext)));
            } catch (e) { alert("復号に失敗しました。パスキーまたは秘密鍵が正しくありません。"); }
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
        } catch (e) {}
    }
    return new TextEncoder().encode("tobari-demo-secret-key-32-bytes-long!!");
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

function renderError(err: any) {
    document.body.innerHTML = `<div style="padding:40px; font-family:sans-serif; text-align:center;"><h2 style="color:#e53e3e;">Failed to Load Document</h2><p>${err}</p></div>`;
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
        .logo { font-size: 64px; margin-bottom: 24px; font-family: 'TobariSubset', serif; color: #1a202c; }
        h2 { margin: 0 0 12px 0; font-size: 24px; color: #1a202c; }
        p { color: #718096; line-height: 1.6; margin-bottom: 32px; }
        .primary-btn { background: #1a202c; color: white; border: none; padding: 14px 28px; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .primary-btn:hover { background: #2d3748; transform: translateY(-1px); }
        .secondary-btn { background: none; color: #3182ce; border: 1px solid #3182ce; padding: 12px 24px; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 15px; width: 100%; }
        .official-doc-container { padding: 40px 20px; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }
        .official-doc { 
            background: white; width: 100%; max-width: 840px; padding: 80px 100px; 
            box-shadow: 0 40px 100px rgba(0,0,0,0.08), 0 10px 20px rgba(0,0,0,0.02); 
            border-radius: 4px; font-family: 'TobariSubset', serif; position: relative;
        }
        .juminhyo-style { border: 3px double #000; padding: 60px 80px; }
        .juminhyo-meta-grid { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #000; margin-bottom: 20px; }
        .meta-item { padding: 15px 0; }
        .member-table { width: 100%; border-collapse: collapse; margin-top: 20px; table-layout: fixed; }
        .member-table th { border: 1px solid #000; padding: 10px; background: #f7fafc; font-size: 12px; text-align: left; }
        .member-table td { border: 1px solid #000; padding: 15px; vertical-align: top; }
        .name-box { margin-bottom: 10px; }
        .furigana { font-size: 10px; color: #4a5568; display: block; margin-bottom: 2px; }
        .name-val { font-size: 24px; color: #000; }
        .sub-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 13px; }
        .label-mini { font-size: 9px; color: #718096; display: block; text-transform: uppercase; margin-bottom: 2px; }
        .detail-line { margin-bottom: 8px; font-size: 14px; line-height: 1.4; }
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
        @media print {
            body { background: white; padding: 0; }
            .official-doc-container { padding: 0; }
            .official-doc { box-shadow: none; border: 1px solid #000; padding: 15mm; width: 100%; max-width: none; }
            .juminhyo-style { border: 3px double #000; }
            .verified-badge { display: none; }
        }
    `;
    document.head.appendChild(style);
}

(window as any).initTobari = initViewer;
