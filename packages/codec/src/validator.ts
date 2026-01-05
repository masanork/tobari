import { decode } from 'cbor-x';
import { verifyFormToken } from '@tobari/crypto/cose';
import { base64url } from '@tobari/crypto/utils';
import { MSO } from './sd';

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
