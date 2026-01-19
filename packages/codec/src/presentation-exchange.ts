/**
 * Simple DIF Presentation Exchange (PE) Parser for Tobari
 * Supports extracting fields from input_descriptors for mDoc selective disclosure.
 */

export interface PresentationDefinition {
    id: string;
    input_descriptors: InputDescriptor[];
}

export interface InputDescriptor {
    id: string;
    name?: string;
    purpose?: string;
    constraints: {
        fields: FieldConstraint[];
    };
}

export interface FieldConstraint {
    path: string[];
    intent_to_retain?: boolean;
}

/**
 * Extracts element identifiers from a Presentation Definition.
 * Maps "$.mdoc.namespace.element" or "$.element" to simple element names.
 */
export function extractFieldsFromDefinition(pd: PresentationDefinition): string[] {
    const fields: string[] = [];

    for (const descriptor of pd.input_descriptors) {
        for (const field of descriptor.constraints.fields) {
            for (const path of field.path) {
                // Handle various path formats:
                // 1. $.mdoc.namespace.element (ISO 18013-5)
                // 2. $.element (Flat)
                const parts = path.split('.');
                if (parts.length > 0) {
                    const lastPart = parts[parts.length - 1];
                    // Strip potential bracket indexing like [0] if present
                    const cleanName = lastPart.replace(/\[\d+\]/g, '');
                    if (!fields.includes(cleanName)) {
                        fields.push(cleanName);
                    }
                }
            }
        }
    }

    return fields;
}

/**
 * Helper to parse a full OID4VP Authorization Request JSON
 * which might contain 'presentation_definition' at the top level or inside.
 */
export function parseOid4vpRequest(json: any): {
    definition?: PresentationDefinition;
    nonce?: string;
    clientId?: string;
    responseUri?: string;
} {
    let definition = json.presentation_definition;
    
    // Sometimes it's wrapped in another object
    if (!definition && json.request_payload) {
        definition = json.request_payload.presentation_definition;
    }

    return {
        definition,
        nonce: json.nonce,
        clientId: json.client_id,
        responseUri: json.response_uri
    };
}
