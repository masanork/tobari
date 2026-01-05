import yaml from 'js-yaml';

interface Field {
    id: string;
    type: string;
    selective?: boolean;
    optional?: boolean;
    items?: {
        fields?: Field[];
        type?: string;
    };
    values?: string[];
}

interface Schema {
    id: string;
    title: string;
    fields: Field[];
}

export function yamlToCddl(yamlContent: string): string {
    const doc = yaml.load(yamlContent) as Schema;
    let cddl = `; CDDL for ${doc.title} (${doc.id})\n\n`;

    cddl += `tobari_payload = {\n`;
    cddl += `  version: tstr,\n`;
    cddl += `  schema_id: "${doc.id}",\n`;
    cddl += `  created_at: uint,\n`;

    // Add fields
    doc.fields.forEach(field => {
        cddl += generateFieldCddl(field, 2);
    });

    cddl += `}\n`;

    return cddl;
}

function generateFieldCddl(field: Field, indent: number): string {
    const spaces = " ".repeat(indent);
    const key = field.id;
    let typeStr = "";

    switch (field.type) {
        case 'string':
        case 'date':
            typeStr = "tstr";
            break;
        case 'uint':
        case 'number':
            typeStr = "uint";
            break;
        case 'boolean':
            typeStr = "bool";
            break;
        case 'enum':
            typeStr = field.values ? `(${field.values.map(v => `"${v}"`).join(" / ")})` : "tstr";
            break;
        case 'array':
            if (field.items?.fields) {
                // Nested object array
                const nestedTypeName = `${field.id}_item`;
                typeStr = `[* ${nestedTypeName}]`;
                // We'll need to define this type later or inline it.
                // For simplicity in the first version, let's inline it as a map.
                let nested = "{\n";
                field.items.fields.forEach(f => {
                    nested += generateFieldCddl(f, indent + 2);
                });
                nested += `${spaces}}`;
                typeStr = `[* ${nested}]`;
            } else if (field.items?.type) {
                typeStr = `[* ${mapPrimitive(field.items.type)}]`;
            } else {
                typeStr = "[* any]";
            }
            break;
        default:
            typeStr = "any";
    }

    const opt = field.optional ? "? " : "";
    const selectiveComment = field.selective ? " ; selective" : "";

    return `${spaces}${opt}"${key}" => ${typeStr},${selectiveComment}\n`;
}

function mapPrimitive(type: string): string {
    switch (type) {
        case 'string': return 'tstr';
        case 'number': return 'uint';
        default: return 'any';
    }
}
