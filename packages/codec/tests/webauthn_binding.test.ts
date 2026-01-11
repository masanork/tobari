import { test, expect, describe } from "bun:test";
import { getDeviceAuthToBeSigned, assembleWebAuthnDeviceAuth } from "../src/sd";
import { verifyPresentation } from "../src/validator";
import { encodeCanonical } from "@tobari/crypto/cbor";

describe("WebAuthn Holder Binding Protocol", () => {
    async function createWebAuthnAssertion(toBeSigned: Uint8Array, keyPair: CryptoKeyPair) {
        const mdocHash = new Uint8Array(await crypto.subtle.digest("SHA-256", toBeSigned));
        const challenge = Buffer.from(mdocHash).toString('base64url').replace(/=/g, '');

        const clientDataJSON = JSON.stringify({
            type: "webauthn.get",
            challenge: challenge,
            origin: "https://localhost",
            crossOrigin: false
        });
        const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientDataJSON)));
        const authData = new Uint8Array(37).fill(0); 

        const webauthnSignedData = new Uint8Array(authData.length + clientDataHash.length);
        webauthnSignedData.set(authData);
        webauthnSignedData.set(clientDataHash, authData.length);

        const signature = new Uint8Array(await crypto.subtle.sign(
            { name: "ECDSA", hash: { name: "SHA-256" } },
            keyPair.privateKey,
            webauthnSignedData
        ));

        return { signature, authData, clientDataJSON };
    }

    test("Should verify a VP signed via WebAuthn simulation", async () => {
        const docType = "io.github.masanork.tobari.test.v1";
        const deviceNamespacesBytes = encodeCanonical(new Map());
        const verifierNonce = "random-nonce-123";
        const sessionTranscript = [null, null, verifierNonce];

        // 1. Holder: Get data to be signed
        const { toBeSigned, protectedHeaderBytes } = await getDeviceAuthToBeSigned(
            docType,
            deviceNamespacesBytes,
            sessionTranscript,
            -7 // ES256
        );

        // 2. Holder (WebAuthn Simulation)
        const deviceKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
        const { signature, authData, clientDataJSON } = await createWebAuthnAssertion(toBeSigned, deviceKeyPair);

        // 3. Assemble DeviceAuth
        const deviceAuth = await assembleWebAuthnDeviceAuth(
            protectedHeaderBytes, docType, deviceNamespacesBytes, sessionTranscript, signature, authData, clientDataJSON
        );

        // 4. Verifier: Setup mock document and MSO
        const deviceKeyJwk = await crypto.subtle.exportKey("jwk", deviceKeyPair.publicKey);
        const deviceKeyMap = new Map<number, any>([
            [1, 2], // kty: EC2
            [-1, 1], // crv: P-256
            [-2, Buffer.from(deviceKeyJwk.x!, 'base64url')],
            [-3, Buffer.from(deviceKeyJwk.y!, 'base64url')]
        ]);

        const mso = {
            version: "1.0",
            digestAlgorithm: "SHA-256",
            valueDigests: { [docType]: {} },
            deviceKeyInfo: { deviceKey: deviceKeyMap },
            docType,
            validityInfo: { signed: new Date(), validUntil: new Date() }
        };

        // Create Real Issuer Signature
        const { createFormToken } = await import("@tobari/crypto/cose");
        const issuerKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
        const issuerAuthToken = await createFormToken(mso, issuerKeyPair.privateKey, { alg: -35 });
        const issuerAuthBinary = Buffer.from(issuerAuthToken, 'base64url');

        const presentation = {
            documents: [{
                docType,
                issuerSigned: { nameSpaces: { [docType]: [] }, issuerAuth: issuerAuthBinary },
                deviceSigned: { nameSpaces: deviceNamespacesBytes, deviceAuth: deviceAuth }
            }]
        };

        // 5. Verify
        const results = await verifyPresentation(presentation, { [docType]: issuerKeyPair.publicKey }, verifierNonce);

        expect(results[0].error).toBeNull();
        expect(results[0].deviceValid).toBe(true);
    });

    test("Should fail if WebAuthn challenge does not match mdoc hash", async () => {
        const docType = "io.github.masanork.tobari.test.v1";
        const verifierNonce = "correct-nonce";
        const sessionTranscript = [null, null, verifierNonce];

        const { toBeSigned, protectedHeaderBytes } = await getDeviceAuthToBeSigned(docType, new Uint8Array(0), sessionTranscript, -7);

        const deviceKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
        
        // Use WRONG challenge
        const clientDataJSON = JSON.stringify({ type: "webauthn.get", challenge: "wrong-one", origin: "https://localhost" });
        const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientDataJSON)));
        const authData = new Uint8Array(37).fill(0);
        const webauthnSignedData = new Uint8Array(authData.length + clientDataHash.length);
        webauthnSignedData.set(authData); webauthnSignedData.set(clientDataHash, authData.length);
        const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: { name: "SHA-256" } }, deviceKeyPair.privateKey, webauthnSignedData));

        const deviceAuth = await assembleWebAuthnDeviceAuth(protectedHeaderBytes, docType, new Uint8Array(0), sessionTranscript, signature, authData, clientDataJSON);

        const mso = {
            version: "1.0", digestAlgorithm: "SHA-256", valueDigests: { [docType]: {} },
            deviceKeyInfo: { deviceKey: new Map([[1, 2], [-1, 1], [-2, Buffer.from((await crypto.subtle.exportKey("jwk", deviceKeyPair.publicKey)).x!, 'base64url')], [-3, Buffer.from((await crypto.subtle.exportKey("jwk", deviceKeyPair.publicKey)).y!, 'base64url')]]) },
            docType, validityInfo: { signed: new Date(), validUntil: new Date() }
        };
        const { createFormToken } = await import("@tobari/crypto/cose");
        const issuerKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
        const issuerAuthBinary = Buffer.from(await createFormToken(mso, issuerKeyPair.privateKey, { alg: -35 }), 'base64url');

        const presentation = {
            documents: [{
                docType,
                issuerSigned: { nameSpaces: { [docType]: [] }, issuerAuth: issuerAuthBinary },
                deviceSigned: { nameSpaces: new Uint8Array(0), deviceAuth: deviceAuth }
            }]
        };

        const results = await verifyPresentation(presentation, { [docType]: issuerKeyPair.publicKey }, verifierNonce);
        
        expect(results[0].deviceValid).toBe(false);
        expect(results[0].error).toContain("WebAuthn challenge mismatch");
    });
});