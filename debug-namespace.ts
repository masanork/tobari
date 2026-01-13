
import { generateSignedTobari } from './packages/codec/src/tobari-gen';
import { verifyTobari } from './packages/codec/src/validator';
import fs from 'fs';

async function test() {
    const schemaYaml = `
id: test.namespace.v1
title: Test
fields:
  - id: name
    type: string
`;
    const data = { name: "Test User" };
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    const binary = await generateSignedTobari(schemaYaml, data, keyPair.privateKey, {
        kid: "test-key"
    });

    const result = await verifyTobari(binary, keyPair.publicKey);
    console.log("Verification Result:", result.isValid);
    if (!result.isValid) {
        console.error("Error:", result.error);
    }
    console.log("DocType:", result.mso?.docType);
    console.log("Namespaces in MSO:", Object.keys(result.mso?.valueDigests || {}));
}

test().catch(console.error);
