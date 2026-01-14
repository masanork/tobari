import { parseMarkdown } from '../src/v1-parser/parser';
import { file, write } from 'bun';

// Helper to map v1 types to v2
function mapType(v1Type: string): string {
    switch (v1Type) {
        case 'text': return 'text';
        case 'number': return 'integer'; 
        case 'select': return 'select';
        case 'radio': return 'select';
        case 'search': return 'text'; // Search becomes text with autofill
        case 'date': return 'text'; // v2 date not yet specialized, use text
        case 'calc': return 'text'; // calc is read-only text usually
        case 'textarea': return 'textarea';
        case 'autonum': return 'integer';
        case 'static_table': return 'static_table';
        default: return 'text';
    }
}

// Simple attribute parser (similar to v1 utils but focused on what we need)
function extractAttributes(attrStr: string | undefined): { autofill?: string, masterSrc?: string, masterValueIndex?: number, masterLabelIndex?: number, formula?: string } {
    if (!attrStr) return {};

    const result: { autofill?: string, masterSrc?: string, masterValueIndex?: number, masterLabelIndex?: number, formula?: string } = {};

    // 1. Quoted attributes: autofill="value"
    const autofillMatch = attrStr.match(/autofill="([^"]+)"/);
    if (autofillMatch) {
        result.autofill = autofillMatch[1];
    }

    // 2. master-src="value" or master_src="value"
    const masterSrcMatch = attrStr.match(/master[-_]src="([^"]+)"/);
    if (masterSrcMatch) {
        result.masterSrc = masterSrcMatch[1];
    }

    // 3. Colon-style (unquoted): src:value
    if (!result.masterSrc) {
        const srcMatch = attrStr.match(/src:([^\s\)]+)/);
        if (srcMatch) {
            result.masterSrc = srcMatch[1];
        }
    }

    // 4. value:N
    const valueMatch = attrStr.match(/value:(\d+)/);
    if (valueMatch) {
        result.masterValueIndex = parseInt(valueMatch[1], 10);
    }

    // 5. label:N
    const labelMatch = attrStr.match(/label:(\d+)/);
    if (labelMatch) {
        result.masterLabelIndex = parseInt(labelMatch[1], 10);
    }

    // 6. formula="value"
    const formulaMatch = attrStr.match(/formula="([^"]+)"/);
    if (formulaMatch) {
        result.formula = formulaMatch[1];
    }

    return result;
}

function convertField(f: any): any {
    const isCalc = f.type === 'calc' || f.type === 'autonum';
    const field: any = {
        key: f.key,
        label: f.label,
        required: f.required || false,
        type: mapType(f.type),
        readonly: isCalc
    };

    // Mark autonum fields
    if (f.type === 'autonum') {
        field.autonum = true;
    }

    // Extract attributes
    const attrs = extractAttributes(f.attributes);
    if (attrs.autofill) field.autofill = attrs.autofill;
    if (attrs.masterSrc) field.masterSrc = attrs.masterSrc;
    if (attrs.masterValueIndex) field.masterValueIndex = attrs.masterValueIndex;
    if (attrs.masterLabelIndex) field.masterLabelIndex = attrs.masterLabelIndex;
    if (attrs.formula) field.formula = attrs.formula;

    if (field.type === 'select') {
        field.options = []; // Placeholder
    }

    return field;
}

async function convert(filePath: string, mode: 'json' | 'html') {
    const inputFile = file(filePath);
    const text = await inputFile.text();
    const { jsonStructure } = parseMarkdown(text);

    const v2Fields: any[] = [];

    // Map top level fields
    if (jsonStructure.fields) {
        for (const f of jsonStructure.fields) {
            if (f.type === 'static_table') {
                // Handle static table
                const tableField = {
                    type: 'static_table',
                    key: f.key,
                    label: f.key, // Use key as label or empty
                    headers: f.headers,
                    rows: f.rows.map((row: any[]) => row.map((cell: any) => {
                        if (typeof cell === 'string') return cell;
                        return convertField(cell);
                    }))
                };
                v2Fields.push(tableField);
            } else {
                v2Fields.push(convertField(f));
            }
        }
    }

    // Map dynamic tables to Array<Group>
    if (jsonStructure.tables) {
        for (const [tableKey, columns] of Object.entries(jsonStructure.tables)) {
            const colArray = columns as any[];
            const groupFields: any[] = colArray.map(c => convertField(c));

            v2Fields.push({
                type: 'array',
                key: tableKey,
                label: jsonStructure.tableLabels?.[tableKey] || tableKey,
                itemSchema: {
                    type: 'group',
                    key: 'item',
                    fields: groupFields
                }
            });
        }
    }

    const v2Schema: any = {
        meta: {
            title: jsonStructure.name || "Generated Form",
            version: "1.0",
            security: "standard"
        },
        fields: v2Fields
    };

    if (jsonStructure.masterData && Object.keys(jsonStructure.masterData).length > 0) {
        v2Schema.masterData = jsonStructure.masterData;
    }

    if (mode === 'json') {
        console.log(JSON.stringify(v2Schema, null, 2));
    } else {
        // Standalone HTML mode
        const engineScriptPath = new URL('../dist/index.js', import.meta.url);
        let engineScript = "";
        try {
            engineScript = await file(engineScriptPath).text();
        } catch (e) {
            console.error("Could not load form-engine script. Please run 'bun run build' in packages/form-engine first.");
            process.exit(1);
        }

        const html = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${v2Schema.meta.title}</title>
    <style>
        body {
            background: #f0f2f5;
            padding: 2rem;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
    </style>
</head>
<body>
    <div class="container">
        <tobari-form id="myForm"></tobari-form>
    </div>

    <script type="module">
        // Embedded Form Engine
        ${engineScript}
    </script>

    <script>
        const schema = ${JSON.stringify(v2Schema, null, 2)};

        customElements.whenDefined('tobari-form').then(() => {
            const form = document.getElementById('myForm');
            form.setSchema(schema);
            
            form.addEventListener('tobari-submit', (e) => {
                console.log("Form Submitted:", e.detail.data);
                alert("送信完了！コンソールにデータを出力しました。");
            });
        });
    </script>
</body>
</html>`;
        console.log(html);
    }
}

// Argument parsing
const args = process.argv.slice(2);
let mode: 'json' | 'html' = 'html'; // Default to html
let inputPath = '';

for (const arg of args) {
    if (arg === '--json') {
        mode = 'json';
    } else {
        inputPath = arg;
    }
}

if (!inputPath) {
    console.error("Usage: bun run mkform <input.md> [--json]");
    process.exit(1);
}

convert(inputPath, mode);