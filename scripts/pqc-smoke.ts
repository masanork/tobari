import { deriveHPKEKeyPair, encryptHpkeWithAlg, decryptHpkeWithAlg, HPKE_ALG_HYBRID } from "../packages/crypto/src/hpke";
import { generateMlKem768KeyPair } from "../packages/crypto/src/pqc";

async function main() {
  const info = new TextEncoder().encode("tobari-storage-v1");
  const payload = new TextEncoder().encode("pqc-smoke");

  const demoSecret = new TextEncoder().encode("tobari-demo-secret-key-32-bytes-long!!");
  const hpkeKeys = await deriveHPKEKeyPair(demoSecret);
  const kemKeys = await generateMlKem768KeyPair();

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

  const output = new TextDecoder().decode(plaintext);
  console.log(`Hybrid HPKE decrypt: ${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
