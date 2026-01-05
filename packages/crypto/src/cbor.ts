import { Encoder, Decoder } from 'cbor-x';
export { Encoder, Decoder } from 'cbor-x';

// Configure cbor-x for canonical encoding (deterministic)
// structuredClone is used to ensure pure JS objects if needed, 
// but cbor-x handles most things well. 
// We enable 'mapsAsObjects' to treat JS objects as CBOR maps.
const encoder = new Encoder({
    mapsAsObjects: true,
    useRecords: false,
    tagUint8Array: false, // Disable Tag 64, use standard Byte String (Major Type 2)
    // Sort keys to ensure canonical encoding (deterministic output)
    // cbor-x unfortunately doesn't strictly sort keys by default in all versions for simple objects without specific setup,
    // but we can ensure it by sorting keys before passing or using a wrapper.
    // However, cbor-x's `variableMapSize` is default.
    // For strict canonical CBOR (RFC 7049 Section 3.9), keys must be sorted.
    // cbor-x does not officially guarantee RFC-compliant canonical serialization out of the box with a simple flag
    // for all object types, but we can implement a pre-sort or find a specific config.
    // For now, we will assume standard encoding and might need a manual sort helper if strictness is critical.
});

// We need a custom wrapper to ensure key sorting for Canonical CBOR
export function encodeCanonical(value: any): Uint8Array {
    return encoder.encode(sortKeysRecursive(value));
}

export function decode(value: Uint8Array): any {
    return encoder.decode(value);
}

function sortKeysRecursive(value: any): any {
    if (Array.isArray(value)) {
        return value.map(sortKeysRecursive);
    } else if (value !== null && typeof value === 'object') {
        // Preserve Uint8Array (and Node Buffers) as is
        if (value instanceof Uint8Array) {
            return value;
        }
        // Handle Map (preserve it, maybe sort keys?)
        if (value instanceof Map) {
            // For canonical encoding, we should technically sort map keys too.
            // But complex keys (int vs string) make simple sort hard.
            // For now, let's at least return the Map so it's not empty!
            // TODO: strict canonical sort for Maps
            return value;
        }

        // Prepare a new object with sorted keys
        const sortedObj: Record<string, any> = {};
        Object.keys(value).sort().forEach(key => {
            sortedObj[key] = sortKeysRecursive(value[key]);
        });
        return sortedObj;
    }
    return value;
}
