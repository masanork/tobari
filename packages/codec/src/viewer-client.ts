import { decode } from 'cbor-x';
import { revealSdData } from './sd';

// Minimal UI for the Tobari Viewer
export async function initViewer(base64Data: string) {
    try {
        const binary = Uint8Array.from(atob(base64Data.split(',')[1] || base64Data), c => c.charCodeAt(0));
        const coseArray = decode(binary);

        const payloadBytes = coseArray[2];
        const payload = decode(payloadBytes);

        // Process Selective Disclosure
        const disclosedData = await revealSdData(payload.data, payload.disclosures || []);

        // Render using the embedded template
        render(payload, disclosedData);
    } catch (e) {
        document.body.innerHTML = `<div class="error">Failed to decode Tobari file: ${e}</div>`;
        console.error(e);
    }
}

// Minimal Template Engine (Supporting {{key}}, {{#each}}, {{#join}})
function simpleTemplate(template: string, data: any, payload: any): string {
    let result = template;

    // Support Context Access
    const getValue = (expression: string, currentContext: any): any => {
        const key = expression.trim();
        if (key === "@index") return currentContext["@index"];

        // Full context (for top-level access inside loops)
        const fullContext = {
            ...data,
            schema_id: payload.schema_id,
            created_at: new Date(payload.created_at * 1000).toLocaleString()
        };

        // Try current context first, then full context
        let val = key.split('.').reduce((o: any, i: any) => o?.[i], currentContext);
        if (val === undefined) {
            val = key.split('.').reduce((o: any, i: any) => o?.[i], fullContext);
        }
        return val;
    };

    // 1. Handle {{#each list}} ... {{/each}}
    result = result.replace(/{{#each ([^}]+)}}([\s\S]*?){{\/each}}/g, (_, key, block) => {
        const rawList = getValue(key, data);
        const list = (rawList && typeof rawList === 'object' && rawList.hasOwnProperty('@disclosed'))
            ? (rawList['@disclosed'] ? rawList['@value'] : [])
            : rawList;

        if (!Array.isArray(list)) return '';
        return list.map((item, index) => {
            return simpleTemplate(block, { ...item, ["@index"]: index }, payload);
        }).join('');
    });

    // 2. Handle {{#join list}} ... {{/join}}
    result = result.replace(/{{#join ([^}]+)}}([\s\S]*?){{\/join}}/g, (_, key, separator) => {
        const rawList = getValue(key, data);
        const list = (rawList && typeof rawList === 'object' && rawList.hasOwnProperty('@disclosed'))
            ? (rawList['@disclosed'] ? rawList['@value'] : [])
            : rawList;

        if (!Array.isArray(list)) return '';
        return list.map(v => formatValue(v)).join(separator);
    });

    // 3. Handle {{key}}
    result = result.replace(/{{([^{}]+)}}/g, (_, expression) => {
        return formatValue(getValue(expression, data));
    });

    return result;
}

// Standard Auto-Renderer for Web-optimized viewing
function autoRender(data: any, payload: any): string {
    const fieldsMeta = (payload as any).fields || [];

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

    const renderCard = (items: any[], subFields: any[]) => {
        const primaryField = subFields.find((f: any) => f.primary);

        return `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px;">
            ${items.map((item, i) => {
            const primaryValue = primaryField ? item[primaryField.id] : null;

            return `
                <div style="background: #f7fafc; border-radius: 12px; padding: 24px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                    ${primaryValue ? `
                        <div style="margin-bottom: 20px; border-bottom: 2px solid #3182ce; padding-bottom: 12px;">
                            <div style="font-size: 11px; color: #3182ce; font-weight: bold; text-transform: uppercase; margin-bottom: 4px;">${primaryField.id}</div>
                            <div style="font-size: 24px; font-weight: 800; color: #1a202c;">${formatValue(primaryValue)}</div>
                        </div>
                    ` : `<div style="font-weight: bold; margin-bottom: 15px; color: #a0aec0;">#${i + 1}</div>`}
                    
                    <div style="display: grid; gap: 12px;">
                    ${subFields.filter((f: any) => !f.primary).map((f: any) => {
                const val = item[f.id];
                if (val === undefined) return '';
                return `
                            <div>
                                <div style="font-size: 11px; color: #a0aec0; text-transform: uppercase; margin-bottom: 2px;">${f.id}</div>
                                <div style="font-size: 14px; color: #2d3748;">${formatValue(val)}</div>
                            </div>
                        `;
            }).join('')}
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

    // 1. Render Header Section (e.g. Title)
    fieldsMeta.filter((f: any) => f.section === 'header').forEach((field: any) => {
        const val = data[field.id];
        if (val !== undefined) {
            html += `<h1 style="font-size: 32px; font-weight: 900; color: #1a202c; margin-bottom: 12px; letter-spacing: -0.02em;">${formatValue(val)}</h1>`;
        }
    });

    html += `
                <div style="display: inline-flex; align-items: center; background: #ebf8ff; color: #3182ce; padding: 6px 16px; border-radius: 100px; font-size: 13px; font-weight: 700; border: 1px solid #bee3f8;">
                    Schema: ${payload.schema_id}
                </div>
            </header>
    `;

    // 2. Render Main Subject Section (Default)
    fieldsMeta.filter((f: any) => !f.section || f.section === 'subject').forEach((field: any) => {
        const val = data[field.id];
        if (val === undefined || field.id === "証明書名称") return;

        let actualValue = val;
        if (val && typeof val === 'object' && val.hasOwnProperty('@disclosed')) {
            actualValue = (val as any)['@disclosed'] ? (val as any)['@value'] : null;
        }

        if (Array.isArray(actualValue)) {
            html += renderSection(field.id, renderCard(actualValue, field.items?.fields || []));
        } else {
            html += renderKeyValue(field.id, val);
        }
    });

    // 3. Render Footer (Issuance) Section
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
                <!-- Subtle visual seal/marker -->
                <div style="position: absolute; right: 30px; bottom: 20px; width: 60px; height: 60px; border: 3px double #3182ce; border-radius: 50%; opacity: 0.1; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #3182ce; font-size: 20px;">印</div>
            </div>
        `;
    }

    html += `
            <footer style="margin-top: 40px; padding: 40px 0; text-align: center; font-size: 12px; color: #cbd5e0;">
                <div style="margin-bottom: 8px; font-weight: bold; font-family: sans-serif !important;">DIGITALLY SIGNED & VERIFIED</div>
                <div style="margin-bottom: 4px;">Verified at: ${new Date().toLocaleString()}</div>
                <div>Hash: ${payload.created_at} / Signature: ES384 / Algorithm: P-384 / Powered by Tobari</div>
            </footer>
        </div>
    `;

    return html;
}

function formatValue(v: any): string {
    if (v && typeof v === 'object' && v.hasOwnProperty('@disclosed')) {
        if (!(v as any)['@disclosed']) {
            return `<span style="display: inline-flex; align-items: center; background: #fff5f5; color: #c53030; font-size: 12px; padding: 2px 8px; border-radius: 4px; border: 1px solid #feb2b2;">
                <span style="margin-right: 4px;">○</span> 非開示 (Hidden)
            </span>`;
        }
        v = (v as any)['@value'];
    }

    if (v === undefined || v === null) return '-';
    if (Array.isArray(v)) return v.join('、');
    return String(v);
}

function render(payload: any, data: any) {
    const container = document.getElementById('viewer-root');
    if (!container) return;

    const template = payload.display?.template;
    if (template) {
        container.innerHTML = simpleTemplate(template, data, payload);
    } else {
        // Fallback to Auto-Renderer
        container.innerHTML = autoRender(data, payload);
    }
}

// Expose globally
(window as any).initTobari = initViewer;
