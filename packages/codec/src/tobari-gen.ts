import { signCoseSign1 } from '@tobari/crypto/cose';
import { COSE_ALG } from '@tobari/crypto/utils';
import yaml from 'js-yaml';
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

    // 1. Transform data to mdoc format (MSO + SignedItems)
    const { mso, issuerSignedItems } = await transformToMdocData(schema.id, data, schema.fields, namespace);

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
