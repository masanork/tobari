import { signCoseSign1, verifyFormToken } from './packages/crypto/src/cose';
import { COSE_ALG } from './packages/crypto/src/utils';

async function testES384() {
    console.log("Testing ES384 (P-384)...");

    // 1. Generate P-384 KeyPair
    const keyPair = await crypto.subtle.generateKey(
        {
            name: "ECDSA",
            namedCurve: "P-384",
        },
        true,
        ["sign", "verify"]
    );

    const payload = {
        message: "Hello Tobari with P-384!",
        timestamp: Date.now()
    };

    // 2. Sign
    const coseBytes = await signCoseSign1(payload, keyPair.privateKey, {
        alg: COSE_ALG.ES384,
        kid: "test-key-p384"
    });

    console.log(`Signed COSE size: ${coseBytes.length} bytes`);

    // 3. Verify
    // For verifyFormToken, it expects a base64url string
    const { base64url } = await import('./packages/crypto/src/utils');
    const token = base64url.encode(coseBytes);

    const decoded = await verifyFormToken(token, keyPair.publicKey);
    console.log("Verification successful!", decoded);
}

testES384().catch(console.error);
