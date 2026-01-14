import { expect, test, describe } from "bun:test";
import { FormDefinitionSchema } from "./src/schema";

describe("Tobari Form Engine (v2) - Schema Validation", () => {

    test("Valid Schema Parsing", () => {
        const validSchema = {
            meta: { title: "Test Form", version: "1.0", security: "standard" },
            fields: [
                { key: "name", type: "text", label: "Name", required: true },
                { key: "age", type: "integer", label: "Age", min: 0 }
            ]
        };

        const parsed = FormDefinitionSchema.parse(validSchema);
        expect(parsed.meta.title).toBe("Test Form");
        expect(parsed.fields.length).toBe(2);
        expect(parsed.fields[0].type).toBe("text");
    });

    test("Invalid Schema Parsing (Missing Meta)", () => {
        const invalidSchema = {
            fields: []
        };
        expect(() => FormDefinitionSchema.parse(invalidSchema)).toThrow();
    });

    test("Invalid Field Type", () => {
        const invalidSchema = {
            meta: { title: "Bad Form" },
            fields: [
                { key: "foo", type: "unknown_type" }
            ]
        };
        expect(() => FormDefinitionSchema.parse(invalidSchema)).toThrow();
    });

    test("Group Field Structure", () => {
        const groupSchema = {
            meta: { title: "Group Form" },
            fields: [
                {
                    key: "address",
                    type: "group",
                    fields: [
                        { key: "zip", type: "text" }
                    ]
                }
            ]
        };
        const parsed = FormDefinitionSchema.parse(groupSchema);
        expect(parsed.fields[0].type).toBe("group");
        // @ts-ignore
        expect(parsed.fields[0].fields[0].key).toBe("zip");
    });
});
