import { serve } from "bun";
import path from "path";
import fs from "fs";

const PORT = 3000;

console.log(`\n🚀 Agentic Wallet Demo Server starting...`);
console.log(`🌍 URL: http://localhost:${PORT}/juminhyo/juminhyo.html`);
console.log(`--------------------------------------------------`);

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let filePath = path.join(process.cwd(), "examples", url.pathname);

    // If directory, look for index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const contentType = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".cose": "application/cbor",
        ".json": "application/json",
        ".css": "text/css"
      }[ext] || "text/plain";

      return new Response(content, {
        headers: { "Content-Type": contentType }
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});
