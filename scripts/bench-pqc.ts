import { performance } from "node:perf_hooks";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { deriveHPKEKeyPair, encryptHpkeWithAlg, decryptHpkeWithAlg, HPKE_ALG_CLASSIC, HPKE_ALG_HYBRID } from "../packages/crypto/src/hpke";
import { generateMlDsa65KeyPair, generateMlKem768KeyPair, mlDsa65Sign, mlDsa65Verify } from "../packages/crypto/src/pqc";
import { generateSignedTobari } from "../packages/codec/src/tobari-gen";
import { createPresentation, signDeviceAuth } from "../packages/codec/src/sd";
import { decode, encode } from "cbor-x";
import { verifyPresentation } from "../packages/codec/src/validator";

type BenchResult = { label: string; runs: number; avgMs: number };

async function bench(label: string, runs: number, fn: () => Promise<void>): Promise<BenchResult> {
  const start = performance.now();
  for (let i = 0; i < runs; i++) {
    await fn();
  }
  const total = performance.now() - start;
  return { label, runs, avgMs: total / runs };
}

async function main() {
  const info = new TextEncoder().encode("tobari-storage-v1");
  const payload = new TextEncoder().encode("bench-pqc");
  const demoSecret = new TextEncoder().encode("tobari-demo-secret-key-32-bytes-long!!");

  const hpkeKeys = await deriveHPKEKeyPair(demoSecret);
  const kemKeys = await generateMlKem768KeyPair();
  const dsaKeys = await generateMlDsa65KeyPair();

  const schemaPath = path.resolve("examples/juminhyo/juminhyo.yaml");
  const dataPath = path.resolve("examples/juminhyo/juminhyo-data.yaml");
  const schemaYaml = fs.readFileSync(schemaPath, "utf-8");
  const sampleData = yaml.load(fs.readFileSync(dataPath, "utf-8"));

  const issuerKeyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-384" },
    true,
    ["sign", "verify"]
  );
  const deviceKeyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const coreRuns = 5;
  const cryptoRuns = 20;

  const results: BenchResult[] = [];

  results.push(await bench("HPKE classic encrypt", cryptoRuns, async () => {
    await encryptHpkeWithAlg({
      alg: HPKE_ALG_CLASSIC,
      publicKey: hpkeKeys.publicKey,
      plaintext: payload,
      info
    });
  }));

  const classicCt = await encryptHpkeWithAlg({
    alg: HPKE_ALG_CLASSIC,
    publicKey: hpkeKeys.publicKey,
    plaintext: payload,
    info
  });

  results.push(await bench("HPKE classic decrypt", cryptoRuns, async () => {
    await decryptHpkeWithAlg({
      alg: HPKE_ALG_CLASSIC,
      privateKey: hpkeKeys.privateKey,
      data: classicCt,
      info
    });
  }));

  results.push(await bench("HPKE hybrid encrypt", cryptoRuns, async () => {
    await encryptHpkeWithAlg({
      alg: HPKE_ALG_HYBRID,
      publicKey: hpkeKeys.publicKey,
      pqcPublicKey: kemKeys.publicKey,
      plaintext: payload,
      info
    });
  }));

  const hybridCt = await encryptHpkeWithAlg({
    alg: HPKE_ALG_HYBRID,
    publicKey: hpkeKeys.publicKey,
    pqcPublicKey: kemKeys.publicKey,
    plaintext: payload,
    info
  });

  results.push(await bench("HPKE hybrid decrypt", cryptoRuns, async () => {
    await decryptHpkeWithAlg({
      alg: HPKE_ALG_HYBRID,
      privateKey: hpkeKeys.privateKey,
      pqcPrivateKey: kemKeys.privateKey,
      data: hybridCt,
      info
    });
  }));

  results.push(await bench("ML-DSA sign", cryptoRuns, async () => {
    await mlDsa65Sign(dsaKeys.privateKey, payload);
  }));

  const dsaSig = await mlDsa65Sign(dsaKeys.privateKey, payload);
  results.push(await bench("ML-DSA verify", cryptoRuns, async () => {
    await mlDsa65Verify(dsaKeys.publicKey, payload, dsaSig);
  }));

  results.push(await bench("gen-tobari core", coreRuns, async () => {
    await generateSignedTobari(schemaYaml, sampleData, issuerKeyPair.privateKey, {
      kid: "bench-p384",
      devicePublicKey: deviceKeyPair.publicKey,
      encryptionPublicKey: hpkeKeys.publicKey
    });
  }));

  results.push(await bench("gen-tobari pqc+encrypt", coreRuns, async () => {
    await generateSignedTobari(schemaYaml, sampleData, issuerKeyPair.privateKey, {
      kid: "bench-p384",
      devicePublicKey: deviceKeyPair.publicKey,
      pqcCountersign: {
        privateKey: dsaKeys.privateKey,
        kid: "bench-mldsa65"
      },
      encryptionPublicKey: hpkeKeys.publicKey,
      encryptionPqcPublicKey: kemKeys.publicKey,
      pqcEncrypt: true
    });
  }));

  const coreDoc = await generateSignedTobari(schemaYaml, sampleData, issuerKeyPair.privateKey, {
    kid: "bench-p384",
    devicePublicKey: deviceKeyPair.publicKey
  });
  const coreDecoded = decode(coreDoc);
  const coreVp = await createPresentation(coreDecoded, ["世帯主氏名"]);
  const coreDeviceAuth = await signDeviceAuth(
    coreVp.docType,
    encode(new Map()),
    [null, null, "bench-nonce"],
    deviceKeyPair.privateKey,
    -7
  );
  coreVp.deviceSigned = { nameSpaces: encode(new Map()), deviceAuth: coreDeviceAuth };

  results.push(await bench("verify_presentation core", coreRuns, async () => {
    await verifyPresentation({ documents: [coreVp] }, {
      [coreVp.docType]: issuerKeyPair.publicKey
    });
  }));

  const pqcDoc = await generateSignedTobari(schemaYaml, sampleData, issuerKeyPair.privateKey, {
    kid: "bench-p384",
    devicePublicKey: deviceKeyPair.publicKey,
    pqcCountersign: {
      privateKey: dsaKeys.privateKey,
      kid: "bench-mldsa65"
    }
  });
  const pqcDecoded = decode(pqcDoc);
  const pqcVp = await createPresentation(pqcDecoded, ["世帯主氏名"]);
  const pqcDeviceAuth = await signDeviceAuth(
    pqcVp.docType,
    encode(new Map()),
    [null, null, "bench-nonce"],
    deviceKeyPair.privateKey,
    -7
  );
  pqcVp.deviceSigned = { nameSpaces: encode(new Map()), deviceAuth: pqcDeviceAuth };

  results.push(await bench("verify_presentation pqc", coreRuns, async () => {
    await verifyPresentation({ documents: [pqcVp] }, {
      [pqcVp.docType]: { classic: issuerKeyPair.publicKey, pqcPublicKey: dsaKeys.publicKey }
    });
  }));

  console.log("\nPQC Bench (avg ms)");
  for (const row of results) {
    console.log(`- ${row.label}: ${row.avgMs.toFixed(2)} ms (n=${row.runs})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
