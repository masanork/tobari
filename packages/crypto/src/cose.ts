import { encodeCanonical, decode } from './cbor';
import { COSE_ALG, base64url, type CoseAlg } from './utils';

export interface SignerOptions {
    alg: CoseAlg;
    kid?: string; // Key ID
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
    protectedHeaderMap.set(1, options.alg); // 1: alg
    if (options.kid) {
        protectedHeaderMap.set(4, new TextEncoder().encode(options.kid)); // 4: kid (byte string)
    }

    const protectedHeaderBytes = encodeCanonical(Object.fromEntries(protectedHeaderMap));
    const payloadBytes = encodeCanonical(payload);

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
    // Map COSE alg to Web Crypto algorithm
    let webCryptoAlg: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
    if (options.alg === COSE_ALG.ES256) {
        webCryptoAlg = { name: 'ECDSA', hash: { name: 'SHA-256' } };
    } else if (options.alg === COSE_ALG.ES384) {
        webCryptoAlg = { name: 'ECDSA', hash: { name: 'SHA-384' } };
    } else if (options.alg === COSE_ALG.EdDSA) {
        webCryptoAlg = { name: 'Ed25519' }; // Note: Ed25519 support varies by runtime/browser (Bun supports it)
    } else {
        throw new Error(`Unsupported algorithm: ${options.alg}`);
    }

    const signatureBuffer = await crypto.subtle.sign(
        webCryptoAlg,
        privateKey,
        toBeSigned as any
    );
    const signature = new Uint8Array(signatureBuffer);

    // 4. Assemble COSE_Sign1
    const coseSign1 = [
        protectedHeaderBytes,
        {}, // Unprotected header (empty map)
        payloadBytes,
        signature
    ];

    return encodeCanonical(coseSign1);
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
    // Note: cbor-x might decode map keys as strings if not configured carefully with maps, 
    // but our decoder uses standard behavior. 
    // Keys like 1 (alg) might come out as "1" or 1 depending on config.
    // In `cbor.ts` we returned Objects.

    // Let's assume standard object access.
    const alg = protectedHeader[1] || protectedHeader['1'];

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
