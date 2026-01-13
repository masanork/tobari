import { test, expect, describe } from "bun:test";
import { generateSignedTobari } from "../src/tobari-gen";
import { verifyTobari, verifyPresentation } from "../src/validator";
import { COSE_ALG } from "@tobari/crypto/utils";

describe("Validator", () => {
    const schemaYaml = `
id: io.github.masanork.tobari.test.v1
fields:
  - id: name
    label: Name
  - id: email
    label: Email
`;

    test("should verify a signed Tobari document", async () => {
        const issuerKeyPair = await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-384" },
            true,
            ["sign", "verify"]
        );

        const data = {
            name: "Alice",
            email: "alice@example.com"
        };

        const signedTobari = await generateSignedTobari(
            schemaYaml,
            data,
            issuerKeyPair.privateKey,
            { alg: COSE_ALG.ES384 }
        );

        const result = await verifyTobari(signedTobari, issuerKeyPair.publicKey);

        expect(result.isValid).toBe(true);
        expect(result.mso?.docType).toBe("io.github.masanork.tobari.test.v1");
        
        const revealed = await import("../src/sd").then(m => m.revealMdocData(result.mso!, result.doc.issuerSigned.nameSpaces[result.mso!.docType], result.mso!.docType));
        expect(revealed.name["@value"]).toBe("Alice");
    });

    test("should fail verification with wrong public key", async () => {
        const issuerKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
        const otherKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);

        const signedTobari = await generateSignedTobari(schemaYaml, { name: "Alice" }, issuerKeyPair.privateKey);

        const result = await verifyTobari(signedTobari, otherKeyPair.publicKey);

        expect(result.isValid).toBe(false);
        expect(result.error).toBeDefined();
    });

    test("should verify a presentation (integration test)", async () => {
        const docType = "io.github.masanork.tobari.test.v1";
        const issuerKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
        const deviceKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);

        const data = { name: "Bob", email: "bob@example.com" };
        
        // 1. Generate Signed Doc
        const signedTobari = await generateSignedTobari(
            schemaYaml,
            data,
            issuerKeyPair.privateKey,
            { 
                alg: COSE_ALG.ES384,
                devicePublicKey: deviceKeyPair.publicKey
            }
        );

        const { decode } = await import("@tobari/crypto/cbor");
        const doc = decode(signedTobari);

        // 2. Create Presentation (Disclosure)
        const { createPresentation, signDeviceAuth } = await import("../src/sd");
        const vp = await createPresentation(doc, ["name"]); // Disclose only "name"

        // 3. Add Device Signature
        const verifierNonce = "nonce-999";
        const sessionTranscript = [null, null, verifierNonce];
        const deviceNamespacesBytes = new Uint8Array(0);

        const deviceAuth = await signDeviceAuth(
            docType,
            deviceNamespacesBytes,
            sessionTranscript,
            deviceKeyPair.privateKey,
            -35 // ES384
        );

        vp.deviceSigned = {
            nameSpaces: deviceNamespacesBytes,
            deviceAuth: deviceAuth
        };

        const presentation = {
            documents: [vp]
        };

        // 4. Verify Presentation
        const results = await verifyPresentation(
            presentation,
            { [docType]: issuerKeyPair.publicKey },
            verifierNonce
        );

        expect(results[0].issuerValid).toBe(true);
        expect(results[0].deviceValid).toBe(true);
        expect(results[0].data.name["@value"]).toBe("Bob");
        expect(results[0].data.email).toBeUndefined();
    });

    test("should handle ECIES-encrypted Tobari document", async () => {
        const issuerKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
        const encryptionKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
        const encryptionPubKey = new Uint8Array(await crypto.subtle.exportKey("raw", encryptionKeyPair.publicKey));

        const data = { name: "Charlie" };
        const signedEncrypted = await generateSignedTobari(schemaYaml, data, issuerKeyPair.privateKey, {
            encryptionPublicKey: encryptionPubKey
        });

        const text = new TextDecoder().decode(signedEncrypted);
        const wrapper = JSON.parse(text);
        expect(wrapper.tobari_enc).toBe(true);

        // Decrypt first
        const { decryptTobariEcies } = await import("@tobari/crypto/tobari-ecies");
        const decrypted = await decryptTobariEcies(encryptionKeyPair.privateKey, wrapper);

        // Then verify
        const result = await verifyTobari(decrypted, issuerKeyPair.publicKey);
        expect(result.isValid).toBe(true);
        
        const revealed = await import("../src/sd").then(m => m.revealMdocData(result.mso!, result.doc.issuerSigned.nameSpaces[result.mso!.docType], result.mso!.docType));
        expect(revealed.name["@value"]).toBe("Charlie");
    });
});
