import { expect, test, describe } from "bun:test";
import { createPresentation } from "./sd";

// We need to use the same CBOR library for mock generation
const { encodeCanonical: encode } = await import('../../crypto/src/cbor');

describe("Selective Disclosure (sd.ts)", () => {
  test("creates a presentation with selected fields", async () => {
    // 1. Create mock IssuerSignedItem bytes
    const item1 = encode({
      digestID: 1,
      random: new Uint8Array(16),
      elementIdentifier: "family_name",
      elementValue: "Yamada"
    });
    const item2 = encode({
      digestID: 2,
      random: new Uint8Array(16),
      elementIdentifier: "given_name",
      elementValue: "Taro"
    });

    // 2. Create mock MSO
    const mso = {
      version: "1.0",
      digestAlgorithm: "SHA-256",
      valueDigests: {
        "org.iso.18013.5.1": {
          1: new Uint8Array(32), // dummy hashes
          2: new Uint8Array(32)
        }
      },
      docType: "org.iso.18013.5.1",
      validityInfo: {
        signed: "2026-01-01T00:00:00Z",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2031-01-01T00:00:00Z"
      }
    };
    const msoBytes = encode(mso);

    // 3. Create mock COSE Sign1 for issuerAuth (simplified)
    const issuerAuth = encode([
      new Uint8Array([0xa1, 0x01, 0x26]), // protected: {alg: ES256}
      {}, // unprotected
      msoBytes, // payload (MSO)
      new Uint8Array(64) // signature
    ]);

    // 4. Create full Document structure
    const doc = {
      docType: "org.iso.18013.5.1",
      issuerSigned: {
        nameSpaces: {
          "org.iso.18013.5.1": [item1, item2]
        },
        issuerAuth: issuerAuth
      }
    };

    // 5. Test: Only disclose "family_name"
    const vp = await createPresentation(doc, ["family_name"]);

    expect(vp.docType).toBe("org.iso.18013.5.1");
    expect(vp.issuerSigned.nameSpaces["org.iso.18013.5.1"]).toHaveLength(1);
    
    // Check if the item is indeed family_name
    const { decode } = await import('../../crypto/src/cbor');
    const disclosedItem = decode(vp.issuerSigned.nameSpaces["org.iso.18013.5.1"][0]);
    expect(disclosedItem.elementIdentifier).toBe("family_name");
    expect(disclosedItem.elementValue).toBe("Yamada");

    // Ensure issuerAuth is preserved
    expect(vp.issuerSigned.issuerAuth).toEqual(issuerAuth);
  });
});
