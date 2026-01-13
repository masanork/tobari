import { signCoseSign1 } from '@tobari/crypto/cose';
import { COSE_ALG } from '@tobari/crypto/utils';
import { encryptTobariEcies } from '@tobari/crypto/tobari-ecies';
import yaml from 'js-yaml';
import fs from 'fs';
import { transformToMdocData } from './sd';

/**
 * ISO 18013-5 IssuerSigned structure
 */
export interface IssuerSigned {
    nameSpaces: {
        [namespace: string]: Uint8Array[]; // IssuerSignedItemBytes
    };
    issuerAuth: Uint8Array; // COSE_Sign1 of MSO
}

/**
 * Tobari Doc structure (Top level)
 */
export interface TobariDoc {
    docType: string;
    issuerSigned: IssuerSigned;
    // self-described schema for the viewer
    fields: any[];
    // Encrypted/Signed visual assets
    visuals?: {
        font?: Uint8Array; // Raw WOFF2/TTF binary
    };
}

export async function generateSignedTobari(
    schemaYaml: string,
    data: any,
    privateKey: CryptoKey,
    options: {
        kid?: string;
        alg?: number;
        devicePublicKey?: CryptoKey;
        useLtvMock?: boolean;
        pqcCountersign?: {
            privateKey: Uint8Array;
            kid?: string;
            alg?: number;
        };
        encryptionPublicKey?: Uint8Array; // EC P-256 Public Key (Raw or CryptoKey)
        encryptionPqcPublicKey?: Uint8Array; // (Unused in ECIES)
        embeddedFont?: Uint8Array;        // Raw font binary
        devicePqcPublicKey?: Uint8Array;  // PQC Device Key
        pqcEncrypt?: boolean;             // (Unused in ECIES)
        encryptionAlg?: any;          // (Unused in ECIES)
        externalSigner?: (msoHash: Uint8Array) => Promise<Uint8Array>; // For hardware-bound signing
    } = {}
): Promise<Uint8Array> {
    // 1. Parse Schema & Transform Data
    const schema = yaml.load(schemaYaml) as any;
    const namespace = schema.id; // Use schema ID as namespace

    const { mso, issuerSignedItems } = await transformToMdocData(
        schema.id,
        data,
        schema.fields,
        namespace,
        options.devicePublicKey,
        options.devicePqcPublicKey
    );

    // 2. Sign MSO
    let issuerAuth: Uint8Array;
    
    if (options.externalSigner) {
        // Prepare the data to be signed (COSE_Sign1 payload is the MSO bytes)
        // ISO 18013-5 requires signing the MSO within a COSE_Sign1 structure.
        // For hardware signers, we might need to handle the whole COSE construction here.
        const { encodeCanonical } = await import('@tobari/crypto/cbor');
        const msoBytes = encodeCanonical(mso);
        const msoHash = new Uint8Array(await crypto.subtle.digest("SHA-256", msoBytes));
        
        const signature = await options.externalSigner(msoHash);
        
        // Assemble COSE_Sign1 manually or via helper
        const protectedHeader = new Map([[1, options.alg || COSE_ALG.ES384]]);
        const unprotectedHeader = new Map();
        if (options.kid) unprotectedHeader.set(4, new TextEncoder().encode(options.kid));
        
        const sigStructure = [
            "Signature1",
            encodeCanonical(protectedHeader),
            new Uint8Array(0),
            msoBytes
        ];
        const toBeSigned = encodeCanonical(sigStructure);
        
        // If the external signer only signs the hash, we use its output. 
        // Note: The externalSigner logic should ideally handle the Sig_structure hash.
        
        const { encode } = await import('cbor-x');
        issuerAuth = encode([
            encodeCanonical(protectedHeader),
            unprotectedHeader,
            msoBytes,
            signature
        ]);
    } else {
        const { encodeCanonical } = await import('@tobari/crypto/cbor');
        const msoBytes = encodeCanonical(mso);
        issuerAuth = await signCoseSign1(msoBytes, privateKey, {
            kid: options.kid,
            alg: options.alg || COSE_ALG.ES384
        });
    }

    // 3. Construct the TobariDoc (mdoc-inspired)
    const doc: TobariDoc = {
        docType: schema.id,
        issuerSigned: {
            nameSpaces: {
                [namespace]: issuerSignedItems
            },
            issuerAuth
        },
        fields: schema.fields,
        visuals: options.embeddedFont ? { font: options.embeddedFont } : undefined
    };

    const { encodeCanonical } = await import('@tobari/crypto/cbor');
    const encoded = encodeCanonical(doc);

    // 4. Optional Encryption (Tobari Custom ECIES)
    if (options.encryptionPublicKey) {
        console.error("Applying Tobari ECIES Encryption to payload...");
        
        // Ensure key is CryptoKey (P-256)
        let pubKey: CryptoKey;
        if (options.encryptionPublicKey instanceof Uint8Array) {
             // Import raw P-256 public key
             pubKey = await crypto.subtle.importKey(
                 "raw",
                 options.encryptionPublicKey,
                 { name: "ECDH", namedCurve: "P-256" },
                 true,
                 []
             );
        } else {
            // Already CryptoKey (assume correct usage)
             pubKey = options.encryptionPublicKey as unknown as CryptoKey;
        }

        const encrypted = await encryptTobariEcies(pubKey, encoded);

        // Wrap in JSON for signer-macos and other readers
        // All components should be Base64URL
        return new TextEncoder().encode(JSON.stringify({
            ephemeralPublicKey: encrypted.ephemeralPublicKey,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            tag: encrypted.tag,
            tobari_enc: true
        }));
    }

    return encoded;
}
