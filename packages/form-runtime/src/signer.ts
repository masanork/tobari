import { encode } from 'cbor-x';

// Minimal COSE Constants
const COSE_ALG = {
    ES256: -7,
    EdDSA: -8
};

const COSE_HEADER = {
    alg: 1,
    kid: 4
};

// Minimal JWK thumbprint implementation for did:key
async function jwkToDidKey(publicKey: CryptoKey): Promise<string> {
    const jwk = await crypto.subtle.exportKey('jwk', publicKey);
    return `did:key:z${Buffer.from(jwk.x || '').toString('hex')}`; // Placeholder logic
}

export class WebAsigner {
    private keyPair: CryptoKeyPair | null = null;
    private did: string = '';

    public async register(): Promise<boolean> {
        try {
            this.keyPair = await crypto.subtle.generateKey(
                {
                    name: "ECDSA",
                    namedCurve: "P-256"
                },
                true,
                ["sign", "verify"]
            );
            this.did = await jwkToDidKey(this.keyPair.publicKey);
            console.log("[Signer] Generated Identity:", this.did);
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    public getPublicKey() {
        return this.keyPair?.publicKey || null;
    }

    public getIssuerDid() {
        return this.did || "did:web:anonymous";
    }

    public async sign(payload: any): Promise<any> {
        if (!this.keyPair) throw new Error("Signer not registered");

        const vc = {
            ...payload,
            issuer: this.getIssuerDid(),
            issuanceDate: new Date().toISOString()
        };

        // 1. Prepare Headers (Protected)
        const protectedHeaderMap = new Map();
        protectedHeaderMap.set(COSE_HEADER.alg, COSE_ALG.ES256);
        protectedHeaderMap.set(COSE_HEADER.kid, new TextEncoder().encode(this.did));

        const protectedHeaderBytes = encode(protectedHeaderMap);
        const payloadBytes = encode(vc);

        // 2. Prepare Sig_structure
        const sigStructure = [
            "Signature1",
            protectedHeaderBytes,
            new Uint8Array(0), // external_aad
            payloadBytes
        ];

        const toBeSigned = encode(sigStructure);

        // 3. Sign
        const signatureBuffer = await crypto.subtle.sign(
            { name: 'ECDSA', hash: { name: 'SHA-256' } },
            this.keyPair.privateKey,
            toBeSigned
        );
        const signature = new Uint8Array(signatureBuffer);

        // 4. Assemble COSE_Sign1 (Not returned directly, but used for proof value)
        // const coseSign1 = [ protectedHeaderBytes, {}, payloadBytes, signature ];
        // const coseBytes = encodeCanonical(coseSign1);

        // For JSON-LD proof compatibility in this specific runtime:
        const b64 = btoa(String.fromCharCode(...signature));

        return {
            ...vc,
            proof: {
                type: "CoseSign1",
                created: new Date().toISOString(),
                verificationMethod: this.did + "#key-1",
                proofPurpose: "assertionMethod",
                signatureValue: b64
            }
        };
    }
}

export const globalSigner = new WebAsigner();
