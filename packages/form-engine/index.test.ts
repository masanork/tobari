import { expect, test, describe, beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// 1. Register DOM environment BEFORE importing Lit components
GlobalRegistrator.register();

// 2. Import the component (this registers the custom element)
import { TobariForm } from "./src/tobari-form";

describe("Tobari Form Engine (v2)", () => {
    let form: TobariForm;

    beforeEach(async () => {
        // Clean body
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }

        // Create new instance
        // Note: In some test envs, constructor might need to be called after definition
        if (!customElements.get('tobari-form')) {
            // Force evaluation if needed, but import should have triggered it
        }

        form = new TobariForm();
        document.body.appendChild(form);

        // Wait for Lit to complete initial update
        await form.updateComplete;
    });

    const validSchema = {
        meta: { title: "Test Form", version: "1.0", security: "standard" },
        fields: [
            { key: "name", type: "text", label: "Name", required: true },
            { key: "age", type: "integer", label: "Age" }
        ]
    };

    test("Initializes with schema", async () => {
        form.setSchema(validSchema);
        await form.updateComplete;

        expect(form.shadowRoot).not.toBeNull();
        const headers = form.shadowRoot!.querySelectorAll('h1');
        expect(headers.length).toBe(1);
        expect(headers[0].textContent).toBe("Test Form");
    });

    test("Renders Inputs based on schema", async () => {
        form.setSchema(validSchema);
        await form.updateComplete;

        const inputs = form.shadowRoot!.querySelectorAll('input');
        expect(inputs.length).toBe(2); // name, age

        // Check specific attributes
        const nameInput = inputs[0];
        expect(nameInput.type).toBe('text');
        expect(nameInput.required).toBe(true);
    });

    test("Updates FormData on Input", async () => {
        form.setSchema(validSchema);
        await form.updateComplete;

        const nameInput = form.shadowRoot!.querySelector('input[type="text"]') as HTMLInputElement;

        // Simulate Input
        nameInput.value = "John Doe";
        nameInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

        await form.updateComplete;

        // We can't access private formData directly easily in TS unless we cast to any or expose getter
        // But we can check via submit or by exposing a test getter. 
        // For now let's modify the component to expose getFormData() or use 'any'.
        expect((form as any).formData.name).toBe("John Doe");
    });

    test("Emits submit event with data", async () => {
        form.setSchema(validSchema);
        await form.updateComplete;

        // Fill data
        (form as any).formData = { name: "Alice", age: 30 };

        let submittedData: any = null;
        form.addEventListener('tobari-submit', (e: any) => {
            submittedData = e.detail.data;
        });

        // Simulate Form Submit (Programmatically calling submit method or finding form element)
        // The render method puts a <form> inside shadowRoot
        const internalForm = form.shadowRoot!.querySelector('form') as HTMLFormElement;
        internalForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

        expect(submittedData).not.toBeNull();
        expect(submittedData.name).toBe("Alice");
        expect(submittedData.age).toBe(30);
    });
});
