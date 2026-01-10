// HPKE wrapper using Rust/WASM for hardware compatibility
import init, { hpke_p256_encrypt, hpke_p256_decrypt, derive_p256_keypair } from "../../crypto-wasm/pkg/tobari_crypto_wasm.js";

let wasmInitialized: Promise<any> | null = null;

async function ensureWasm() {
  if (!wasmInitialized) {
    const inlinedWasm = (globalThis as any).__TOBARI_WASM__;
    if (inlinedWasm) {
      const binary = Uint8Array.from(atob(inlinedWasm), c => c.charCodeAt(0));
      wasmInitialized = init({ module_or_path: binary });
    } else {
      wasmInitialized = init();
    }
  }
  await wasmInitialized;
}

export async function encryptHPKE(publicKey: Uint8Array, plaintext: Uint8Array, info: Uint8Array): Promise<Uint8Array> {
  await ensureWasm();
  return hpke_p256_encrypt(publicKey, plaintext, info);
}

export async function decryptHPKE(privateKey: Uint8Array, data: Uint8Array, info: Uint8Array): Promise<Uint8Array> {
  await ensureWasm();
  // privateKey is 32-byte seed from HMAC-Secret
  return hpke_p256_decrypt(privateKey, data, info);
}

export async function deriveHPKEKeyPair(seed: Uint8Array) {
  await ensureWasm();
  const binary = derive_p256_keypair(seed);
  // [publicKey (65)] + [privateKey (32)]
  return {
    publicKey: binary.slice(0, 65),
    privateKey: binary.slice(65, 97)
  };
}
