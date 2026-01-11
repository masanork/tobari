// HPKE wrapper using Rust/WASM for hardware compatibility
import initCore, {
  hpke_p256_encrypt,
  hpke_p256_decrypt,
  derive_p256_keypair
} from "../../crypto-wasm/pkg/core/tobari_crypto_wasm_core.js";
import initFull, {
  hpke_p256_mlkem768_encrypt,
  hpke_p256_mlkem768_decrypt
} from "../../crypto-wasm/pkg/full/tobari_crypto_wasm_full.js";

export const HPKE_ALG_CLASSIC = "HPKE-P256-SHA256-AES128GCM";
export const HPKE_ALG_HYBRID = "HPKE-P256-MLKEM768-SHA256-AES128GCM";
export type HpkeAlg = typeof HPKE_ALG_CLASSIC | typeof HPKE_ALG_HYBRID;

let coreInitialized: Promise<any> | null = null;
let fullInitialized: Promise<any> | null = null;

async function ensureCoreWasm() {
  if (!coreInitialized) {
    const inlinedWasm = (globalThis as any).__TOBARI_WASM__;
    if (inlinedWasm) {
      const binary = Uint8Array.from(atob(inlinedWasm), c => c.charCodeAt(0));
      coreInitialized = initCore({ module_or_path: binary });
    } else {
      coreInitialized = initCore();
    }
  }
  await coreInitialized;
}

async function ensureFullWasm() {
  if (!fullInitialized) {
    const inlinedWasm = (globalThis as any).__TOBARI_WASM__;
    if (inlinedWasm) {
      const binary = Uint8Array.from(atob(inlinedWasm), c => c.charCodeAt(0));
      fullInitialized = initFull({ module_or_path: binary });
    } else {
      fullInitialized = initFull();
    }
  }
  await fullInitialized;
}

export async function encryptHPKE(publicKey: Uint8Array, plaintext: Uint8Array, info: Uint8Array): Promise<Uint8Array> {
  await ensureCoreWasm();
  return hpke_p256_encrypt(publicKey, plaintext, info);
}

export async function decryptHPKE(privateKey: Uint8Array, data: Uint8Array, info: Uint8Array): Promise<Uint8Array> {
  await ensureCoreWasm();
  // privateKey is 32-byte seed from HMAC-Secret
  return hpke_p256_decrypt(privateKey, data, info);
}

export async function deriveHPKEKeyPair(seed: Uint8Array) {
  await ensureCoreWasm();
  const binary = derive_p256_keypair(seed);
  // [publicKey (65)] + [privateKey (32)]
  return {
    publicKey: binary.slice(0, 65),
    privateKey: binary.slice(65, 97)
  };
}

export async function encryptHpkeWithAlg(params: {
  alg: HpkeAlg;
  publicKey: Uint8Array;
  pqcPublicKey?: Uint8Array;
  plaintext: Uint8Array;
  info: Uint8Array;
}): Promise<Uint8Array> {
  if (params.alg === HPKE_ALG_HYBRID) {
    if (!params.pqcPublicKey) {
      throw new Error("HPKE hybrid encrypt requires pqcPublicKey");
    }
    return encryptHPKEHybrid(params.publicKey, params.pqcPublicKey, params.plaintext, params.info);
  }
  return encryptHPKE(params.publicKey, params.plaintext, params.info);
}

export async function decryptHpkeWithAlg(params: {
  alg: HpkeAlg;
  privateKey: Uint8Array;
  pqcPrivateKey?: Uint8Array;
  data: Uint8Array;
  info: Uint8Array;
}): Promise<Uint8Array> {
  if (params.alg === HPKE_ALG_HYBRID) {
    if (!params.pqcPrivateKey) {
      throw new Error("HPKE hybrid decrypt requires pqcPrivateKey");
    }
    return decryptHPKEHybrid(params.privateKey, params.pqcPrivateKey, params.data, params.info);
  }
  return decryptHPKE(params.privateKey, params.data, params.info);
}

export async function encryptHPKEHybrid(
  publicKey: Uint8Array,
  pqcPublicKey: Uint8Array,
  plaintext: Uint8Array,
  info: Uint8Array
): Promise<Uint8Array> {
  await ensureFullWasm();
  return hpke_p256_mlkem768_encrypt(publicKey, pqcPublicKey, plaintext, info);
}

export async function decryptHPKEHybrid(
  privateKey: Uint8Array,
  pqcPrivateKey: Uint8Array,
  data: Uint8Array,
  info: Uint8Array
): Promise<Uint8Array> {
  await ensureFullWasm();
  return hpke_p256_mlkem768_decrypt(privateKey, pqcPrivateKey, data, info);
}
