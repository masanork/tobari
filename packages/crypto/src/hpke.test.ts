import { test, expect } from "bun:test";
import {
  HPKE_ALG_CLASSIC,
  HPKE_ALG_HYBRID,
  deriveHPKEKeyPair,
  encryptHpkeWithAlg,
  decryptHpkeWithAlg
} from "./hpke";
import { generateMlKem768KeyPair } from "./pqc";

test("hpke classic roundtrip", async () => {
  const info = new TextEncoder().encode("tobari-storage-v1");
  const demoSecret = new TextEncoder().encode("tobari-demo-secret-key-32-bytes-long!!");
  const hpkeKeys = await deriveHPKEKeyPair(demoSecret);
  const payload = new TextEncoder().encode("classic-roundtrip");

  const ciphertext = await encryptHpkeWithAlg({
    alg: HPKE_ALG_CLASSIC,
    publicKey: hpkeKeys.publicKey,
    plaintext: payload,
    info
  });

  const plaintext = await decryptHpkeWithAlg({
    alg: HPKE_ALG_CLASSIC,
    privateKey: hpkeKeys.privateKey,
    data: ciphertext,
    info
  });

  expect(new TextDecoder().decode(plaintext)).toBe("classic-roundtrip");
});

test("hpke hybrid roundtrip", async () => {
  const info = new TextEncoder().encode("tobari-storage-v1");
  const demoSecret = new TextEncoder().encode("tobari-demo-secret-key-32-bytes-long!!");
  const hpkeKeys = await deriveHPKEKeyPair(demoSecret);
  const kemKeys = await generateMlKem768KeyPair();
  const payload = new TextEncoder().encode("hybrid-roundtrip");

  const ciphertext = await encryptHpkeWithAlg({
    alg: HPKE_ALG_HYBRID,
    publicKey: hpkeKeys.publicKey,
    pqcPublicKey: kemKeys.publicKey,
    plaintext: payload,
    info
  });

  const plaintext = await decryptHpkeWithAlg({
    alg: HPKE_ALG_HYBRID,
    privateKey: hpkeKeys.privateKey,
    pqcPrivateKey: kemKeys.privateKey,
    data: ciphertext,
    info
  });

  expect(new TextDecoder().decode(plaintext)).toBe("hybrid-roundtrip");
});
