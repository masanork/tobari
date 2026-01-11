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
        deviceKeyPqc?: any; // PQC Device public key (extension)
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
    namespace: string = 'io.github.masanork.tobari.v1',
    devicePublicKey?: any, // CryptoKey (Public)
    devicePqcPublicKey?: Uint8Array // ML-DSA-65 Public Key (Raw)
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

    // Convert CryptoKey to COSE_Key map
    let deviceKeyMap = new Map();

    if (devicePublicKey) {
        const jwk = await crypto.subtle.exportKey('jwk', devicePublicKey);
        // Minimal COSE_Key for EC2 P-384
        deviceKeyMap = new Map<number, any>([
            [1, 2], // kty: EC2
            [-1, 2], // crv: P-384
            [-2, Uint8Array.from(atob(jwk.x!.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))],
            [-3, Uint8Array.from(atob(jwk.y!.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))]
        ]);
    }
    
    // Prepare PQC Key Map
    let devicePqcKeyMap;
    if (devicePqcPublicKey) {
        // Experimental COSE_Key for ML-DSA-65
        // kty: OKP (Octet Key Pair) -> 1 (using generic for now or private)
        // alg: ML-DSA-65 -> -49 (same as issuer)
        // x: public key bytes -> -2
        devicePqcKeyMap = new Map<number, any>([
            [1, 1], // kty: OKP (simulated)
            [3, -49], // alg: ML-DSA-65
            [-2, devicePqcPublicKey]
        ]);
    }

    const now = new Date();
    const mso: MSO = {
        version: "1.0",
        digestAlgorithm: "SHA-256",
        valueDigests: {
            [namespace]: valueDigests
        },
        deviceKeyInfo: {
            deviceKey: deviceKeyMap
        },
        docType,
        validityInfo: {
            signed: now,
            validUntil: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 365) // 1 year
        }
    };
    
    if (devicePqcKeyMap) {
        mso.deviceKeyInfo.deviceKeyPqc = devicePqcKeyMap;
    }

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

/**
 * Creates a Verifiable Presentation (VP) by selectively disclosing items.
 */
export async function createPresentation(
    fullDoc: any,
    disclosedKeys: string[]
): Promise<any> {
    const { decode } = await import('@tobari/crypto/cbor');

    const vp = {
        ...fullDoc,
        issuerSigned: {
            ...fullDoc.issuerSigned,
            nameSpaces: { ...fullDoc.issuerSigned.nameSpaces }
        }
    };

    for (const ns of Object.keys(vp.issuerSigned.nameSpaces)) {
        const originalItems = fullDoc.issuerSigned.nameSpaces[ns];
        const filteredItems: Uint8Array[] = [];

        for (const itemBytes of originalItems) {
            const item = decode(new Uint8Array(itemBytes));
            const key = item[2]; 

            if (disclosedKeys.includes(key)) {
                filteredItems.push(itemBytes);
            }
        }

        vp.issuerSigned.nameSpaces[ns] = filteredItems;
    }

    return vp;
}

/**
 * ISO 18013-5 DeviceResponse structure
 */
export interface DeviceResponse {
    version: "1.0";
    documents: any[];
    status: 0;
}

/**
 * Generates the "To Be Signed" bytes for DeviceAuth (Sig_structure).
 * This is used for external signing (e.g. Passkeys).
 */
export async function getDeviceAuthToBeSigned(
    docType: string,
    deviceNamespacesBytes: Uint8Array,
    sessionTranscript: any[],
    alg: number = -35 // ES384
): Promise<{ toBeSigned: Uint8Array, protectedHeaderBytes: Uint8Array }> {
    const { encodeCanonical } = await import('@tobari/crypto/cbor');

    const deviceAuthentication = [
        "DeviceAuthentication",
        sessionTranscript,
        docType,
        deviceNamespacesBytes
    ];
    const payloadBytes = encodeCanonical(deviceAuthentication);

    // Prepare COSE_Sign1 protected header
    const protectedHeaderMap = new Map<any, any>();
    protectedHeaderMap.set(1, alg); 
    const protectedHeaderBytes = encodeCanonical(Object.fromEntries(protectedHeaderMap));

    // Sig_structure = ["Signature1", protectedHeaderBytes, external_aad, payloadBytes]
    const sigStructure = [
        "Signature1",
        protectedHeaderBytes,
        new Uint8Array(0), // external_aad
        payloadBytes
    ];

    return {
        toBeSigned: encodeCanonical(sigStructure),
        protectedHeaderBytes
    };
}

/**
 * Assembles a COSE_Sign1 structure from a pre-computed signature.
 */
export async function assembleDeviceAuth(
    protectedHeaderBytes: Uint8Array,
    docType: string,
    deviceNamespacesBytes: Uint8Array,
    sessionTranscript: any[],
    signature: Uint8Array
): Promise<Uint8Array> {
    const { encodeCanonical } = await import('@tobari/crypto/cbor');

    const deviceAuthentication = [
        "DeviceAuthentication",
        sessionTranscript,
        docType,
        deviceNamespacesBytes
    ];
    const payloadBytes = encodeCanonical(deviceAuthentication);

    const coseSign1 = [
        protectedHeaderBytes,
        {}, // unprotected
        payloadBytes,
        signature
    ];

    return encodeCanonical(coseSign1);
}

/**
 * Assembles a COSE_Sign1 structure from a WebAuthn assertion.
 * The authData and clientDataJSON are stored in the unprotected header.
 */
export async function assembleWebAuthnDeviceAuth(
    protectedHeaderBytes: Uint8Array,
    docType: string,
    deviceNamespacesBytes: Uint8Array,
    sessionTranscript: any[],
    signature: Uint8Array,
    authData: Uint8Array,
    clientDataJSON: string
): Promise<Uint8Array> {
    const { encodeCanonical } = await import('@tobari/crypto/cbor');

    const deviceAuthentication = [
        "DeviceAuthentication",
        sessionTranscript,
        docType,
        deviceNamespacesBytes
    ];
    const payloadBytes = encodeCanonical(deviceAuthentication);

    const unprotectedHeader = new Map<number, any>();
    unprotectedHeader.set(-65537, authData);
    unprotectedHeader.set(-65538, clientDataJSON);

    const coseSign1 = [
        protectedHeaderBytes,
        unprotectedHeader,
        payloadBytes,
        signature
    ];

    return encodeCanonical(coseSign1);
}

/**
 * Creates a DeviceAuth signature (COSE_Sign1) over the DeviceAuthentication structure.
 */
export async function signDeviceAuth(
    docType: string,
    deviceNamespacesBytes: Uint8Array, // CBOR encoded deviceNameSpaces (usually empty)
    sessionTranscript: any[], // [DeviceEngagementBytes, ER_KeyBytes, Handover]
    devicePrivateKey: CryptoKey,
    alg: number = -35 // ES384
): Promise<Uint8Array> {
    const { encodeCanonical } = await import('@tobari/crypto/cbor');
    const { signCoseSign1 } = await import('@tobari/crypto/cose');

    // DeviceAuthentication = [
    //   "DeviceAuthentication",
    //   sessionTranscript,
    //   docType,
    //   deviceNamespacesBytes
    // ]
    const deviceAuthentication = [
        "DeviceAuthentication",
        sessionTranscript,
        docType,
        deviceNamespacesBytes
    ];
    const deviceAuthenticationBytes = encodeCanonical(deviceAuthentication);

    // In mdoc, the DeviceAuth is a COSE_Sign1 where the payload is NULL (detached)
    // or the DeviceAuthenticationBytes itself. For simplicity here, we use it as payload.
    return await signCoseSign1(deviceAuthenticationBytes, devicePrivateKey, { alg });
}

function compareUint8Arrays(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
