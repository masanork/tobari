import { signCoseSign1 } from '@tobari/crypto/cose';
import { COSE_ALG } from '@tobari/crypto/utils';
import { encodeCanonical } from '@tobari/crypto/cbor';
import yaml from 'js-yaml';

export interface TobariFile {
    schema_id: string;
    version: string;
    created_at: number;
    data: any;
    display?: any;
}

export async function generateSignedTobari(
    schemaYaml: string,
    data: any,
    privateKey: CryptoKey,
    options: { kid?: string; alg?: number } = {}
): Promise<Uint8Array> {
    const schema = yaml.load(schemaYaml) as any;

    const payload: TobariFile = {
        schema_id: schema.id,
        version: schema.version,
        created_at: Math.floor(Date.now() / 1000),
        data: data,
        display: schema.display
    };

    // For now, we sign the entire payload as a COSE_Sign1 structure.
    // In Phase 2, we can implement Selective Disclosure by signing salted hashes.
    return await signCoseSign1(payload, privateKey, {
        alg: options.alg || COSE_ALG.ES384,
        kid: options.kid
    });
}
