import { encodeCanonical } from '@tobari/crypto/cbor';

/**
 * mdoc (ISO 18013-5) IssuerSignedItem structure
 */
export interface IssuerSignedItem {
    digestID: number;
    random: Uint8Array;
    elementIdentifier: string;
    elementValue: any;
}

export type IssuerSignedItemBytes = Uint8Array;

/**
 * Mobile Security Object (MSO) as per ISO 18013-5
 */
export interface MSO {
    version: string;
    digestAlgorithm: "SHA-256";
    valueDigests: {
        [namespace: string]: {
            [digestID: number]: Uint8Array;
        }
    };
    deviceKeyInfo: {
        deviceKey: any; // Device public key for holder binding
    };
    docType: string;
    validityInfo: {
        signed: Date;
        validUntil: Date;
        expectedUpdate?: Date;
    };
}

/**
 * Encodes an IssuerSignedItem for hashing.
 * mdoc uses a speziic Tag 24 for the encoded item bytes.
 */
export async function encodeIssuerSignedItem(item: IssuerSignedItem): Promise<IssuerSignedItemBytes> {
    // [digestID, random, elementIdentifier, elementValue]
    return encodeCanonical([
        item.digestID,
        item.random,
        item.elementIdentifier,
        item.elementValue
    ]);
}

/**
 * Transforms raw data into mdoc-compatible structures.
 * Returns the MSO (to be signed) and the full set of IssuerSignedItems.
 */
export async function transformToMdocData(
    docType: string,
    data: any,
    fields: any[],
    namespace: string = 'io.github.masanork.tobari.v1'
): Promise<{ mso: MSO, issuerSignedItems: IssuerSignedItemBytes[] }> {
    const valueDigests: { [id: number]: Uint8Array } = {};
    const issuerSignedItems: IssuerSignedItemBytes[] = [];

    let digestID = 0;
    for (const field of fields) {
        const val = data[field.id];
        if (val === undefined) continue;

        // Create salt
        const random = crypto.getRandomValues(new Uint8Array(16));
        const item: IssuerSignedItem = {
            digestID: digestID++,
            random,
            elementIdentifier: field.id,
            elementValue: val
        };

        const encoded = await encodeIssuerSignedItem(item);
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', (encoded as any) as Uint8Array));

        valueDigests[item.digestID] = hash;
        issuerSignedItems.push(encoded);
    }

    const now = new Date();
    const mso: MSO = {
        version: "1.0",
        digestAlgorithm: "SHA-256",
        valueDigests: {
            [namespace]: valueDigests
        },
        deviceKeyInfo: {
            deviceKey: {} // Placeholder for later device binding
        },
        docType,
        validityInfo: {
            signed: now,
            validUntil: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 365) // 1 year
        }
    };

    return { mso, issuerSignedItems };
}

/**
 * Reconstructs data from mdoc structure (IssuerSigned).
 * verified the hashes against the MSO valueDigests.
 */
export async function revealMdocData(
    mso: MSO,
    issuerSignedItems: IssuerSignedItemBytes[],
    namespace: string = 'io.github.masanork.tobari.v1'
): Promise<any> {
    const { decode } = await import('@tobari/crypto/cbor');
    const revealed: any = {};
    const digests = mso.valueDigests[namespace] || {};

    for (const itemBytes of issuerSignedItems) {
        const item: any[] = decode(itemBytes);
        const [id, random, key, value] = item;

        // Verify Hash
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', itemBytes as any));
        const expectedHash = digests[id as number];

        if (expectedHash && compareUint8Arrays(hash, expectedHash)) {
            revealed[key] = { "@value": value, "@disclosed": true };
        } else {
            console.warn(`Hash mismatch for element ${key} (digestID: ${id})`);
            revealed[key] = { "@disclosed": false, "@error": "Hash mismatch" };
        }
    }

    // Identify undisclosed items from MSO
    for (const [id, _hash] of Object.entries(digests)) {
        // Find if this ID was in the items
        const wasProvided = issuerSignedItems.some(bytes => {
            const decoded = decode(bytes);
            return decoded[0] === Number(id);
        });

        if (!wasProvided) {
            // Find key from somewhere? 
            // In a real mdoc, we don't know the key if it's not provided.
            // But we can mark it as undisclosed.
            // (In Tobari, we might want to store keys in the schema part of the MSO or similar)
        }
    }

    return revealed;
}

function compareUint8Arrays(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
