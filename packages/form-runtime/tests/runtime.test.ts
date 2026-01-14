import { expect, test, describe, beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Setup DOM environment
GlobalRegistrator.register();

// Import runtime modules after DOM setup
import { Calculator } from "../src/calculator";
import { DataManager } from "../src/data";
import { UIManager } from "../src/ui";
import { checkRequiredFields } from "../src/validation-dialog";

describe("Web/A Runtime", () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        // Mock global objects
        (window as any).weba_structure = { masterData: {} };
        (window as any).generatedJsonStructure = {
            fields: [
                { key: "req", label: "Required Field", required: true, type: "text" }
            ]
        };

        // Mock offsetParent for happy-dom (it defaults to null/undefined which causes validation skip)
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
            get() { return this.parentNode; },
            configurable: true
        });
    });

    test("Calculator: Basic Multiplication", async () => {
        document.body.innerHTML = `
            <input id="price" data-json-path="price" value="100">
            <input id="qty" data-json-path="qty" value="3">
            <input id="total" data-json-path="total" data-formula="price * qty" value="">
        `;

        const calc = new Calculator("ja-JP"); // Locale doesn't matter much for this
        await calc.recalculate(document.body);

        const total = document.getElementById('total') as HTMLInputElement;
        expect(total.value).toBe("300");
    });

    test("Calculator: Complex formula", async () => {
        document.body.innerHTML = `
            <input data-json-path="a" value="1000">
            <input data-json-path="b" value="2000">
            <input id="sum" data-json-path="sum" data-formula="a + b" value="">
        `;

        const calc = new Calculator("ja-JP");
        await calc.recalculate(document.body);

        const sum = document.getElementById('sum') as HTMLInputElement;
        expect(sum.value).toBe("3000"); // Implementation does not format with commas
    });

    test("DataManager: Update JSON-LD from Input", async () => {
        document.body.innerHTML = `
            <input data-json-path="user.name" value="Alice">
            <input type="checkbox" data-json-path="agreed" checked>
        `;

        const dataMgr = new DataManager();
        const json = await dataMgr.updateJsonLd();

        // DataManager currently stores keys flatly as they are in the HTML
        expect(json['user.name']).toBe("Alice");
        expect(json.agreed).toBe(true);
    });

    // Test Validation if possible, though it usually involves dialogs
    test("Validation: Required field check", () => {
        document.body.innerHTML = `
            <input data-json-path="req" required value="">
            <div id="btn-submit" class="btn-submit-ready"></div>
        `;

        // Use validation function directly
        const result1 = checkRequiredFields();
        expect(result1.isValid).toBe(false);

        // Update value
        (document.querySelector('[data-json-path="req"]') as HTMLInputElement).value = "filled";
        const result2 = checkRequiredFields();
        expect(result2.isValid).toBe(true);
    });
});
