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
                const issuerKey = await crypto.subtle.importKey(
                    "jwk",
                    issuerPublicKeyJwk,
                    { name: "ECDSA", namedCurve: "P-384" },
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
    }

    if (v === undefined || v === null) return '-';
    if (Array.isArray(v)) return v.join('、');
    return String(v);
}

function render(doc: any, data: any, mso: any) {
    const container = document.getElementById('viewer-root');
    if (!container) return;

    if (data["証明書名称"]) {
        const titleVal = data["証明書名称"]["@value"] || data["証明書名称"];
        document.title = `${titleVal} - Tobari Verified`;
    }

    // Always use auto-renderer for now with new mdoc structure
    container.innerHTML = `<div class="official-document">${autoRender(data, doc.fields || [], mso)}</div>`;
}

// Expose globally
(window as any).initTobari = initViewer;
