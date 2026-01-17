import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test";
import { TobariForm } from "../src/tobari-form";

// Mock implementation
const createLocalStorageMock = () => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value.toString(); },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; }
    };
};

describe("TobariForm Logic Tests", () => {
    let form: TobariForm;
    let originalLocalStorage: any;
    let originalWindow: any;
    let originalDocument: any;
    let originalAlert: any;

    beforeEach(() => {
        // Mock localStorage
        originalLocalStorage = global.localStorage;
        // Use defineProperty to ensure it's writable/configurable if possible, or just assign if supported
        // But Bun's global.localStorage might be read-only.
        // Let's try defineProperty with configurable: true
        Object.defineProperty(global, 'localStorage', { 
            value: createLocalStorageMock(),
            writable: true,
            configurable: true 
        });

        // Mock window.crypto
        originalWindow = (global as any).window;
        if (!originalWindow) {
             (global as any).window = {
                crypto: {
                    subtle: crypto.subtle,
                    getRandomValues: crypto.getRandomValues.bind(crypto)
                }
            };
        } else {
            // If window exists (e.g. from another test using happy-dom), verify crypto
            // Happy-DOM crypto implementation might lack subtle
            if (!originalWindow.crypto || !originalWindow.crypto.subtle) {
                // Happy-DOM might block direct assignment if non-configurable
                const newCrypto = {
                    subtle: crypto.subtle,
                    getRandomValues: crypto.getRandomValues.bind(crypto)
                };

                try {
                    originalWindow.crypto = newCrypto;
                } catch (e) {
                    // Try defineProperty if assignment fails
                    Object.defineProperty(originalWindow, 'crypto', {
                        value: newCrypto,
                        writable: true,
                        configurable: true
                    });
                }
            }
        }

        // Mock document
        originalDocument = (global as any).document;
        // logic.test.ts mostly doesn't need document except for the download test.
        // We will mock it specifically in that test or strictly here if needed.
        // For now, leave document as is unless needed.

        // Mock alert
        originalAlert = global.alert;
        global.alert = mock(() => {});

        form = new TobariForm();
    });

    afterEach(() => {
        // Restore localStorage
        if (originalLocalStorage) {
            Object.defineProperty(global, 'localStorage', { 
                value: originalLocalStorage,
                writable: true,
                configurable: true 
            });
        } else {
            // If it didn't exist, delete it? Or leave it undefined?
            // Deleting global properties can be tricky.
            // Better to set it to undefined if it wasn't there.
             Object.defineProperty(global, 'localStorage', { 
                value: undefined,
                writable: true,
                configurable: true 
            });
            // Or try delete
            try { delete (global as any).localStorage; } catch {}
        }

        // Restore window
        if (originalWindow) {
            (global as any).window = originalWindow;
        } else {
            delete (global as any).window;
        }

        // Restore alert
        global.alert = originalAlert;
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
        
        const arrayField = schema.fields[0];
        (form as any).handleAddItem(["items"], arrayField.itemSchema);
        (form as any).handleAddItem(["items"], arrayField.itemSchema);
        
        (form as any).handleInput({ target: { value: 100, type: "number" } } as any, ["items", "0", "price"]);
        (form as any).handleInput({ target: { value: 200, type: "number" } } as any, ["items", "1", "price"]);
        
        expect((form as any).formData.tbl_summary.grand_total).toBe(300);
    });

    test("Formula Evaluation - Invalid Formula", () => {
        const schema = {
            meta: { title: "Bad Calc", version: "1.0" },
            fields: [
                { type: "integer", key: "a" },
                { type: "integer", key: "total", formula: "a + * b" }
            ]
        };
        form.setSchema(schema);
        (form as any).handleInput({ target: { value: 10, type: "number" } } as any, ["a"]);
        
        expect((form as any).formData.total).toContain("Error");
    });

    test("LocalStorage Persistence", () => {
        const schema = {
            meta: { title: "Persist", version: "1.0" },
            fields: [{ type: "text", key: "name" }]
        };
        form.setSchema(schema);
        
        (form as any).handleInput({ target: { value: "Alice", type: "text" } } as any, ["name"]);
        
        const key = (form as any).getStorageKey();
        const stored = localStorage.getItem(key);
        expect(stored).not.toBeNull();
        expect(JSON.parse(stored!).formData.name).toBe("Alice");
        
        const newForm = new TobariForm();
        newForm.setSchema(schema);
        expect((newForm as any).formData.name).toBe("Alice");
    });
    
    test("Action History - Withdraw/Reject", () => {
        const schema = { meta: { title: "Action", version: "1.0" }, fields: [] };
        form.setSchema(schema);
        
        const promptSpy = mock(() => "User1");
        global.prompt = promptSpy as any;
        global.confirm = (() => true) as any;
        
        (form as any).confirmSubmit();
        expect((form as any).isSubmitted).toBe(true);
        expect((form as any).actionHistory[0].action).toBe("submitted");
        
        (form as any).withdrawSubmission();
        expect((form as any).showActionDialog).toBe(true);
        expect((form as any).pendingAction).toBe("withdrawn");
        
        const mockEvent = {
            preventDefault: () => {},
            target: {} 
        };
        
        class MockFormData {
            constructor(form: any) {}
            get(key: string) { return key === "user" ? "User2" : "Mistake"; }
        }
        (global as any).FormData = MockFormData;
        
        (form as any).handleActionSubmit(mockEvent);
        
        expect((form as any).isSubmitted).toBe(false);
        expect((form as any).actionHistory.length).toBe(2);
        expect((form as any).actionHistory[1].action).toBe("withdrawn");
        
        // Cleanup FormData
        delete (global as any).FormData;
    });
    
    test("Input Handling - Normalization", () => {
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
        
        (form as any).handleRemoveItem(["list"], 1);
        expect((form as any).formData.list).toEqual(["A", "C"]);
    });

    test("Submission - Sign and Download", async () => {
        const schema = {
            meta: { title: "Submit", version: "1.0" },
            fields: [{ type: "text", key: "name", required: true }]
        };
        form.setSchema(schema);
        (form as any).handleInput({ target: { value: "Alice" } } as any, ["name"]);

        const clickSpy = mock(() => {});
        const mockAnchor = { href: "", download: "", click: clickSpy } as any;
        
        // Mock document temporarily
        const tempOriginalDocument = (global as any).document;
        (global as any).document = {
            createElement: (tag: string) => {
                if (tag === 'a') return mockAnchor;
                return {};
            }
        };

        const originalCreateObjURL = URL.createObjectURL;
        const originalRevokeObjURL = URL.revokeObjectURL;
        URL.createObjectURL = mock(() => "blob:url");
        URL.revokeObjectURL = mock(() => {});
        
        await (form as any).performSignAndDownload();
        
        expect(clickSpy).toHaveBeenCalled();
        expect(mockAnchor.download).toContain("submission.json");
        
        // Restore document
        (global as any).document = tempOriginalDocument;
        URL.createObjectURL = originalCreateObjURL;
        URL.revokeObjectURL = originalRevokeObjURL;
    });
});