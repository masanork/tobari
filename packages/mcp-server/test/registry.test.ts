import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { ToolRegistry, McpTool } from "../src/mcp-tool.js";

describe("ToolRegistry", () => {
    it("should register and define tools correctly", () => {
        const registry = new ToolRegistry();
        
        const testTool: McpTool<any> = {
            name: "test_tool",
            description: "A test tool",
            schema: z.object({
                param1: z.string().describe("A string parameter"),
                param2: z.number().optional().describe("An optional number")
            }),
            handler: async (args) => `Hello ${args.param1}`
        };

        registry.register(testTool);
        const definitions = registry.getToolDefinitions();

        expect(definitions).toHaveLength(1);
        expect(definitions[0].name).toBe("test_tool");
        expect(definitions[0].description).toBe("A test tool");
        
        const schema = definitions[0].inputSchema as any;
        expect(schema.type).toBe("object");
        expect(schema.properties.param1.type).toBe("string");
        expect(schema.properties.param2.type).toBe("number");
        expect(schema.required).toContain("param1");
    });

    it("should validate arguments using Zod", async () => {
        const registry = new ToolRegistry();
        const testTool: McpTool<any> = {
            name: "add",
            description: "Add numbers",
            schema: z.object({
                a: z.number(),
                b: z.number()
            }),
            handler: async ({ a, b }) => a + b
        };
        registry.register(testTool);

        // Valid call
        const result = await registry.handleCall("add", { a: 10, b: 20 });
        expect(result).toBe(30);

        // Invalid call (missing param)
        expect(registry.handleCall("add", { a: 10 })).rejects.toThrow();

        // Invalid call (wrong type)
        expect(registry.handleCall("add", { a: 10, b: "20" })).rejects.toThrow();
    });

    it("should throw error for unknown tools", async () => {
        const registry = new ToolRegistry();
        expect(registry.handleCall("unknown", {})).rejects.toThrow("Tool not found");
    });
});
