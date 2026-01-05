import { signCoseSign1 } from '@tobari/crypto/cose';
import { COSE_ALG } from '@tobari/crypto/utils';
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
}

export async function generateSignedTobari(
    schemaYaml: string,
    data: any,
    privateKey: CryptoKey,
    options: { kid?: string; alg?: number } = {}
): Promise<Uint8Array> {
    const schema = yaml.load(schemaYaml) as any;
    // Use the schema ID itself as the mdoc Namespace
    const namespace = schema.id;

    // 0. Generate "Device Key" (simulating a Passkey/Holder Key)
    // In a real system, the holder would provide their public key.
    // Here we generate one and save the private key for the presentation demo.
    console.log("Generating Holder Device Key (P-384)...");
    const deviceKeyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    // Save Private Key for present-cli
    const devicePrivateJwk = await crypto.subtle.exportKey("jwk", deviceKeyPair.privateKey);
    fs.writeFileSync("device-key.json", JSON.stringify(devicePrivateJwk, null, 2));
    console.log("Saved Holder Private Key to device-key.json");

    // 1. Transform data to mdoc format (MSO + SignedItems)
    // Pass devicePublicKey to embed it in the MSO
    const { mso, issuerSignedItems } = await transformToMdocData(schema.id, data, schema.fields, namespace, deviceKeyPair.publicKey);

    // 2. Sign the MSO
    const issuerAuth = await signCoseSign1(mso, privateKey, {
        alg: options.alg || (COSE_ALG.ES384 as any),
        kid: options.kid
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
        fields: schema.fields
    };

    const { encodeCanonical } = await import('@tobari/crypto/cbor');
    return encodeCanonical(doc);
}
