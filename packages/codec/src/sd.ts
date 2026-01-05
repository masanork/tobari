import { encodeCanonical } from '@tobari/crypto/cbor';

export interface Disclosure {
    salt: Uint8Array;
    key?: string; // For map entries
    value: any;
}

/**
 * Generates a salted hash for a value.
 */
export async function createDisclosure(value: any, key?: string): Promise<{ hash: Uint8Array, encoded: string }> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    // SD-JWT style: [salt, key, value] for maps, [salt, value] for arrays
    const disclosureArray = key !== undefined ? [salt, key, value] : [salt, value];
    const encodedBytes = encodeCanonical(disclosureArray);

    const hashBuffer = await crypto.subtle.digest('SHA-256', encodedBytes);
    const hash = new Uint8Array(hashBuffer);

    // Base64URL encode the disclosure for transport
    const encoded = btoa(String.fromCharCode(...encodedBytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    return { hash, encoded };
}

/**
 * Recursively processes data and schema to replace selective fields with hashes.
 * Returns the "Redacted" object for signing and a list of disclosure strings.
 */
export async function transformToSdData(
    data: any,
    fields: any[],
    disclosures: string[] = []
): Promise<{ redacted: any, disclosures: string[] }> {
    const redacted: any = { ...data };

    for (const field of fields) {
        const value = data[field.id];
        if (value === undefined) continue;

        if (field.selective) {
            // Replace with hash
            const { hash, encoded } = await createDisclosure(value, field.id);
            // In Tobari CBOR, we use a special marker for SD hashes. 
            // For now, let's use an object { _sd: hash } or a tagged value.
            // Let's go with a simple { "@sd": hash } for easy JSON/CBOR compatibility.
            redacted[field.id] = { "@sd": hash };
            disclosures.push(encoded);
        } else if (field.type === 'array' && field.items?.fields && Array.isArray(value)) {
            // Nested recursion for rays
            const processedArray = [];
            for (const item of value) {
                const { redacted: r } = await transformToSdData(item, field.items.fields, disclosures);
                processedArray.push(r);
            }
            redacted[field.id] = processedArray;
        }
    }

    return { redacted, disclosures };
}

/**
 * Validates disclosures and reconstructs the data.
 * Returns a new object where hashes are replaced by values (or a placeholder).
 */
export async function revealSdData(redactedData: any, disclosures: string[]): Promise<any> {
    const hashToValue = new Map<string, any>();

    for (const d of disclosures) {
        try {
            const decoded = Uint8Array.from(atob(d.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
            const hashBuffer = await crypto.subtle.digest('SHA-256', decoded);
            const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

            const { decode } = await import('@tobari/crypto/cbor');
            const disclosureArray = decode(decoded);
            // [salt, key, value] or [salt, value]
            const value = disclosureArray.length === 3 ? disclosureArray[2] : disclosureArray[1];
            hashToValue.set(hashHex, value);
        } catch (e) {
            console.warn("Failed to parse disclosure:", d, e);
        }
    }

    async function reveal(obj: any): Promise<any> {
        if (Array.isArray(obj)) {
            return Promise.all(obj.map(reveal));
        } else if (obj !== null && typeof obj === 'object') {
            if (obj['@sd']) {
                const hashHex = Array.from(obj['@sd'] as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
                if (hashToValue.has(hashHex)) {
                    return { "@value": hashToValue.get(hashHex), "@disclosed": true };
                } else {
                    return { "@disclosed": false };
                }
            }
            const revealed: any = {};
            for (const [k, v] of Object.entries(obj)) {
                revealed[k] = await reveal(v);
            }
            return revealed;
        }
        return obj;
    }

    return await reveal(redactedData);
}
