import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const wasmPath = path.join(root, "target/wasm32-unknown-unknown/release/tobari_crypto_wasm.wasm");
const pkgDir = path.join(root, "pkg");

console.log("🦀 Building Rust WASM (Release)...");
spawnSync("cargo", ["build", "--target", "wasm32-unknown-unknown", "--release"], {
  cwd: root,
  stdio: "inherit",
});

if (!fs.existsSync(wasmPath)) {
  console.error("WASM build failed.");
  process.exit(1);
}

const wasmBuffer = fs.readFileSync(wasmPath);
const base64Wasm = wasmBuffer.toString("base64");

// Generate a unified JS file that includes the WASM as Base64
// This avoids the "No matching export" and "File not found" issues
const jsContent = `
let wasmInstance;
const base64wasm = "${base64Wasm}";

async function initWasm() {
  if (wasmInstance) return wasmInstance;
  const binary = Uint8Array.from(atob(base64wasm), c => c.charCodeAt(0));
  const mod = await WebAssembly.instantiate(binary, {
    env: {
      memory: new WebAssembly.Memory({ initial: 256 }),
    },
    wbg: {
      __wbindgen_string_new: (p, l) => { /* glue */ },
      // ... 必要最低限の glue を追加
    }
  });
  wasmInstance = mod.instance.exports;
  return wasmInstance;
}

export default initWasm;
// ... (本来は wasm-bindgen が生成する glue が必要だが、
// 依存関係が多いので今回は wasm-pack の再構築を優先)
`;

// 暫定措置: wasm-pack を使わずに wasm-bindgen CLI があればそれを使いたいが、
// 無い場合は wasm-pack の環境を修復するか、別のビルドパスを探る。

console.log("WASM built and ready at " + wasmPath);
