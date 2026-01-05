import { verifyTobari } from './validator';
import { revealSdData } from './sd';

export async function handleFile(file: File, issuerPublicKey: CryptoKey) {
    const text = await file.text();
    let dataToVerify: string | Uint8Array;

    if (file.name.endsWith('.html')) {
        const match = text.match(/window\.__TOBARI_DATA__ = "(data:application\/cbor;base64,[^"]+)"/);
        if (!match) {
            const legacyMatch = text.match(/const TOBARI_DATA = "(data:application\/cbor;base64,[^"]+)"/);
            if (!legacyMatch) throw new Error("HTMLファイル内に Tobari バイナリが見つかりません。");
            dataToVerify = legacyMatch[1];
        } else {
            dataToVerify = match[1];
        }
    } else {
        const buffer = await file.arrayBuffer();
        dataToVerify = new Uint8Array(buffer);
    }

    const result = await verifyTobari(dataToVerify, issuerPublicKey);
    if (result.isValid) {
        (result as any).revealedData = await revealSdData(result.payload.data, result.payload.disclosures || []);
    }
    return result;
}

export function setupUI(issuerPublicKey: CryptoKey) {
    const dropZone = document.getElementById('drop-zone')!;
    const fileInput = document.getElementById('file-input') as HTMLInputElement;

    const onFile = async (file: File) => {
        try {
            const result = await handleFile(file, issuerPublicKey);
            showResult(result);
        } catch (e: any) {
            showResult({ isValid: false, error: e.message, header: null, payload: null });
        }
    };

    dropZone.onclick = () => fileInput.click();
    fileInput.onchange = () => fileInput.files?.[0] && onFile(fileInput.files[0]);
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
    dropZone.ondragleave = () => dropZone.classList.remove('dragover');
    dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer?.files[0];
        if (file) onFile(file);
    };
}

function showResult(res: any) {
    const card = document.getElementById('result-card')!;
    const icon = document.getElementById('status-icon')!;
    const statusText = document.getElementById('status-text')!;
    card.style.display = 'block';

    if (res.isValid) {
        icon.textContent = "✓";
        icon.className = "status-icon is-valid";
        statusText.textContent = "整合性確認：真正";
        statusText.className = "status-text is-valid";

        document.getElementById('alg')!.textContent = res.header[1] === -35 ? "ES384 (ECDSA P-384)" : "Unknown " + res.header[1];
        document.getElementById('schema-id')!.textContent = res.payload.schema_id;
        document.getElementById('created-at')!.textContent = new Date(res.payload.created_at * 1000).toLocaleString();
        document.getElementById('payload-view')!.innerHTML = renderTree(res.revealedData, 0);
    } else {
        icon.textContent = "✕";
        icon.className = "status-icon is-invalid";
        statusText.textContent = "整合性確認：失敗（改ざんの可能性があります）";
        statusText.className = "status-text is-invalid";
        document.getElementById('payload-view')!.textContent = "エラー詳細: " + res.error;
    }
}

function renderTree(obj: any, indent: number): string {
    const spaces = '&nbsp;'.repeat(indent * 2);
    if (Array.isArray(obj)) {
        if (obj.length === 0) return '[]';
        return '[\n' + obj.map(item => '  ' + spaces + renderTree(item, indent + 1)).join(',\n') + '\n' + spaces + ']';
    } else if (obj !== null && typeof obj === 'object') {
        if (obj.hasOwnProperty('@disclosed')) {
            if (obj['@disclosed']) {
                return `<span class="disclosed">● ${JSON.stringify(obj['@value'])}</span>`;
            } else {
                return `<span class="undisclosed">○ （非開示）</span>`;
            }
        }
        const entries = Object.entries(obj);
        return '{\n' + entries.map(([k, v]) => `${spaces}  <span style="color: #4a5568;">"${k}"</span>: ${renderTree(v, indent + 1)}`).join(',\n') + '\n' + spaces + '}';
    }
    return JSON.stringify(obj);
}
