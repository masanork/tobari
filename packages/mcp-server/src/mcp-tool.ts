import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * MCPツールの定義インターフェース
 */
export interface McpTool<T extends z.ZodType<any, any>> {
    name: string;
    description: string;
    schema: T;
    handler: (args: z.infer<T>) => Promise<any>;
}

/**
 * ツールを一括登録するためのユーティリティ
 */
export class ToolRegistry {
    private tools: Map<string, McpTool<any>> = new Map();

    register(tool: McpTool<any>) {
        this.tools.set(tool.name, tool);
    }

    registerAll(tools: McpTool<any>[]) {
        for (const tool of tools) {
            this.register(tool);
        }
    }

    getToolDefinitions() {
        return Array.from(this.tools.values()).map(tool => {
            const jsonSchema = zodToJsonSchema(tool.schema, { target: "openApi3" });
            // remove $schema, additionalProperties etc. if not wanted by MCP
            const { $schema, ...inputSchema } = jsonSchema as any;
            
            return {
                name: tool.name,
                description: tool.description,
                inputSchema: inputSchema
            };
        });
    }

    async handleCall(name: string, args: any) {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Tool not found: ${name}`);
        }
        
        // Zodによるバリデーション
        const parsedArgs = tool.schema.parse(args);
        return await tool.handler(parsedArgs);
    }
}
