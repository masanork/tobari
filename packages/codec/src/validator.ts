import { decode } from 'cbor-x';
import { verifyFormToken } from '@tobari/crypto/cose';
import { base64url } from '@tobari/crypto/utils';
import { MSO, revealMdocData } from './sd';

export interface VerificationResult {
    isValid: boolean;
    mso: MSO | null;
    doc: any;
    error?: string;
}

/**
 * Verifies a Tobari binary (or base64 string) against a public key.
 */
export async function verifyTobari(
    input: Uint8Array | string,
    publicKey: CryptoKey
): Promise<VerificationResult> {
    try {
        let binary: Uint8Array;
        if (typeof input === 'string') {
            const b64 = input.includes(',') ? input.split(',')[1] : input;
            binary = base64url.decode(b64);
        } else {
            binary = input;
        }

        const doc = decode(binary);
        if (!doc.issuerSigned || !doc.issuerSigned.issuerAuth) {
            throw new Error("Invalid Tobari document: missing issuerSigned or issuerAuth");
        }

        // Verify MSO signature
        // In mdoc, issuerAuth is a COSE_Sign1 containing the MSO
        const issuerAuthToken = base64url.encode(doc.issuerSigned.issuerAuth);
        const mso = await verifyFormToken(issuerAuthToken, publicKey) as MSO;

        return {
            isValid: true,
            mso: mso,
            doc: doc
        };
    } catch (e: any) {
        return {
            isValid: false,
            mso: null,
            doc: null,
            error: e.message || String(e)
        };
    }
}

/**
 * Verifies a Verifiable Presentation (DeviceResponse) containing one or more documents.
 */
export async function verifyPresentation(
    presentation: any, // Decoded DeviceResponse
    issuerPublicKeys: Record<string, CryptoKey>, // Map of docType -> PublicKey
    verifierNonce?: string
): Promise<any[]> {
    const { decode, encodeCanonical } = await import('@tobari/crypto/cbor');
    const results = [];

    for (const doc of presentation.documents) {
        const result: any = {
            docType: doc.docType,
            issuerValid: false,
            deviceValid: false,
            data: {},
            error: null
        };

        try {
            // 1. Verify Issuer Signature
            const issuerAuthToken = await import('@tobari/crypto/utils').then(m => m.base64url.encode(doc.issuerSigned.issuerAuth));
            const publicKey = issuerPublicKeys[doc.docType];
            
            if (!publicKey) {
                throw new Error(`No public key provided for docType: ${doc.docType}`);
            }

            const mso = await (await import('@tobari/crypto/cose')).verifyFormToken(issuerAuthToken, publicKey) as MSO;
            result.issuerValid = true;

            // 2. Extract Data
            const revealed = await revealMdocData(mso, doc.issuerSigned.nameSpaces[doc.docType] || [], doc.docType);
            result.data = revealed;

            // 3. Verify Device Signature (Holder Binding)
            if (doc.deviceSigned && doc.deviceSigned.deviceAuth) {
                const deviceKeyMap = mso.deviceKeyInfo?.deviceKey;
                let x, y;
                if (deviceKeyMap instanceof Map) {
                    x = deviceKeyMap.get(-2);
                    y = deviceKeyMap.get(-3);
                } else {
                    x = deviceKeyMap[-2] || deviceKeyMap['-2'];
                    y = deviceKeyMap[-3] || deviceKeyMap['-3'];
                }

                const jwk = {
                    kty: "EC", crv: "P-384", x: Buffer.from(x).toString('base64url'), y: Buffer.from(y).toString('base64url')
                };
                const deviceKey = await crypto.subtle.importKey(
                    "jwk", jwk, { name: "ECDSA", namedCurve: "P-384" }, true, ["verify"]
                );

                const coseArray = decode(doc.deviceSigned.deviceAuth);
                const [protectedHeaderBytes, _, payloadBytes, signature] = coseArray;

                const sigStructure = [
                    "Signature1",
                    protectedHeaderBytes,
                    new Uint8Array(0),
                    payloadBytes
                ];
                const toBeVerified = encodeCanonical(sigStructure);

                result.deviceValid = await crypto.subtle.verify(
                    { name: "ECDSA", hash: { name: "SHA-384" } },
                    deviceKey,
                    signature,
                    toBeVerified as any
                );
            }
        } catch (e: any) {
            result.error = e.message;
        }
        results.push(result);
    }
    return results;
}
