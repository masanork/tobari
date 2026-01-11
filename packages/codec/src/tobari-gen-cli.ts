import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { generateSignedTobari } from './tobari-gen';
import { COSE_ALG } from '@tobari/crypto/utils';

type ArgMap = Record<string, string | boolean>;

function parseArgs(argv: string[]): ArgMap {
    const args: ArgMap = {};
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
        } else {
            args[key] = next;
            i++;
        }
    }
    return args;
}

function usage() {
    console.log(`
Usage:
  bun run packages/codec/src/tobari-gen-cli.ts \\
    --schema <schema.yaml> \\
    --data <data.yaml|json> \\
    --out <output.cose> \\
    --issuer-private-key <issuer-private-key.json> \\
    [--issuer-kid <kid>] \\
    [--alg <cose-alg-id>] \\
    [--pqc] [--pqc-private-key <issuer-pqc-private-key.json>] [--pqc-public-key <issuer-pqc-public-key.json>]
`);
}

function readJsonFile(filePath: string) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function loadIssuerPrivateKey(jwkPath: string): Promise<CryptoKey> {
    const jwk = readJsonFile(jwkPath);
    return crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: jwk.crv || "P-384" },
        true,
        ["sign"]
    );
}

async function loadOrCreateIssuerPqcKeyPair(
    privateKeyPath: string,
    publicKeyPath: string
): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
    if (fs.existsSync(privateKeyPath)) {
        const stored = readJsonFile(privateKeyPath);
        const privateKey = Buffer.from(stored.privateKey, 'base64url');
        let publicKey: Uint8Array;
        if (fs.existsSync(publicKeyPath)) {
            const pubStored = readJsonFile(publicKeyPath);
            publicKey = Buffer.from(pubStored.publicKey, 'base64url');
        } else {
            publicKey = new Uint8Array(0);
        }
        return { privateKey: new Uint8Array(privateKey), publicKey: new Uint8Array(publicKey) };
    }

    const { generateMlDsa65KeyPair } = await import('@tobari/crypto/pqc');
    const keys = await generateMlDsa65KeyPair();
    fs.writeFileSync(privateKeyPath, JSON.stringify({
        alg: "ML-DSA-65",
        privateKey: Buffer.from(keys.privateKey).toString('base64url')
    }, null, 2));
    fs.writeFileSync(publicKeyPath, JSON.stringify({
        alg: "ML-DSA-65",
        publicKey: Buffer.from(keys.publicKey).toString('base64url')
    }, null, 2));
    return keys;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const schemaPath = args.schema as string | undefined;
    const dataPath = args.data as string | undefined;
    const outPath = (args.out as string | undefined) || 'output.cose';
    const issuerKeyPath = args['issuer-private-key'] as string | undefined;

    if (!schemaPath || !dataPath || !issuerKeyPath) {
        usage();
        process.exit(1);
    }

    const schemaYaml = fs.readFileSync(path.resolve(schemaPath), 'utf-8');
    const dataExt = path.extname(dataPath).toLowerCase();
    const dataRaw = fs.readFileSync(path.resolve(dataPath), 'utf-8');
    const data = dataExt === '.json' ? JSON.parse(dataRaw) : yaml.load(dataRaw);

    const issuerPrivateKey = await loadIssuerPrivateKey(path.resolve(issuerKeyPath));

    let pqcCountersign;
    if (args.pqc) {
        const pqcPrivatePath = path.resolve((args['pqc-private-key'] as string) || 'issuer-pqc-private-key.json');
        const pqcPublicPath = path.resolve((args['pqc-public-key'] as string) || 'issuer-pqc-public-key.json');
        const keys = await loadOrCreateIssuerPqcKeyPair(pqcPrivatePath, pqcPublicPath);
        pqcCountersign = {
            privateKey: keys.privateKey,
            kid: (args['pqc-kid'] as string) || 'iss-local-mldsa65',
            alg: COSE_ALG.MLDSA65
        };
    }

    const alg = args.alg ? Number(args.alg) : undefined;
    const kid = args['issuer-kid'] as string | undefined;

    const binary = await generateSignedTobari(schemaYaml, data, issuerPrivateKey, {
        kid,
        alg,
        pqcCountersign
    });

    fs.writeFileSync(path.resolve(outPath), binary);
    console.log(`✅ Generated: ${path.resolve(outPath)}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
