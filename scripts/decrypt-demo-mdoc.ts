#!/usr/bin/env bun
/**
 * Decrypt demo mdoc files to create plain versions for testing
 */

import { readFileSync, writeFileSync } from 'fs';
import { decryptHpkeWithAlg, deriveHPKEKeyPair } from '@tobari/crypto/hpke';

const DEMO_HPKE_SECRET = 'tobari-demo-secret-do-not-use-in-production';
const DEMO_HPKE_INFO = 'tobari-hpke-demo-context-v1';

async function main() {
  const inputPath = process.argv[2] || 'examples/juminhyo/juminhyo.cose';
  const outputPath = process.argv[3] || inputPath.replace('.cose', '-plain.cose');

  console.log(`Decrypting ${inputPath}...`);

  const encrypted = readFileSync(inputPath, 'utf8');
  const wrapper = JSON.parse(encrypted);

  if (!wrapper.tobari_enc) {
    console.log('File is not encrypted, copying as-is');
    writeFileSync(outputPath, encrypted);
    process.exit(0);
  }

  const ciphertext = new Uint8Array(Buffer.from(wrapper.data, 'base64'));
  const info = new TextEncoder().encode(DEMO_HPKE_INFO);
  const secret = new TextEncoder().encode(DEMO_HPKE_SECRET);
  const keyPair = await deriveHPKEKeyPair(secret);

  const alg = wrapper.alg || 'HPKE-P256-SHA256-AES128GCM';

  try {
    const plaintext = await decryptHpkeWithAlg({
      alg: alg as any,
      privateKey: keyPair.privateKey,
      data: ciphertext,
      info
    });

    writeFileSync(outputPath, Buffer.from(plaintext));
    console.log(`✓ Decrypted to ${outputPath}`);
  } catch (error) {
    console.error('Decryption failed:', error);
    throw error;
  }
}

main().catch(console.error);
