import { decode } from 'cbor-x';
import { revealMdocData, MSO } from './sd';
import { verifyTobari } from './validator';

// Minimal UI for the Tobari Viewer
let currentDebugData: any = null;

export async function initViewer(base64Data: string, issuerPublicKeyJwk?: any) {
    try {
        const binary = Uint8Array.from(atob(base64Data.split(',')[1] || base64Data), c => c.charCodeAt(0));

        const doc = decode(binary);
        const issuerAuthToken = doc.issuerSigned.issuerAuth;
        const coseArray = decode(issuerAuthToken);
        const mso = decode(coseArray[2]);

        // Cryptographic Verification
        let isSignatureValid = false;
        let verificationError = null;

        if (issuerPublicKeyJwk) {
            try {
                // Import the provided JWK
                const namedCurve = issuerPublicKeyJwk.crv || "P-384";
                const issuerKey = await crypto.subtle.importKey(
                    "jwk",
                    issuerPublicKeyJwk,
                    { name: "ECDSA", namedCurve: namedCurve },
                    true,
                    ["verify"]
                );
                // Verify the COSE signature
                const result = await verifyTobari(binary, issuerKey);
                isSignatureValid = result.isValid;
                if (!result.isValid) {
                    console.error("Signature verification details:", result.error);
                }
            } catch (e) {
                console.error("Signature verification failed with error:", e);
                verificationError = e;
            }
        } else {
            console.warn("No Issuer Public Key provided. Skipping signature verification.");
        }

        // Use the DocType/Schema ID as the namespace
        const namespace = mso.docType;
        const items = doc.issuerSigned.nameSpaces[namespace] || [];
        const disclosedData = await revealMdocData(mso, items, namespace);

        currentDebugData = { doc, mso, revealed: disclosedData, isSignatureValid };
        (window as any).currentDebugData = currentDebugData; // Expose for renderers

        // Render using the embedded template (if any) or auto-renderer
        render(doc, disclosedData, mso);

        // Show Signature Warning if needed
        if (issuerPublicKeyJwk && !isSignatureValid) {
            const warning = document.createElement('div');
            Object.assign(warning.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                background: '#e53e3e',
                color: 'white',
                padding: '12px',
                textAlign: 'center',
                fontWeight: 'bold',
                zIndex: '9999',
                boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
            });
            warning.textContent = `⚠️ SIGNATURE VALIDATION FAILED: This document may be forged or corrupted.`;
            document.body.prepend(warning);
        } else if (issuerPublicKeyJwk && isSignatureValid) {
            console.log("✅ Signature Verified Successfully.");
        }

        setupDebugUI();
    } catch (e) {
        document.body.innerHTML = `<div class="error">Failed to decode Tobari file: ${e}</div>`;
        console.error(e);
    }
}

function setupDebugUI() {
    if (document.getElementById('tobari-debug-btn')) return;

    // Only enable debug if ?debug=1 or similar is present
    const params = new URLSearchParams(window.location.search);
    const isDebug = params.get('debug') === '1' || params.get('tobari-debug') === 'true';
    if (!isDebug) return;

    const btn = document.createElement('div');
    btn.id = 'tobari-debug-btn';
    btn.innerHTML = 'DEBUG';
    Object.assign(btn.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        background: '#2d3748',
        color: 'white',
        padding: '8px 16px',
        borderRadius: '100px',
        fontSize: '12px',
        fontWeight: 'bold',
        cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        zIndex: '10000',
        transition: 'all 0.2s',
        fontFamily: 'sans-serif'
    });
    btn.onmouseover = () => btn.style.background = '#4a5568';
    btn.onmouseout = () => btn.style.background = '#2d3748';

    const panel = document.createElement('div');
    panel.id = 'tobari-debug-panel';
    Object.assign(panel.style, {
        position: 'fixed',
        top: '0',
        right: '-500px',
        width: '500px',
        height: '100vh',
        background: '#1a202c',
        color: '#e2e8f0',
        padding: '30px',
        boxShadow: '-10px 0 30px rgba(0,0,0,0.3)',
        zIndex: '10001',
        overflowY: 'auto',
        transition: 'right 0.3s ease-in-out',
        fontFamily: 'monospace',
        fontSize: '13px'
    });

    panel.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="margin: 0; color: #63b3ed;">Tobari Data Inspector (mdoc mode)</h3>
            <span id="close-debug" style="cursor: pointer; font-size: 20px;">&times;</span>
        </div>
        <div style="margin-bottom: 20px;">
            <div style="color: #a0aec0; margin-bottom: 8px; font-weight: bold;">[IssuerSigned Envelope]</div>
            <pre style="background: #2d3748; padding: 15px; border-radius: 8px; overflow-x: auto;">${JSON.stringify(currentDebugData?.doc, null, 2)}</pre>
        </div>
        <div style="margin-bottom: 20px;">
            <div style="color: #a0aec0; margin-bottom: 8px; font-weight: bold;">[Mobile Security Object]</div>
            <pre style="background: #2d3748; padding: 15px; border-radius: 8px; overflow-x: auto;">${JSON.stringify(currentDebugData?.mso, null, 2)}</pre>
        </div>
        <div>
            <div style="color: #a0aec0; margin-bottom: 8px; font-weight: bold;">[Revealed Data]</div>
            <pre style="background: #2d3748; padding: 15px; border-radius: 8px; overflow-x: auto;">${JSON.stringify(currentDebugData?.revealed, null, 2)}</pre>
        </div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    let isOpen = false;
    const toggle = () => {
        isOpen = !isOpen;
        panel.style.right = isOpen ? '0' : '-500px';
        btn.style.opacity = isOpen ? '0' : '1';
    };

    btn.onclick = toggle;
    document.getElementById('close-debug')!.onclick = toggle;

    // Keyboard shortcut 'D'
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'd' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            toggle();
        }
    });
}

// Minimal Template Engine (Supporting {{key}}, {{#each}}, {{#join}})
function simpleTemplate(template: string, data: any, mso: MSO): string {
    let result = template;

    const getValue = (expression: string, currentContext: any): any => {
        const key = expression.trim();
        if (key === "@index") return currentContext["@index"];

        const fullContext = {
            ...data,
            schema_id: mso.docType,
            created_at: new Date(mso.validityInfo.signed).toLocaleString()
        };

        let val = key.split('.').reduce((o: any, i: any) => o?.[i], currentContext);
        if (val === undefined) {
            val = key.split('.').reduce((o: any, i: any) => o?.[i], fullContext);
        }
        return val;
    };

    result = result.replace(/{{#each ([^}]+)}}([\s\S]*?){{\/each}}/g, (_, key, block) => {
        const rawList = getValue(key, data);
        const list = (rawList && typeof rawList === 'object' && rawList.hasOwnProperty('@disclosed'))
            ? (rawList['@disclosed'] ? rawList['@value'] : [])
            : rawList;

        if (!Array.isArray(list)) return '';
        return list.map((item, index) => {
            return simpleTemplate(block, { ...item, ["@index"]: index }, mso);
        }).join('');
    });

    result = result.replace(/{{#join ([^}]+)}}([\s\S]*?){{\/join}}/g, (_, key, separator) => {
        const rawList = getValue(key, data);
        const list = (rawList && typeof rawList === 'object' && rawList.hasOwnProperty('@disclosed'))
            ? (rawList['@disclosed'] ? rawList['@value'] : [])
            : rawList;

        if (!Array.isArray(list)) return '';
        return list.map(v => formatValue(v)).join(separator);
    });

    result = result.replace(/{{([^{}]+)}}/g, (_, expression) => {
        return formatValue(getValue(expression, data));
    });

    return result;
}

// Standard Auto-Renderer for Web-optimized viewing
function autoRender(data: any, fieldsMeta: any[], mso: MSO): string {
    const renderSection = (title: string, content: string) => `
        <section style="margin-bottom: 30px;">
            <h2 style="font-size: 18px; border-left: 4px solid #3182ce; padding-left: 12px; margin-bottom: 20px; color: #2d3748;">${title}</h2>
            ${content}
        </section>
    `;

    const renderKeyValue = (label: string, value: any) => `
        <div style="display: flex; border-bottom: 1px solid #edf2f7; padding: 12px 0; align-items: baseline;">
            <div style="width: 160px; font-size: 14px; color: #718096; flex-shrink: 0;">${label}</div>
            <div style="font-size: 16px; color: #1a202c; flex-grow: 1;">${formatValue(value)}</div>
        </div>
    `;

    const renderGroup = (groupData: any, subFields: any[]): string => {
        if (!groupData) return '<div style="color: #cbd5e0;">(No Data)</div>';
        return `
            <div style="background: #f7fafc; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0;">
                ${subFields.map(f => {
            const val = groupData[f.id];
            let displayVal = val;
            if (val && typeof val === 'object' && val.hasOwnProperty('@disclosed')) {
                displayVal = val['@disclosed'] ? val['@value'] : null;
            }
            if (displayVal === null && val && val.hasOwnProperty('@disclosed')) {
                // Hidden case
                return renderKeyValue(f.label || f.id, val);
            }
            if (f.type === 'group' && f.fields) {
                // Recursive group
                return `
                            <div style="margin-top: 12px; margin-bottom: 12px;">
                                <div style="font-size: 14px; color: #718096; margin-bottom: 8px;">${f.label || f.id}</div>
                                ${renderGroup(displayVal, f.fields)}
                            </div>
                         `;
            }
            return renderKeyValue(f.label || f.id, val);
        }).join('')}
            </div>
        `;
    };

    const renderCard = (items: any[], subFields: any[]) => {
        const primaryField = subFields?.find((f: any) => f.primary);

        return `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px;">
            ${items.map((item, i) => {
            const primaryValue = primaryField ? item[primaryField.id] : null;

            return `
                <div style="background: #f7fafc; border-radius: 12px; padding: 24px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                    ${primaryValue ? `
                        <div style="margin-bottom: 20px; border-bottom: 2px solid #3182ce; padding-bottom: 12px;">
                            <div style="font-size: 11px; color: #3182ce; font-weight: bold; text-transform: uppercase; margin-bottom: 4px;">${primaryField.label || primaryField.id}</div>
                            <div style="font-size: 24px; font-weight: 800; color: #1a202c;">${formatValue(primaryValue)}</div>
                        </div>
                    ` : `<div style="font-weight: bold; margin-bottom: 15px; color: #a0aec0;">#${i + 1}</div>`}
                    
                    <div style="display: grid; gap: 12px;">
                    ${subFields?.filter((f: any) => !f.primary).map((f: any) => {
                const val = item[f.id];
                if (val === undefined) return '';
                return `
                                    <div>
                                        <div style="font-size: 11px; color: #a0aec0; text-transform: uppercase; margin-bottom: 2px;">${f.label || f.id}</div>
                                        <div style="font-size: 14px; color: #2d3748;">${formatValue(val)}</div>
                                    </div>
                                `;
            }).join('') || ''}
                    </div>
                </div>
                `;
        }).join('')}
        </div>`;
    };

    let html = `
        <div style="max-width: 1000px; margin: 0 auto; width: 100%;">
            <header style="text-align: center; margin-bottom: 50px;">
    `;

    fieldsMeta.filter((f: any) => f.section === 'header').forEach((field: any) => {
        const val = data[field.id];
        if (val !== undefined) {
            html += `<h1 style="font-size: 32px; font-weight: 900; color: #1a202c; margin-bottom: 12px; letter-spacing: -0.02em;">${formatValue(val)}</h1>`;
        }
    });

    html += `
                <div style="display: inline-flex; align-items: center; background: #ebf8ff; color: #3182ce; padding: 6px 16px; border-radius: 100px; font-size: 13px; font-weight: 700; border: 1px solid #bee3f8;">
                    DocType: ${mso.docType} (ISO 18013-5 compatible)
                </div>
            </header>
    `;

    fieldsMeta.filter((f: any) => !f.section || f.section === 'subject').forEach((field: any) => {
        const val = data[field.id];
        // Skip if undefined, unless it's a group which might be partially disclosed or structured
        if (val === undefined && field.type !== 'group') {
            if (field.id === "証明書名称") return;
            // return; // Don't return, let it render as empty or check logic
        }

        let actualValue = val;
        if (val && typeof val === 'object' && val.hasOwnProperty('@disclosed')) {
            actualValue = (val as any)['@disclosed'] ? (val as any)['@value'] : null;
        }

        if (field.type === 'group' && field.fields) {
            html += renderSection(field.id, renderGroup(actualValue, field.fields));
        } else if (Array.isArray(actualValue)) {
            if (field.items?.fields) {
                // Array of Objects (Cards)
                html += renderSection(field.id, renderCard(actualValue, field.items.fields));
            } else {
                // Simple Array of Strings/Numbers
                html += renderKeyValue(field.id, val);
            }
        } else {
            if (val !== undefined) {
                html += renderKeyValue(field.id, val);
            }
        }
    });

    const footerFields = fieldsMeta.filter((f: any) => f.section === 'footer');
    if (footerFields.length > 0) {
        html += `
            <div style="margin-top: 60px; padding: 30px; background: #fff; border: 2px solid #edf2f7; border-radius: 16px; position: relative;">
                <div style="font-size: 14px; font-weight: 800; color: #4a5568; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #edf2f7; padding-bottom: 10px;">
                    発行者情報
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    ${footerFields.map((f: any) => `
                        <div>
                            <div style="font-size: 11px; color: #a0aec0; text-transform: uppercase;">${f.id}</div>
                            <div style="font-size: 16px; color: #2d3748; font-weight: 600;">${formatValue(data[f.id])}</div>
                        </div>
                    `).join('')}
                </div>
                <div style="position: absolute; right: 30px; bottom: 20px; width: 60px; height: 60px; border: 3px double #3182ce; border-radius: 50%; opacity: 0.1; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #3182ce; font-size: 20px;">印</div>
            </div>
        `;
    }

    html += `
            <footer style="margin-top: 40px; padding: 40px 0; text-align: center; font-size: 12px; color: #cbd5e0;">
                <div style="margin-bottom: 8px; font-weight: bold; font-family: sans-serif !important;">DIGITALLY SIGNED & VERIFIED (ISO 18013-5 MSO)</div>
                <div style="margin-bottom: 4px;">Signed at: ${new Date(mso.validityInfo.signed).toLocaleString()}</div>
                <div>Algorithm: ES384 / MSO Version: ${mso.version} / Powered by Tobari</div>
            </footer>
        </div>
    `;

    return html;
}

function formatValue(v: any): string {
    if (v && typeof v === 'object') {
        if (v.hasOwnProperty('@error')) {
            return `<span style="display: inline-flex; align-items: center; background: #fff5f5; color: #c53030; font-size: 14px; padding: 4px 8px; border-radius: 4px; border: 1px solid #feb2b2; font-weight: bold;">
                <span style="margin-right: 4px;">⚠️</span> ${v['@error']} (Tampered)
            </span>`;
        }
        if (v.hasOwnProperty('@disclosed')) {
            if (!(v as any)['@disclosed']) {
                return `<span style="display: inline-flex; align-items: center; background: #edf2f7; color: #718096; font-size: 12px; padding: 2px 8px; border-radius: 4px; border: 1px solid #e2e8f0;">
                    <span style="margin-right: 4px;">🔒</span> 非開示 (Hidden)
                </span>`;
            }
            v = (v as any)['@value'];
        }
        if (!Array.isArray(v)) {
            const json = JSON.stringify(v, null, 2);
            return `<pre style="margin: 0; padding: 10px 12px; background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; line-height: 1.4; white-space: pre-wrap;">${escapeHtml(json)}</pre>`;
        }
    }

    if (v === undefined || v === null) return '-';
    if (Array.isArray(v)) return v.join('、');
    return String(v);
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderBankCertificate(data: any, mso: any): string {
    const getValue = (key: string) => {
        const val = data[key];
        if (val && typeof val === 'object' && val.hasOwnProperty('@disclosed')) {
            return val['@disclosed'] ? val['@value'] : '******';
        }
        return val || '-';
    };

    const logoSvg = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="40" height="40" rx="8" fill="#0052CC"/>
<path d="M20 8L10 24H30L20 8Z" fill="white"/>
<rect x="12" y="26" width="16" height="4" fill="white"/>
</svg>`;

    return `
        <div style="font-family: 'Hiragino Mincho ProN', 'Yu Mincho', serif; color: #333; max-width: 800px; margin: 0 auto; position: relative; padding: 40px; background: #fff; border: 1px solid #ddd; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
            
            <!-- Watermark -->
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 80px; color: rgba(0,0,0,0.03); font-weight: bold; pointer-events: none; white-space: nowrap; z-index: 0;">
                DIGITAL BANK
            </div>

            <div style="position: relative; z-index: 1;">
                <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0052CC; padding-bottom: 20px; margin-bottom: 40px;">
                    <div style="display: flex; align-items: center; gap: 15px;">
                        ${logoSvg}
                        <div>
                            <div style="font-size: 24px; font-weight: bold; color: #0052CC; letter-spacing: 0.05em;">${getValue('bank_name')}</div>
                            <div style="font-size: 11px; color: #666;">Digital Bank, Ltd.</div>
                        </div>
                    </div>
                    <div style="text-align: right; font-size: 12px; color: #666;">
                        <div>発行日: ${getValue('issue_date')}</div>
                        <div>管理番号: ${mso.docType.split('.').pop()}-${new Date(mso.validityInfo.signed).getTime().toString().slice(-6)}</div>
                    </div>
                </div>

                <div style="text-align: center; margin-bottom: 50px;">
                    <h1 style="font-size: 32px; font-weight: 500; letter-spacing: 0.2em; border-bottom: 1px solid #333; display: inline-block; padding-bottom: 5px; margin-bottom: 10px;">残高証明書</h1>
                    <div style="font-size: 12px; color: #666;">CERTIFICATE OF BALANCE</div>
                </div>

                <div style="margin-bottom: 40px;">
                    <div style="font-size: 14px; margin-bottom: 10px;">　下記口座の残高は、証明日現在において次のとおりであることを証明します。</div>
                    <div style="font-size: 18px; font-weight: bold; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-bottom: 20px;">
                        ${getValue('account_holder')} 様
                    </div>
                </div>

                <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px;">
                    <thead>
                        <tr style="background: #f5f7fa; color: #444; font-size: 12px;">
                            <th style="padding: 12px; border: 1px solid #ccc; font-weight: normal;">支店名</th>
                            <th style="padding: 12px; border: 1px solid #ccc; font-weight: normal;">預金種目</th>
                            <th style="padding: 12px; border: 1px solid #ccc; font-weight: normal;">口座番号</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="text-align: center; font-size: 16px;">
                            <td style="padding: 15px; border: 1px solid #ccc;">${getValue('branch_name')}</td>
                            <td style="padding: 15px; border: 1px solid #ccc;">${getValue('account_type')}</td>
                            <td style="padding: 15px; border: 1px solid #ccc;">${getValue('account_number')}</td>
                        </tr>
                    </tbody>
                </table>

                <div style="background: #f9fbfd; padding: 25px; border: 2px solid #e1e7f0; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 60px;">
                    <div style="font-size: 14px; font-weight: bold; color: #4a5568;">証明日現在残高</div>
                    <div style="font-size: 36px; font-weight: bold; color: #1a202c; letter-spacing: 0.05em; font-family: 'Helvetica Neue', Arial, sans-serif;">
                        ${getValue('balance')}
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; margin-top: 60px; position: relative;">
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">${getValue('bank_name')}</div>
                        <div style="font-size: 14px;">${getValue('branch_name')}</div>
                        <div style="position: absolute; top: -15px; right: 10px; width: 60px; height: 60px; border: 2px solid #c53030; border-radius: 50%; color: #c53030; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; transform: rotate(-10deg); opacity: 0.8; border-style: double;">
                            <div style="border: 1px solid #c53030; border-radius: 50%; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
                                済
                            </div>
                        </div>
                    </div>
                </div>

                <footer style="margin-top: 60px; border-top: 1px dotted #ccc; padding-top: 20px; font-size: 10px; color: #999; text-align: center;">
                   This document is digitally signed and verifiable. Powered by Tobari (ISO 18013-5 mdoc).
                </footer>
            </div>
        </div>
    `;
}


function renderStatement(data: any, fieldsMeta: any[], mso: any): string {
    const getValue = (key: string) => {
        const val = data[key];
        if (val && typeof val === 'object' && val.hasOwnProperty('@disclosed')) {
            return val['@disclosed'] ? val['@value'] : '******';
        }
        return val !== undefined ? val : '-';
    };

    const formatMoney = (val: any) => {
        if (typeof val === 'number') return val.toLocaleString() + '円';
        if (typeof val === 'string' && !isNaN(Number(val))) return Number(val).toLocaleString() + '円';
        return val;
    };

    // Extract sections
    const headerFields = fieldsMeta.filter(f => f.section === 'header');
    const footerFields = fieldsMeta.filter(f => f.section === 'footer');
    // Primary field usually Subject Name
    const primaryField = fieldsMeta.find(f => f.primary);

    // Find the main list (array) field for the statement details
    const listField = fieldsMeta.find(f =>
        (f.id.includes('利用明細') || f.id.includes('明細') || f.type === 'array') &&
        data[f.id] && Array.isArray(data[f.id])
    ) || fieldsMeta.find(f => f.type === 'array');

    const details = listField ? (
        Array.isArray(getValue(listField.id)) ? getValue(listField.id) : []
    ) : [];

    // Other fields (Summary info)
    const summaryFields = fieldsMeta.filter(f =>
        !f.section && !f.primary && f !== listField && f.type !== 'array' && f.type !== 'group'
    );

    const logo = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2b6cb0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`;

    // CSS for responsive design
    const css = `
    <style>
        .stmt-container {
            font-family: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif;
            max-width: 900px;
            margin: 0 auto;
            background: #fff;
            color: #333;
            overflow: hidden;
            /* No shadow/border here as the parent container has it, but we can reset if needed */
        }
        .stmt-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding-bottom: 20px;
            border-bottom: 2px solid #edf2f7;
            margin-bottom: 30px;
            flex-wrap: wrap;
            gap: 20px;
        }
        .stmt-brand {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .stmt-title {
            font-size: 24px;
            font-weight: bold;
            color: #2c5282;
            margin: 0;
        }
        .stmt-meta {
            text-align: right;
            font-size: 13px;
            color: #718096;
        }
        .stmt-bill-to {
            margin-bottom: 30px;
        }
        .stmt-recipient {
            font-size: 22px;
            font-weight: bold;
            color: #1a202c;
        }
        
        .stmt-summary {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 40px;
            background: #f7fafc;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
        }
        .stmt-summary-item {
            display: flex;
            flex-direction: column;
        }
        .stmt-label {
            font-size: 11px;
            text-transform: uppercase;
            color: #a0aec0;
            font-weight: bold;
            margin-bottom: 4px;
        }
        .stmt-value {
            font-size: 16px;
            font-weight: 600;
            color: #2d3748;
        }
        .stmt-value.highlight {
            color: #2b6cb0;
            font-size: 20px;
        }

        /* Responsive Table */
        .stmt-table-wrapper {
            width: 100%;
            overflow-x: auto;
            margin-bottom: 40px;
        }
        .stmt-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }
        .stmt-table th {
            text-align: left;
            padding: 12px 15px;
            border-bottom: 2px solid #e2e8f0;
            color: #4a5568;
            font-weight: 600;
            white-space: nowrap;
        }
        .stmt-table td {
            padding: 12px 15px;
            border-bottom: 1px solid #edf2f7;
            color: #2d3748;
        }
        .stmt-table tr:hover {
            background-color: #f7fafc;
        }
        .stmt-amount {
            text-align: right;
            font-family: "Menlo", "Monaco", monospace;
            font-weight: bold;
        }

        /* Mobile Card View for Table */
        @media (max-width: 600px) {
            .stmt-header {
                flex-direction: column;
                align-items: flex-start;
                text-align: left;
            }
            .stmt-meta {
                text-align: left;
            }
            .stmt-table thead {
                display: none;
            }
            .stmt-table, .stmt-table tbody, .stmt-table tr, .stmt-table td {
                display: block;
                width: 100%;
            }
            .stmt-table tr {
                margin-bottom: 15px;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 15px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }
            .stmt-table td {
                border-bottom: none;
                padding: 5px 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .stmt-table td::before {
                content: attr(data-label);
                font-size: 11px;
                text-transform: uppercase;
                font-weight: bold;
                color: #a0aec0;
                width: 40%;
            }
            .stmt-amount {
                text-align: right;
            }
        }

        .stmt-footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #edf2f7;
            font-size: 12px;
            color: #718096;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        @media (max-width: 600px) {
            .stmt-footer {
                grid-template-columns: 1fr;
            }
        }
    </style>
    `;

    // Render HTML
    let html = css + `<div class="stmt-container">`;

    // Header
    html += `
        <div class="stmt-header">
            <div class="stmt-brand">
                ${logo}
                <div>
                    <h1 class="stmt-title">${formatValue(getValue("明細書タイトル") || "ご利用明細書")}</h1>
                    <div style="font-size: 12px; color: #4a5568;">Web Statement</div>
                </div>
            </div>
            <div class="stmt-meta">
                ${headerFields.filter(f => f.id !== "明細書タイトル").map(f => `
                    <div><strong>${f.label || f.id}:</strong> ${formatValue(getValue(f.id))}</div>
                `).join('')}
                <div><strong>発行ID:</strong> ${mso.docType.split('.').pop()}-${new Date(mso.validityInfo.signed).getTime().toString().slice(-6)}</div>
            </div>
        </div>
    `;

    // Bill To
    if (primaryField) {
        html += `
            <div class="stmt-bill-to">
                <div style="font-size: 12px; color: #718096; margin-bottom: 4px;">ご請求先</div>
                <div class="stmt-recipient">${formatValue(getValue(primaryField.id))} 様</div>
            </div>
        `;
    }

    // Summary Grid
    if (summaryFields.length > 0) {
        html += `<div class="stmt-summary">`;
        summaryFields.forEach(f => {
            const val = getValue(f.id);
            const isMoney = f.type === 'integer' || f.id.includes('金額') || f.id.includes('枠');
            const displayVal = isMoney ? formatMoney(val) : formatValue(val);
            const highlight = f.id.includes('請求金額') || f.id.includes('支払') ? 'highlight' : '';

            html += `
                <div class="stmt-summary-item">
                    <div class="stmt-label">${f.label || f.id}</div>
                    <div class="stmt-value ${highlight}">${displayVal}</div>
                </div>
            `;
        });
        html += `</div>`;
    }

    // Transaction Table
    if (listField && details.length > 0) {
        const columns = listField.items?.fields || [];

        html += `<div class="stmt-table-wrapper"><table class="stmt-table">`;

        // Table Header
        html += `<thead><tr>`;
        columns.forEach((col: any) => {
            const align = col.type === 'integer' || col.id.includes('金額') ? 'text-align: right;' : '';
            html += `<th style="${align}">${col.label || col.id}</th>`;
        });
        html += `</tr></thead>`;

        // Table Body
        html += `<tbody>`;
        details.forEach((item: any) => {
            html += `<tr>`;
            columns.forEach((col: any) => {
                let val = item[col.id];
                // Handle selective disclosure in array items
                if (val && typeof val === 'object' && val.hasOwnProperty('@disclosed')) {
                    val = val['@disclosed'] ? val['@value'] : '******';
                }

                const isNum = col.type === 'integer' || col.id.includes('金額');
                const displayVal = isNum ? formatMoney(val) : formatValue(val);
                const className = isNum ? 'stmt-amount' : '';

                html += `<td data-label="${col.label || col.id}" class="${className}">${displayVal}</td>`;
            });
            html += `</tr>`;
        });
        html += `</tbody></table></div>`;
    } else if (listField) {
        html += `<div style="padding: 20px; text-align: center; color: #a0aec0; background: #f7fafc; border-radius: 8px;">明細データはありません</div>`;
    }

    // Footer
    if (footerFields.length > 0) {
        html += `<div class="stmt-footer">`;
        // Company Info
        html += `<div>`;
        footerFields.forEach(f => {
            html += `<div style="margin-bottom: 4px;"><strong>${formatValue(getValue(f.id))}</strong></div>`;
        });
        html += `</div>`;

        // System Info
        html += `<div style="text-align: right;">
            <div>Powered by Tobari (ISO 18013-5)</div>
            <div>Signed: ${new Date(mso.validityInfo.signed).toLocaleString()}</div>
        </div>`;

        html += `</div>`;
    }

    html += `</div>`; // End container
    return html;
}



function safeDateString(val: any): string {
    try {
        if (!val) return '-';
        const d = new Date(val);
        if (isNaN(d.getTime())) return String(val);
        return d.toLocaleString();
    } catch {
        return String(val);
    }
}

function safeIsoDate(val: any): string {
    try {
        if (!val) return '-';
        const d = new Date(val);
        if (isNaN(d.getTime())) return '-';
        return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    } catch {
        return '-';
    }
}

function renderIninjo(data: any, mso: any): string {
    const getValue = (key: string) => {
        let val = data[key];
        if (val && typeof val === 'object' && val.hasOwnProperty('@disclosed')) {
            val = val['@disclosed'] ? val['@value'] : null;
        }
        return val;
    };

    const formatVal = (v: any) => v || '-';

    const getGroupVal = (groupKey: string, fieldKey: string) => {
        const group = getValue(groupKey);
        if (!group) return '-';
        return formatVal(group[fieldKey]);
    };

    const provider = getValue('provider');

    // Access global debug data for signature status
    const isSigValid = (window as any).currentDebugData?.isSignatureValid;
    // Mock certificate info as we don't parse X.509 in client yet, or use provider info
    const signerInfo = provider ? `OU=${provider.serviceName}, O=${provider.serviceName}運営` : 'OU=電子委任状サービス, O=電子委任状株式会社';

    const mandator = getValue('mandator') || getValue('principal');
    const mandatary = getValue('mandatary') || getValue('agent');
    const authority = getValue('delegatedAuthority') || getValue('mandate');
    const validity = authority?.validityPeriod || getValue('validity');
    const acts = authority?.delegatedActs || authority?.items || getValue('scope');
    const subDelegation = authority?.subDelegation?.allocated ?? authority?.subdelegation;

    return `
        <div style="font-family: 'Hiragino Mincho ProN', 'Yu Mincho', serif; color: #1a202c; max-width: 800px; margin: 0 auto; padding: 60px; background: #fff; border: 1px solid #ddd; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
            
            <header style="text-align: center; margin-bottom: 60px; position: relative;">
                <h1 style="font-size: 32px; font-weight: 500; letter-spacing: 0.2em; border-bottom: 4px solid double #333; display: inline-block; padding-bottom: 5px; margin-bottom: 10px;">委任状</h1>
                <div style="position: absolute; right: 0; top: 0; text-align: right; font-size: 11px; color: #666; font-family: sans-serif;">
                    <div>Id: ${formatVal(getValue('id'))}</div>
                    <div>作成日時: ${formatVal(getValue('creationTime') || getValue('creation_date'))}</div>
                    <div>DocType: ${mso.docType.split('.').pop()}</div>
                </div>
            </header>

            <div style="font-size: 16px; margin-bottom: 40px; line-height: 1.8;">
                私は、下記の者を代理人と定め、次の権限を委任します。
            </div>

            <div style="display: flex; gap: 40px; margin-bottom: 40px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 300px;">
                    <h2 style="font-size: 16px; border-bottom: 1px solid #999; margin-bottom: 15px; padding-bottom: 5px;">委任者情報 (Mandator)</h2>
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr><td style="padding: 6px 0; color: #666; width: 80px;">種別</td><td style="padding: 6px 0;">${getValue('mandator')?.type === 'Individual' ? '個人' : '法人'}</td></tr>
                        ${mandator?.tradeName ? `<tr><td style="padding: 6px 0; color: #666;">屋号</td><td style="padding: 6px 0;">${formatVal(mandator.tradeName)}</td></tr>` : ''}
                        <tr><td style="padding: 6px 0; color: #666;">氏名</td><td style="padding: 6px 0; font-size: 18px; font-weight: bold;">${formatVal(mandator?.name)}</td></tr>
                        <tr><td style="padding: 6px 0; color: #666;">住所</td><td style="padding: 6px 0;">${formatVal(mandator?.address)}</td></tr>
                    </table>
                </div>

                <div style="flex: 1; min-width: 300px;">
                    <h2 style="font-size: 16px; border-bottom: 1px solid #999; margin-bottom: 15px; padding-bottom: 5px;">受任者情報 (Mandatary)</h2>
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr><td style="padding: 6px 0; color: #666; width: 80px;">識別名</td><td style="padding: 6px 0; font-size: 18px; font-weight: bold;">${formatVal(mandatary?.name)}</td></tr>
                         ${mandatary?.title ? `<tr><td style="padding: 6px 0; color: #666;">役職/肩書</td><td style="padding: 6px 0;">${formatVal(mandatary.title)}</td></tr>` : ''}
                        <tr><td style="padding: 6px 0; color: #666;">住所</td><td style="padding: 6px 0;">${formatVal(mandatary?.address)}</td></tr>
                         ${mandatary?.identificationId ? `<tr><td style="padding: 6px 0; color: #666;">識別ID</td><td style="padding: 6px 0;">${formatVal(mandatary.identificationId)}</td></tr>` : ''}
                    </table>
                </div>
            </div>

            <div style="margin-bottom: 40px;">
                <h2 style="font-size: 16px; border-bottom: 1px solid #999; margin-bottom: 15px; padding-bottom: 5px;">代理権情報</h2>
                <div style="background: #f9f9f9; padding: 20px; border-radius: 4px; border: 1px solid #eee;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                         <tr><td style="padding: 6px 0; color: #666; width: 140px;">電子委任状ID番号</td><td style="padding: 6px 0;">${formatVal(getValue('id'))}</td></tr>
                         <tr><td style="padding: 6px 0; color: #666; vertical-align: top;">代理権内容</td><td style="padding: 6px 0;">
                            <ol style="margin: 0; padding-left: 20px;">
                                ${Array.isArray(acts) ? acts.map((act: any) =>
        typeof act === 'string' ? `<li>${act}</li>` : `<li>${act.actName}${act.note ? ` (${act.note})` : ''}</li>`
    ).join('') : '<li>(なし)</li>'}
                            </ol>
                         </td></tr>
                         <tr><td style="padding: 6px 0; color: #666;">委任期間開始</td><td style="padding: 6px 0;">${formatVal(validity?.startDate || validity?.not_before)}</td></tr>
                         <tr><td style="padding: 6px 0; color: #666;">委任期間終了</td><td style="padding: 6px 0;">${formatVal(validity?.endDate || validity?.not_after)}</td></tr>
                    </table>
                </div>
            </div>

            ${provider ? `
            <div style="margin-bottom: 40px;">
                <h2 style="font-size: 16px; border-bottom: 1px solid #999; margin-bottom: 15px; padding-bottom: 5px;">事業者情報</h2>
                 <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                     <tr><td style="padding: 6px 0; color: #666; width: 140px;">事業者サービス名</td><td style="padding: 6px 0;">${formatVal(provider.serviceName)}</td></tr>
                     <tr><td style="padding: 6px 0; color: #666;">事業者ポリシー</td><td style="padding: 6px 0;"><a href="${provider.policyUrl}" target="_blank" style="color: #3182ce;">${formatVal(provider.policyUrl)}</a></td></tr>
                     <tr><td style="padding: 6px 0; color: #666;">有効性確認URL</td><td style="padding: 6px 0;"><a href="${provider.revocationUrl}" target="_blank" style="color: #3182ce;">${formatVal(provider.revocationUrl)}</a></td></tr>
                 </table>
            </div>
            ` : ''}

            <div style="background: #ebf8ff; padding: 20px; border: 1px solid #bee3f8; border-radius: 4px;">
                <h2 style="font-size: 16px; border-bottom: 1px solid #4299e1; margin-bottom: 15px; padding-bottom: 5px; color: #2b6cb0;">電子署名情報（電子委任状の電子署名検証結果）</h2>
                 <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                     <tr><td style="padding: 6px 0; color: #555; width: 140px; font-weight: bold;">検証結果</td><td style="padding: 6px 0; font-weight: bold; color: ${isSigValid ? '#2f855a' : '#c53030'};">
                        ${isSigValid ? '正常（改ざん等はありません）' : '検証失敗（署名の状態を確認してください）'}
                     </td></tr>
                     <tr><td style="padding: 6px 0; color: #555; font-weight: bold;">署名証明書</td><td style="padding: 6px 0;">${signerInfo}</td></tr>
                     <tr><td style="padding: 6px 0; color: #555; font-weight: bold;">署名タイムスタンプ</td><td style="padding: 6px 0;">${safeIsoDate(mso.validityInfo.signed)}</td></tr>
                 </table>
            </div>

            <footer style="margin-top: 60px; border-top: 1px dotted #ccc; padding-top: 20px; font-size: 10px; color: #999; text-align: center; font-family: sans-serif;">
               This digital document is basically compliant with Digital Agency's Power of Attorney Schema.
               <br>Signed at: ${safeDateString(mso.validityInfo.signed)}
            </footer>

            <!-- Machine Readable Demo Section -->
            <div style="margin-top: 50px; border-top: 2px dashed #cbd5e0; padding-top: 30px;">
                <details style="background: #f7fafc; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;">
                    <summary style="padding: 15px 20px; font-weight: bold; cursor: pointer; background: #edf2f7; color: #4a5568; font-family: sans-serif; display: flex; align-items: center; justify-content: space-between;">
                        <span>🤖 システム解析データ (Machine Readable Layer)</span>
                        <span style="font-size: 12px; font-weight: normal; color: #718096">Click to expand</span>
                    </summary>
                    <div style="padding: 20px; font-family: 'Courier New', monospace; font-size: 13px;">
                        
                        <!-- 1. Automated Logic Check -->
                        <div style="margin-bottom: 25px;">
                            <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #2d3748; border-bottom: 1px solid #cbd5e0; padding-bottom: 5px;">1. 自動有効性判定 (Automated Validity Check)</h3>
                            <div style="display: flex; gap: 20px; align-items: center;">
                                ${(() => {
            const now = new Date();
            const start = validity?.startDate ? new Date(validity.startDate) : null;
            const end = validity?.endDate ? new Date(validity.endDate) : null;
            let status = "ACTIVE";
            let color = "#38a169"; // green
            let msg = "この委任状は現在有効です。";

            if (start && now < start) {
                status = "FUTURE"; color = "#d69e2e"; msg = "有効期間開始前です。";
            } else if (end && now > end) {
                status = "EXPIRED"; color = "#e53e3e"; msg = "有効期間を経過しています。";
            }

            return `
                                        <div style="background: ${color}; color: white; padding: 5px 15px; border-radius: 4px; font-weight: bold; font-size: 16px;">${status}</div>
                                        <div style="color: #4a5568;">${msg} <br><span style="font-size: 11px; color: #718096">(Checked at: ${now.toISOString()})</span></div>
                                    `;
        })()}
                            </div>
                        </div>

                        <!-- 2. Structured Authority Data -->
                        <div style="margin-bottom: 25px;">
                            <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #2d3748; border-bottom: 1px solid #cbd5e0; padding-bottom: 5px;">2. 権限構造解析 (Authority Parsing)</h3>
                            <table style="width: 100%; border-collapse: collapse; background: white;">
                                <thead style="background: #edf2f7; text-align: left;">
                                    <tr>
                                        <th style="padding: 8px; border: 1px solid #cbd5e0;">Index</th>
                                        <th style="padding: 8px; border: 1px solid #cbd5e0;">Act Name (Value)</th>
                                        <th style="padding: 8px; border: 1px solid #cbd5e0;">Metadata</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${Array.isArray(acts) ? acts.map((act: any, i: number) => `
                                        <tr>
                                            <td style="padding: 8px; border: 1px solid #cbd5e0; text-align: center;">${i}</td>
                                            <td style="padding: 8px; border: 1px solid #cbd5e0; font-weight: bold; color: #2b6cb0;">${typeof act === 'string' ? act : act.actName}</td>
                                            <td style="padding: 8px; border: 1px solid #cbd5e0; color: #718096;">${typeof act === 'object' && act.note ? `Note: ${act.note}` : '-'}</td>
                                        </tr>
                                    `).join('') : '<tr><td colspan="3" style="padding: 8px;">No acts found</td></tr>'}
                                </tbody>
                            </table>
                            <div style="margin-top: 5px; color: #718096; font-size: 11px;">※ OCR処理を経ることなく、システムは正確な権限内容を取得・照合可能です。</div>
                        </div>

                        <!-- 3. Raw Data Structure -->
                        <div>
                            <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #2d3748; border-bottom: 1px solid #cbd5e0; padding-bottom: 5px;">3. 構造化データツリー (Unified Graph)</h3>
                            <div style="background: #1a202c; color: #a0aec0; padding: 15px; border-radius: 4px; overflow-x: auto;">
                                <pre style="margin: 0;">${JSON.stringify({
            id: getValue('id'),
            docType: mso.docType,
            mandator: mandator,
            mandatary: mandatary,
            authority: authority
        }, null, 2)}</pre>
                            </div>
                        </div>

                    </div>
                </details>
            </div>


        </div>
    `;
}

function render(doc: any, data: any, mso: any) {
    const container = document.getElementById('viewer-root');
    if (!container) return;

    if (data["証明書名称"] || data["明細書タイトル"]) {
        const titleVal = (data["証明書名称"] || data["明細書タイトル"]); // unwrapped already by chance or raw
        const actualTitle = (titleVal && typeof titleVal === 'object' && titleVal['@value']) ? titleVal['@value'] : titleVal;
        document.title = `${actualTitle} - Tobari Verified`;
    }

    if (mso.docType === 'io.github.masanork.tobari.bank_certificate.v1') {
        container.innerHTML = `<div class="">${renderBankCertificate(data, mso)}</div>`;
    } else if (mso.docType === 'io.github.masanork.tobari.credit-card-statement.v1') {
        container.innerHTML = `<div class="official-document">${renderStatement(data, doc.fields || [], mso)}</div>`;
    } else if (mso.docType.includes('ininjo')) {
        container.innerHTML = `<div class="">${renderIninjo(data, mso)}</div>`;
    } else {
        // Always use auto-renderer for now with new mdoc structure
        container.innerHTML = `<div class="official-document">${autoRender(data, doc.fields || [], mso)}</div>`;
    }
}


// Expose globally
(window as any).initTobari = initViewer;
