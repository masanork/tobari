import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolRegistry } from "./mcp-tool.js";
import { tobariTools } from "./tools/tobari.js";
import { jpkiTools } from "./tools/jpki.js";
import { webauthnTools } from "./tools/webauthn.js";
import { holderBindingTools } from "./tools/holder-binding.js";
import { demoTools } from "./tools/demo.js";

// Initialize Registry
const registry = new ToolRegistry();
registry.registerAll(tobariTools);
registry.registerAll(jpkiTools);
registry.registerAll(webauthnTools);
registry.registerAll(holderBindingTools);
registry.registerAll(demoTools);

const server = new Server(
    {
        name: "tobari-mcp-server",
        version: "0.1.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: registry.getToolDefinitions(),
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    try {
        return await registry.handleCall(request.params.name, request.params.arguments);
    } catch (error: any) {
        console.error(`Tool execution error [${request.params.name}]:`, error);
        return {
            content: [{ type: "text", text: error.message }],
            isError: true
        };
    }
});

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});