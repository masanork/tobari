import { encodeCanonical, decode } from './cbor';
import { COSE_ALG, COSE_HEADER_LABELS, base64url, type CoseAlg } from './utils';

export interface SignerOptions {
    alg: CoseAlg;
    kid?: string; // Key ID
    countersignSetup?: {
        alg: CoseAlg;
        privateKey: CryptoKey;
        kid?: string;
    };
}

/**
 * Creates a COSE_Sign1 structure.
 * 
 * Structure:
 * [
 *   protected (Bytes),   // CBOR encoded header
 *   unprotected (Map),
 *   payload (Bytes),     // The content
 *   signature (Bytes)
 * ]
 */
export async function signCoseSign1(
    payload: any,
    privateKey: CryptoKey,
    options: SignerOptions
): Promise<Uint8Array> {
    // 1. Prepare Headers
    const protectedHeaderMap = new Map<any, any>();
    protectedHeaderMap.set(COSE_HEADER_LABELS.alg, options.alg); // 1: alg
    if (options.kid) {
        protectedHeaderMap.set(COSE_HEADER_LABELS.kid, new TextEncoder().encode(options.kid)); // 4: kid
    }

    const protectedHeaderBytes = encodeCanonical(protectedHeaderMap);

    // If payload is already a Uint8Array, don't re-encode it as a Byte String
    const payloadBytes = (payload instanceof Uint8Array) ? payload : encodeCanonical(payload);

    // 2. Prepare Sig_structure for signing
    // [ "Signature1", protected, external_aad, payload ]
    const sigStructure = [
        "Signature1",
        protectedHeaderBytes,
        new Uint8Array(0), // external_aad (empty)
        payloadBytes
    ];

    const toBeSigned = encodeCanonical(sigStructure);

    // 3. Sign
    const signatureBuffer = await signWithKey(privateKey, options.alg, toBeSigned);
    const signature = new Uint8Array(signatureBuffer);

    // 4. Countersignature (RFC 9338) - Optional
    const unprotectedHeaderMap = new Map<any, any>();

    if (options.countersignSetup) {
        const csSetup = options.countersignSetup;

        // Prepare Countersignature Protected Header
        const csProtectedMap = new Map<any, any>();
        csProtectedMap.set(COSE_HEADER_LABELS.alg, csSetup.alg);
        if (csSetup.kid) {
            csProtectedMap.set(COSE_HEADER_LABELS.kid, new TextEncoder().encode(csSetup.kid));
        }
        const csProtectedBytes = encodeCanonical(csProtectedMap);

        // Prepare Countersign_structure
        // [ "CounterSignature0", body_protected, sign_protected, external_aad, payload, other_fields ]
        // body_protected: protected attributes of the counter signature
        // payload: the signature value of the parent
        const csStructure = [
            "CounterSignature0",
            csProtectedBytes,
            new Uint8Array(0), // external_aad
            signature // payload is the parent signature
        ];

        const csToBeSigned = encodeCanonical(csStructure);
        const csSigBuffer = await signWithKey(csSetup.privateKey, csSetup.alg, csToBeSigned);
        const csSignature = new Uint8Array(csSigBuffer);

        // Construct CounterSignature0 object (same as COSE_Sign1)
        // [ protected, unprotected, payload(empty), signature ]
        // But RFC 9338 says CounterSignature0 value IS the COSE_Sign1 structure.
        // HOWEVER, "The payload field is empty" is often omitted or nil?
        // Let's use standard COSE_Sign1 structure where payload is nil/empty for CS0.
        // Actually RFC 9338 3.2: "The value of the Countersignature0 attribute is a COSE_Sign1 structure... The payload field is set to a zero-length bstr."
        const csObj = [
            csProtectedBytes,
            {}, // unprotected
            new Uint8Array(0), // payload is empty in the container
            csSignature
        ];

        // Add to unprotected header of parent (Label 12)
        unprotectedHeaderMap.set(COSE_HEADER_LABELS.Countersignature0, csObj);
    }

    // 5. Assemble COSE_Sign1
    const coseSign1 = [
        protectedHeaderBytes,
        Object.fromEntries(unprotectedHeaderMap), // Convert Map to Object for simple encoders if needed, or keep as is if encoder supports Map
        payloadBytes,
        signature
    ];

    return encodeCanonical(coseSign1);
}

// Helper for signing
async function signWithKey(key: CryptoKey, alg: CoseAlg, data: Uint8Array): Promise<ArrayBuffer> {
    let webCryptoAlg: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
    if (alg === COSE_ALG.ES256) {
        webCryptoAlg = { name: 'ECDSA', hash: { name: 'SHA-256' } };
    } else if (alg === COSE_ALG.ES384) {
        webCryptoAlg = { name: 'ECDSA', hash: { name: 'SHA-384' } };
    } else if (alg === COSE_ALG.EdDSA) {
        webCryptoAlg = { name: 'Ed25519' };
    } else {
        throw new Error(`Unsupported algorithm: ${alg}`);
    }
    return crypto.subtle.sign(webCryptoAlg, key, data as any);
}

/**
 * Encodes the entire workflow into a URL-safe string.
 */
export async function createFormToken(
    formValues: any,
    privateKey: CryptoKey,
    options: SignerOptions
): Promise<string> {
    const coseBytes = await signCoseSign1(formValues, privateKey, options);
    return base64url.encode(coseBytes);
}

export async function verifyFormToken(
    token: string,
    publicKey: CryptoKey
): Promise<any> {
    const coseBytes = base64url.decode(token);
    const coseArray = decode(coseBytes);

    if (!Array.isArray(coseArray) || coseArray.length !== 4) {
        throw new Error("Invalid COSE_Sign1 structure");
    }

    const [protectedHeaderBytes, unprotectedHeader, payloadBytes, signature] = coseArray;

    // Decode protected header to get alg
    const protectedHeader = decode(protectedHeaderBytes);
    // Note: cbor-x might decode map keys as strings or Map depending on config.
    let alg: any;
    if (protectedHeader instanceof Map) {
        alg = protectedHeader.get(1) ?? protectedHeader.get('1');
    } else {
        alg = protectedHeader[1] || protectedHeader['1'];
    }

    // Reconstruct Sig_structure
    const sigStructure = [
        "Signature1",
        protectedHeaderBytes,
        new Uint8Array(0),
        payloadBytes
    ];
    const toBeSigned = encodeCanonical(sigStructure);

    let webCryptoAlg: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
    if (alg === COSE_ALG.ES256) {
        webCryptoAlg = { name: 'ECDSA', hash: { name: 'SHA-256' } };
    } else if (alg === COSE_ALG.ES384) {
        webCryptoAlg = { name: 'ECDSA', hash: { name: 'SHA-384' } };
    } else if (alg === COSE_ALG.EdDSA) {
        webCryptoAlg = { name: 'Ed25519' };
    } else {
        throw new Error(`Unsupported algorithm: ${alg}`);
    }

    const isValid = await crypto.subtle.verify(
        webCryptoAlg,
        publicKey,
        signature,
        toBeSigned as any
    );

    if (!isValid) throw new Error("Signature verification failed");

    return decode(payloadBytes);
}
