import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test";
import { TobariForm } from "../src/tobari-form";

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value.toString(); },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; }
    };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

describe("TobariForm Logic Tests", () => {
    let form: TobariForm;

    beforeEach(() => {
        form = new TobariForm();
        localStorage.clear();
    });

    test("Formula Evaluation - Simple Arithmetic", () => {
        const schema = {
            meta: { title: "Calc", version: "1.0" },
            fields: [
                { type: "integer", key: "a" },
                { type: "integer", key: "b" },
                { type: "integer", key: "total", formula: "a + b" }
            ]
        };
        form.setSchema(schema);
        
        // Simulate input
        (form as any).handleInput({ target: { value: 10, type: "number" } } as any, ["a"]);
        (form as any).handleInput({ target: { value: 20, type: "number" } } as any, ["b"]);
        
        expect((form as any).formData.total).toBe(30);
    });

    test("Formula Evaluation - SUM() in Array (via Static Table)", () => {
        const schema = {
            meta: { title: "Sum", version: "1.0" },
            fields: [
                { 
                    type: "array", key: "items", 
                    itemSchema: { 
                        type: "group", key: "item", 
                        fields: [
                            { type: "integer", key: "price" }
                        ] 
                    } 
                },
                {
                    type: "static_table",
                    key: "tbl_summary",
                    headers: ["Total"],
                    rows: [
                        [
                            { type: "integer", key: "grand_total", formula: "SUM(price)" }
                        ]
                    ]
                }
            ]
        };
        form.setSchema(schema);
        
        // Add items
        const arrayField = schema.fields[0];
        (form as any).handleAddItem(["items"], arrayField.itemSchema); // Item 1
        (form as any).handleAddItem(["items"], arrayField.itemSchema); // Item 2
        
        // Set values
        (form as any).handleInput({ target: { value: 100, type: "number" } } as any, ["items", "0", "price"]);
        (form as any).handleInput({ target: { value: 200, type: "number" } } as any, ["items", "1", "price"]);
        
        // grand_total is inside tbl_summary
        expect((form as any).formData.tbl_summary.grand_total).toBe(300);
    });

    test("Formula Evaluation - Invalid Formula", () => {
        const schema = {
            meta: { title: "Bad Calc", version: "1.0" },
            fields: [
                { type: "integer", key: "a" },
                { type: "integer", key: "total", formula: "a + * b" } // Syntax error
            ]
        };
        form.setSchema(schema);
        (form as any).handleInput({ target: { value: 10, type: "number" } } as any, ["a"]);
        
        // Should handle error gracefully (returns 'Error' string or logs error)
        // Implementation returns 'Error: Invalid formula' string in catch/validation check
        expect((form as any).formData.total).toContain("Error");
    });

    test("LocalStorage Persistence", () => {
        const schema = {
            meta: { title: "Persist", version: "1.0" },
            fields: [{ type: "text", key: "name" }]
        };
        form.setSchema(schema);
        
        // 1. Input data
        (form as any).handleInput({ target: { value: "Alice", type: "text" } } as any, ["name"]);
        
        // 2. Check mock storage
        const key = (form as any).getStorageKey();
        const stored = localStorage.getItem(key);
        expect(stored).not.toBeNull();
        expect(JSON.parse(stored!).formData.name).toBe("Alice");
        
        // 3. Reload form (simulate page refresh)
        const newForm = new TobariForm();
        newForm.setSchema(schema); // Should auto-load
        expect((newForm as any).formData.name).toBe("Alice");
    });
    
    test("Action History - Withdraw/Reject", () => {
        const schema = { meta: { title: "Action", version: "1.0" }, fields: [] };
        form.setSchema(schema);
        
        // Submit
        // Mock prompt
        const promptSpy = mock(() => "User1");
        global.prompt = promptSpy as any;
        global.confirm = (() => true) as any;
        
        (form as any).confirmSubmit();
        expect((form as any).isSubmitted).toBe(true);
        expect((form as any).actionHistory[0].action).toBe("submitted");
        
        // Withdraw (opens dialog)
        (form as any).withdrawSubmission();
        expect((form as any).showActionDialog).toBe(true);
        expect((form as any).pendingAction).toBe("withdrawn");
        
        // Submit Withdraw Action
        const fakeForm = {
             // Mock FormData behavior via object
        } as any;
        // Easier to mock handleActionSubmit event
        const formDataMock = new Map();
        formDataMock.set("user", "User2");
        formDataMock.set("reason", "Mistake");
        
        // We need to mock FormData global or inject it. 
        // Or we can just call the logic inside if we refactor, but let's try to mock the event target.
        // Since FormData is hard to mock in bun test simple environment if not available,
        // let's cheat and manually push to history to test state transition if we can't fully mock the event handler easily.
        
        // Actually, let's try calling handleActionSubmit with a mock event
        const mockEvent = {
            preventDefault: () => {},
            target: {} 
        };
        
        // Mock global FormData
        class MockFormData {
            constructor(form: any) {}
            get(key: string) { return key === "user" ? "User2" : "Mistake"; }
        }
        (global as any).FormData = MockFormData;
        
        (form as any).handleActionSubmit(mockEvent);
        
        expect((form as any).isSubmitted).toBe(false);
        expect((form as any).actionHistory.length).toBe(2);
        expect((form as any).actionHistory[1].action).toBe("withdrawn");
    });
    
    test("Input Handling - Normalization", () => {
        // Test normalize method
        const normalized = (form as any).normalize("１２３ＡＢＣ");
        expect(normalized).toBe("123abc");
    });
    
    test("Array - Remove Item", () => {
         const schema = {
            meta: { title: "Arr", version: "1.0" },
            fields: [
                { type: "array", key: "list", itemSchema: { type: "text", key: "val" } }
            ]
        };
        form.setSchema(schema);
        (form as any).formData = { list: ["A", "B", "C"] };
        
        (form as any).handleRemoveItem(["list"], 1); // Remove "B"
        expect((form as any).formData.list).toEqual(["A", "C"]);
    });

    test("Submission - Sign and Download", async () => {
        const schema = {
            meta: { title: "Submit", version: "1.0" },
            fields: [{ type: "text", key: "name", required: true }]
        };
        form.setSchema(schema);
        (form as any).handleInput({ target: { value: "Alice" } } as any, ["name"]);

        // Mock DOM elements for download
        const clickSpy = mock(() => {});
        const mockAnchor = { href: "", download: "", click: clickSpy } as any;
        
        // Mock window
        (global as any).window = {
            crypto: crypto
        };
        
        // Mock document
        const originalDocument = global.document;
        (global as any).document = {
            createElement: (tag: string) => {
                if (tag === 'a') return mockAnchor;
                return {};
            }
        };

        // Mock URL.createObjectURL/revokeObjectURL
        const originalCreateObjURL = URL.createObjectURL;
        const originalRevokeObjURL = URL.revokeObjectURL;
        URL.createObjectURL = mock(() => "blob:url");
        URL.revokeObjectURL = mock(() => {});
        
        // Mock alert
        global.alert = mock(() => {});

        await (form as any).performSignAndDownload();
        
        expect(clickSpy).toHaveBeenCalled();
        expect(mockAnchor.download).toContain("submission.json");
        
        // Restore mocks
        delete (global as any).window;
        (global as any).document = originalDocument;
        URL.createObjectURL = originalCreateObjURL;
        URL.revokeObjectURL = originalRevokeObjURL;
    });
});
