import { signCoseSign1 } from '@tobari/crypto/cose';
import { COSE_ALG } from '@tobari/crypto/utils';
import yaml from 'js-yaml';
import { transformToSdData } from './sd';
import fs from 'fs';
import path from 'path';

export interface TobariFile {
    schema_id: string;
    version: string;
    created_at: number;
    data: any;
    disclosures?: string[];
    display?: any;
}

export async function generateSignedTobari(
    schemaYaml: string,
    data: any,
    privateKey: CryptoKey,
    options: { kid?: string; alg?: number } = {}
): Promise<Uint8Array> {
    const schema = yaml.load(schemaYaml) as any;

    // 1. Transform data to SD format
    const { redacted, disclosures } = await transformToSdData(data, schema.fields);

    // 2. Load the design template to be signed
    const layoutPath = path.resolve('packages/codec/src/juminhyo-layout.html');
    const template = fs.readFileSync(layoutPath, 'utf-8');

    const payload: TobariFile = {
        schema_id: schema.id,
        version: schema.version,
        created_at: Math.floor(Date.now() / 1000),
        data: redacted,
        disclosures: disclosures,
        display: {
            ...schema.display,
            template: template // The layout is now part of the signed payload!
        }
    };

    return await signCoseSign1(payload, privateKey, {
        alg: options.alg || COSE_ALG.ES384,
        kid: options.kid
    });
}
