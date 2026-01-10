// Algorithm identifiers for COSE
export const COSE_ALG = {
    ES256: -7, // ECDSA w/ SHA-256
    ES384: -35, // ECDSA w/ SHA-384
    EdDSA: -8  // EdDSA (Ed25519)
} as const;

export type CoseAlg = typeof COSE_ALG[keyof typeof COSE_ALG];

export const COSE_HEADER_LABELS = {
    alg: 1,
    crit: 2,
    content_type: 3,
    kid: 4,
    IV: 5,
    Partial_IV: 6,
    Countersignature: 11,   // RFC 9338
    Countersignature0: 12   // RFC 9338
} as const;

// Base64URL utilities
export const base64url = {
    encode: (buffer: Uint8Array): string => {
        const base64 = btoa(String.fromCharCode(...buffer));
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decode: (str: string): Uint8Array => {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) str += '=';
        const binary = atob(str);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
};
