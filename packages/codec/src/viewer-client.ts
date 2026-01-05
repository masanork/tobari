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

function formatValue(v: any): string {
    // If it's an SD result object { @value, @disclosed }
    if (v && typeof v === 'object' && v.hasOwnProperty('@disclosed')) {
        if (!v['@disclosed']) return `<span style="color: #999; font-style: italic;">（非開示）</span>`;
        v = v['@value'];
    }
    return (v === undefined || v === null) ? '' : String(v);
}

function render(payload: any, data: any) {
    const container = document.getElementById('viewer-root');
    if (!container) return;

    const template = payload.display?.template;
    if (!template) {
        container.innerHTML = `<div class="error">No design template found in signed payload.</div>`;
        return;
    }

    container.innerHTML = simpleTemplate(template, data, payload);
}

// Expose globally
(window as any).initTobari = initViewer;
