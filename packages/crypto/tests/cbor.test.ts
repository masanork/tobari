import { expect, test, describe } from "bun:test";
import { encodeCanonical, decode } from "../src/cbor";

describe("CBOR Canonical Encoding", () => {
    test("should preserve binary data (Uint8Array)", () => {
        const data = {
            id: 1,
            binary: new Uint8Array([0x01, 0x02, 0x03, 0xff]),
            nested: {
                raw: new Uint8Array([0xde, 0xad, 0xbe, 0xef])
            }
        };

        const encoded = encodeCanonical(data);
        const decoded = decode(encoded);

        expect(decoded.id).toBe(data.id);
        expect(decoded.binary).toBeInstanceOf(Uint8Array);
        expect(Array.from(decoded.binary)).toEqual([0x01, 0x02, 0x03, 0xff]);
        expect(decoded.nested.raw).toBeInstanceOf(Uint8Array);
        expect(Array.from(decoded.nested.raw)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });

    test("should ensure canonical key sorting (deterministic output)", () => {
        const obj1 = { b: 2, a: 1, c: { y: 2, x: 1 } };
        const obj2 = { a: 1, c: { x: 1, y: 2 }, b: 2 };

        const encoded1 = encodeCanonical(obj1);
        const encoded2 = encodeCanonical(obj2);

        // Byte-wise equality check
        expect(bufferToHex(encoded1)).toBe(bufferToHex(encoded2));
        
        // Ensure keys are actually sorted in the output (CBOR maps)
        // Note: Simple verification by checking the first few bytes isn't enough, 
        // but exact match of two differently ordered objects confirms deterministic sorting.
    });

    test("should handle complex types", () => {
        const data = {
            string: "hello",
            number: 123.456,
            bool: true,
            nullVal: null,
            array: [1, "two", new Uint8Array([3])]
        };

        const encoded = encodeCanonical(data);
        const decoded = decode(encoded);

        expect(decoded).toEqual(data);
    });
});

function bufferToHex(buffer: Uint8Array): string {
    return Array.from(buffer)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}
