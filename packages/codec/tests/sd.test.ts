import { test, expect, describe } from "bun:test";
import { transformToMdocData, revealMdocData, createPresentation } from "../src/sd";

describe("Selective Disclosure (SD)", () => {
    test("should roundtrip transform and reveal", async () => {
        const docType = "test.doc.v1";
        const data = {
            firstName: "John",
            lastName: "Doe",
            age: 30
        };
        const fields = [
            { id: "firstName", label: "First Name" },
            { id: "lastName", label: "Last Name" },
            { id: "age", label: "Age" }
        ];

        const deviceKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);

        // 1. Transform to mdoc structure
        const { mso, issuerSignedItems } = await transformToMdocData(
            docType,
            data,
            fields,
            docType,
            deviceKeyPair.publicKey
        );

        expect(mso.docType).toBe(docType);
        expect(mso.valueDigests[docType]).toBeDefined();
        expect(issuerSignedItems.length).toBe(3);

        // 2. Reveal all items
        const revealed = await revealMdocData(mso, issuerSignedItems, docType);

        expect(revealed.firstName["@value"]).toBe("John");
        expect(revealed.firstName["@disclosed"]).toBe(true);
        expect(revealed.lastName["@value"]).toBe("Doe");
        expect(revealed.age["@value"]).toBe(30);
    });

    test("should only reveal disclosed items", async () => {
        const docType = "test.doc.v1";
        const data = {
            firstName: "John",
            lastName: "Doe",
            secret: "keep-it-secret"
        };
        const fields = [
            { id: "firstName", label: "First Name" },
            { id: "lastName", label: "Last Name" },
            { id: "secret", label: "Secret" }
        ];

        const { mso, issuerSignedItems } = await transformToMdocData(docType, data, fields, docType);

        // Simulate selective disclosure: only provide firstName and lastName
        const { decode } = await import("@tobari/crypto/cbor");
        const filteredItems = issuerSignedItems.filter(itemBytes => {
            const item = decode(itemBytes);
            return item[2] !== "secret";
        });

        expect(filteredItems.length).toBe(2);

        const revealed = await revealMdocData(mso, filteredItems, docType);

        expect(revealed.firstName["@disclosed"]).toBe(true);
        expect(revealed.lastName["@disclosed"]).toBe(true);
        expect(revealed.secret).toBeUndefined();
    });

    test("should create a presentation with selected keys", async () => {
        const { encodeCanonical } = await import("@tobari/crypto/cbor");

        const docType = "test.doc.v1";
        const data = { a: 1, b: 2, c: 3 };
        const fields = [{ id: "a" }, { id: "b" }, { id: "c" }];

        const { mso, issuerSignedItems } = await transformToMdocData(docType, data, fields, docType);

        const fullDoc = {
            docType,
            issuerSigned: {
                nameSpaces: {
                    [docType]: issuerSignedItems
                },
                issuerAuth: new Uint8Array(0) // Mock
            }
        };

        const vp = await createPresentation(fullDoc, ["a", "c"]);

        expect(vp.issuerSigned.nameSpaces[docType].length).toBe(2);
        
        const { decode } = await import("@tobari/crypto/cbor");
        const keys = vp.issuerSigned.nameSpaces[docType].map((item: Uint8Array) => decode(item)[2]);
        expect(keys).toContain("a");
        expect(keys).toContain("c");
        expect(keys).not.toContain("b");
    });

    test("should handle hash mismatch", async () => {
        const docType = "test.doc.v1";
        const data = { test: "value" };
        const fields = [{ id: "test" }];

        const { mso, issuerSignedItems } = await transformToMdocData(docType, data, fields, docType);

        // Tamper with data
        const { decode, encodeCanonical } = await import("@tobari/crypto/cbor");
        const item = decode(issuerSignedItems[0]);
        item[3] = "tampered";
        const tamperedItemBytes = encodeCanonical(item);

        const revealed = await revealMdocData(mso, [tamperedItemBytes], docType);

        expect(revealed.test["@disclosed"]).toBe(false);
        expect(revealed.test["@error"]).toBe("Hash mismatch");
    });
});
