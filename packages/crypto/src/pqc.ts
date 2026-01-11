import init, {
  ml_dsa_65_generate_keypair,
  ml_dsa_65_sign,
  ml_dsa_65_verify,
  ml_kem_768_generate_keypair,
  ml_kem_768_encap,
  ml_kem_768_decap
} from "../../crypto-wasm/pkg/full/tobari_crypto_wasm_full.js";

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

const ML_DSA_65_PRIVATE_KEY_BYTES = 4032;
const ML_DSA_65_PUBLIC_KEY_BYTES = 1952;

export async function generateMlDsa65KeyPair() {
  await ensureWasm();
  const bytes = ml_dsa_65_generate_keypair();
  return {
    privateKey: bytes.slice(0, ML_DSA_65_PRIVATE_KEY_BYTES),
    publicKey: bytes.slice(ML_DSA_65_PRIVATE_KEY_BYTES, ML_DSA_65_PRIVATE_KEY_BYTES + ML_DSA_65_PUBLIC_KEY_BYTES)
  };
}

export async function mlDsa65Sign(privateKey: Uint8Array, message: Uint8Array) {
  await ensureWasm();
  return ml_dsa_65_sign(privateKey, message);
}

export async function mlDsa65Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array) {
  await ensureWasm();
  return ml_dsa_65_verify(publicKey, message, signature);
}

export async function generateMlKem768KeyPair() {
  await ensureWasm();
  const bytes = ml_kem_768_generate_keypair();
  const privateKey = bytes.slice(0, 2400);
  const publicKey = bytes.slice(2400);
  return { privateKey, publicKey };
}

export async function mlKem768Encapsulate(publicKey: Uint8Array) {
  await ensureWasm();
  const bytes = ml_kem_768_encap(publicKey);
  const sharedSecret = bytes.slice(0, 32);
  const ciphertext = bytes.slice(32);
  return { sharedSecret, ciphertext };
}

export async function mlKem768Decapsulate(privateKey: Uint8Array, ciphertext: Uint8Array) {
  await ensureWasm();
  return ml_kem_768_decap(privateKey, ciphertext);
}
