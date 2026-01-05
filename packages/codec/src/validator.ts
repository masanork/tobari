import { decode } from 'cbor-x';
import { verifyFormToken } from '@tobari/crypto/cose';
import { base64url } from '@tobari/crypto/utils';

export interface VerificationResult {
    isValid: boolean;
    header: any;
    payload: any;
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
            // Support both raw base64 and DataURI
            const b64 = input.includes(',') ? input.split(',')[1] : input;
            binary = base64url.decode(b64);
        } else {
            binary = input;
        }

        // Verify COSE signature and decode payload
        // Note: verifyFormToken in crypto package handles the COSE state machine
        const token = base64url.encode(binary);
        const payload = await verifyFormToken(token, publicKey);

        // Also peek at protected header for alg info
        const coseArray = decode(binary);
        const protectedHeader = decode(coseArray[0]);

        return {
            isValid: true,
            header: protectedHeader,
            payload: payload
        };
    } catch (e: any) {
        return {
            isValid: false,
            header: null,
            payload: null,
            error: e.message || String(e)
        };
    }
}
