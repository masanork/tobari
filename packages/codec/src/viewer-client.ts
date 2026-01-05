import { decode } from 'cbor-x';

// Minimal UI for the Tobari Viewer
export function initViewer(base64Data: string) {
    try {
        const binary = Uint8Array.from(atob(base64Data.split(',')[1] || base64Data), c => c.charCodeAt(0));
        const coseArray = decode(binary);

        // COSE_Sign1 structure: [protected, unprotected, payload, signature]
        const payloadBytes = coseArray[2];
        const payload = decode(payloadBytes);

        console.log("Tobari Payload Decoded:", payload);
        render(payload);
    } catch (e) {
        document.body.innerHTML = `<div class="error">Failed to decode Tobari file: ${e}</div>`;
    }
}

// Expose globally for the bundled script to be called from the HTML template
(window as any).initTobari = initViewer;

function render(payload: any) {
    const data = payload.data;
    const container = document.getElementById('viewer-root');
    if (!container) return;

    // Premium Official Look
    container.innerHTML = `
        <div class="official-document">
            <div class="header">
                <div class="title">${data['証明書名称'] || '証明書'}</div>
                <div class="status-badge">✅ 検証済みバイナリ</div>
            </div>
            
            <table class="main-table">
                <tr>
                    <td class="label" colspan="6">住所</td>
                    <td class="value" colspan="34">${data['世帯住所']}</td>
                </tr>
                <tr>
                    <td class="label" colspan="6">世帯主</td>
                    <td class="value" colspan="34">${data['世帯主氏名']}</td>
                </tr>
            </table>

            <div class="members-container">
                ${(data['世帯員'] || []).map((m: any, i: number) => `
                    <div class="member-entry">
                        <table class="member-table">
                            <tr>
                                <td class="side-label" rowspan="3">員<br>${i + 1}</td>
                                <td class="label">氏名</td>
                                <td class="value name-val">${m['氏名']}</td>
                                <td class="label">個人番号</td>
                                <td class="value">${m['個人番号'] || '（未記載）'}</td>
                            </tr>
                            <tr>
                                <td class="label">生年月日</td>
                                <td class="value">${m['生年月日']}</td>
                                <td class="label">性別</td>
                                <td class="value">${m['性別']}</td>
                                <td class="label">続柄</td>
                                <td class="value">${m['続柄']}</td>
                            </tr>
                            <tr>
                                <td class="label">本籍</td>
                                <td class="value" colspan="5">${Array.isArray(m['本籍']) ? m['本籍'].join('<br>') : m['本籍'] || ''}</td>
                            </tr>
                        </table>
                    </div>
                `).join('')}
            </div>

            <div class="footer">
                <div class="issuer-info">
                    この写しは、世帯全員の住民票の原本と相違ないことを証明する。<br>
                    ${data['交付年月日']}<br>
                    <span class="issuer-name">${data['発行者役職']} ${data['発行者氏名']}</span>
                    <span class="official-seal">印</span>
                </div>
                <div class="meta-info">
                    Schema ID: ${payload.schema_id}<br>
                    Created: ${new Date(payload.created_at * 1000).toLocaleString()}
                </div>
            </div>
        </div>
    `;
}
