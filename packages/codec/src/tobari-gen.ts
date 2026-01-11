import { signCoseSign1 } from '@tobari/crypto/cose';
import { COSE_ALG } from '@tobari/crypto/utils';
import { HPKE_ALG_CLASSIC, HPKE_ALG_HYBRID, encryptHpkeWithAlg, type HpkeAlg } from '@tobari/crypto/hpke';
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
        encryptionPublicKey?: Uint8Array; // HPKE Public Key
        encryptionPqcPublicKey?: Uint8Array; // ML-KEM Public Key
        embeddedFont?: Uint8Array;        // Raw font binary
        devicePqcPublicKey?: Uint8Array;  // PQC Device Key
        pqcEncrypt?: boolean;             // Simulate PQC Encryption
        encryptionAlg?: HpkeAlg;          // Explicit alg override
    } = {}
): Promise<Uint8Array> {
    const schema = yaml.load(schemaYaml) as any;
    // Use the schema ID itself as the mdoc Namespace
    const namespace = schema.id;

    let devicePublicKey = options.devicePublicKey;
    // ... (rest of device key logic remains same)

    if (!devicePublicKey) {
        const deviceKeyPath = "device-key.json";
        if (fs.existsSync(deviceKeyPath)) {
            console.log(`Reusing existing Holder Device Key from ${deviceKeyPath}`);
            const jwk = JSON.parse(fs.readFileSync(deviceKeyPath, 'utf-8'));
            // Import as private key first to ensure we handle the full JWK
            const privateKey = await crypto.subtle.importKey(
                "jwk", jwk, { name: "ECDSA", namedCurve: "P-384" }, true, ["sign"]
            );
            // In a real WebAuthn scenario, we would only have the public key here.
            // But for this mock-reusing logic, we need to get the public key from the pair or re-export.
            // Simplified: Generate a temporary pair from the same JWK or just use a known-good public key import.

            // Correct way to import public part of an EC JWK:
            const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
            devicePublicKey = await crypto.subtle.importKey(
                "jwk", pubJwk, { name: "ECDSA", namedCurve: "P-384" }, true, ["verify"]
            );
        } else {
            console.log("Generating New Holder Device Key (P-384)...");
            const deviceKeyPair = await crypto.subtle.generateKey(
                { name: "ECDSA", namedCurve: "P-384" },
                true,
                ["sign", "verify"]
            );

            const devicePrivateJwk = await crypto.subtle.exportKey("jwk", deviceKeyPair.privateKey);
            fs.writeFileSync(deviceKeyPath, JSON.stringify(devicePrivateJwk, null, 2));
            console.log("Saved Holder Private Key to device-key.json");
            devicePublicKey = deviceKeyPair.publicKey;
        }
    }

    // 1. Transform data to mdoc format (MSO + SignedItems)
    const { mso, issuerSignedItems } = await transformToMdocData(
        schema.id, 
        data, 
        schema.fields, 
        namespace, 
        devicePublicKey, 
        options.devicePqcPublicKey
    );

    // Prepare Countersignature (single slot)
    let countersignSetup;
    if (options.pqcCountersign) {
        const alg = options.pqcCountersign.alg ?? COSE_ALG.MLDSA65;
        countersignSetup = {
            alg,
            privateKey: options.pqcCountersign.privateKey,
            kid: options.pqcCountersign.kid
        };
    } else if (options.useLtvMock) {
        console.log("Generating LTV Mock (TSA) Countersignature...");
        const tsaKeyPair = await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["sign", "verify"]
        );
        countersignSetup = {
            alg: -7 as any, // ES256
            privateKey: tsaKeyPair.privateKey,
            kid: "mock-tsa-2026"
        };
    }

    // 2. Sign the MSO
    const issuerAuth = await signCoseSign1(mso, privateKey, {
        alg: options.alg || (COSE_ALG.ES384 as any),
        kid: options.kid,
        countersignSetup: countersignSetup
    });

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

    // 4. Optional Encryption (HPKE)
    if (options.encryptionPublicKey) {
        console.log("Applying HPKE Encryption to payload...");
        const info = new TextEncoder().encode("tobari-storage-v1");
        const alg: HpkeAlg =
            options.encryptionAlg
                ?? (options.pqcEncrypt ? HPKE_ALG_HYBRID : HPKE_ALG_CLASSIC);
        if (alg === HPKE_ALG_HYBRID && !options.encryptionPqcPublicKey) {
            throw new Error("Hybrid HPKE requires encryptionPqcPublicKey (ML-KEM-768 public key)");
        }

        const ciphertext = await encryptHpkeWithAlg({
            alg,
            publicKey: options.encryptionPublicKey,
            pqcPublicKey: options.encryptionPqcPublicKey,
            plaintext: encoded,
            info
        });

        // Wrap in a simple JSON for the demo viewer to detect encryption
        const wrapper = {
            tobari_enc: true,
            alg: alg,
            data: Buffer.from(ciphertext).toString('base64')
        };
        return new TextEncoder().encode(JSON.stringify(wrapper));
    }

    return encoded;
}
