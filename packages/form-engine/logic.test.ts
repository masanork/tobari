import { expect, test, describe } from "bun:test";
import "./src/tobari-form";
import { TobariForm } from "./src/tobari-form";

describe("TobariForm Logic Unit Tests", () => {
    
    function createFormInstance() {
        return new TobariForm();
    }

    test("Calculated Fields - Simple Arithmetic", () => {
        const form = createFormInstance();
        const schema = {
            meta: { title: "Calc Test", version: "1.0", security: "standard" },
            fields: [
                { key: "a", type: "integer" },
                { key: "b", type: "integer" },
                { key: "sum", type: "integer", formula: "a + b" }
            ]
        };
        form.setSchema(schema);

        // Directly call methods instead of triggering DOM events
        form.handleInput({ target: { value: "10", type: "number" } }, ["a"]);
        form.handleInput({ target: { value: "20", type: "number" } }, ["b"]);

        const data = (form as any).formData;
        expect(data.a).toBe(10);
        expect(data.b).toBe(20);
        expect(data.sum).toBe(30);
    });

    test("Calculated Fields - SUM in Array", () => {
        const form = createFormInstance();
        const schema = {
            meta: { title: "Array Calc Test", version: "1.0", security: "standard" },
            fields: [
                {
                    key: "items",
                    type: "array",
                    itemSchema: {
                        type: "group",
                        key: "item",
                        fields: [
                            { key: "price", type: "integer" }
                        ]
                    }
                },
                { key: "total", type: "integer", formula: "SUM(price)" }
            ]
        };
        form.setSchema(schema);

        form.handleAddItem(["items"], schema.fields[0].itemSchema as any);
        form.handleAddItem(["items"], schema.fields[0].itemSchema as any);

        form.handleInput({ target: { value: "100", type: "number" } }, ["items", "0", "price"]);
        form.handleInput({ target: { value: "250", type: "number" } }, ["items", "1", "price"]);

        const data = (form as any).formData;
        expect(data.total).toBe(350);
    });

    test("Autofill - Simple Mapping", () => {
        const form = createFormInstance();
        const schema = {
            meta: { title: "Autofill Test", version: "1.0", security: "standard" },
            fields: [
                { key: "name", type: "text", autofill: "jpki:name" },
                { key: "addr", type: "text", autofill: "jpki:address" }
            ]
        };
        form.setSchema(schema);

        const mockJpki = {
            name: "Taro Tobari",
            address: "Tokyo"
        };

        form.setPrefillData("jpki", mockJpki);
        form.applyPrefill("jpki");

        const data = (form as any).formData;
        expect(data.name).toBe("Taro Tobari");
        expect(data.addr).toBe("Tokyo");
    });

    test("Autofill - Nested Data Mapping", () => {
        const form = createFormInstance();
        const schema = {
            meta: { title: "Nested Autofill", version: "1.0", security: "standard" },
            fields: [
                { key: "id_num", type: "text", autofill: "passport:dg1.passport_number" }
            ]
        };
        form.setSchema(schema);

        const mockPassport = {
            dg1: {
                passport_number: "TK123456"
            }
        };

        form.setPrefillData("passport", mockPassport);
        form.applyPrefill("passport");

        const data = (form as any).formData;
        expect(data.id_num).toBe("TK123456");
    });

    test("Normalization Utility", () => {
        const form = createFormInstance();
        const normalized = form.normalize("１２３ＡＢＣ");
        expect(normalized).toBe("123abc");
    });
});