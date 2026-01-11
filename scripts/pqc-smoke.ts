import { deriveHPKEKeyPair, encryptHpkeWithAlg, decryptHpkeWithAlg, HPKE_ALG_HYBRID } from "../packages/crypto/src/hpke";
import { generateMlKem768KeyPair } from "../packages/crypto/src/pqc";
import { handleCreatePresentation, handleVerifyPresentation } from "../packages/mcp-server/src/tools/tobari";
import { spawn } from "child_process";

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

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("bun", ["examples/juminhyo/gen-tobari.ts", "--pqc", "--pqc-encrypt"], {
      stdio: "inherit",
      shell: false
    });
    proc.on("exit", (code: number) => {
      if (code !== 0) {
        reject(new Error(`gen-tobari failed with exit code ${code}`));
        return;
      }
      resolve();
    });
    proc.on("error", reject);
  });

  const createRes = await handleCreatePresentation({
    requests: [{ path: "examples/juminhyo/juminhyo.cose", fields: ["世帯主氏名"] }],
    devicePrivateKeyPath: "examples/juminhyo/device-key-p256.json",
    deviceAlg: -7
  });
  const createText = createRes.content?.[0]?.text || "{}";
  const { vp_base64 } = JSON.parse(createText);

  const verifyRes = await handleVerifyPresentation({
    vpBase64: vp_base64,
    issuerPublicKeys: { "io.github.masanork.tobari.juminhyo.v1": "examples/juminhyo/issuer-key.json" },
    issuerPqcPublicKeys: { "io.github.masanork.tobari.juminhyo.v1": "examples/juminhyo/issuer-pqc-public-key.json" }
  });
  console.log(verifyRes.content?.[0]?.text || "No output");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
