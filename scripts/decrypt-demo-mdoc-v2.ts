#!/usr/bin/env bun
/**
 * Decrypt demo mdoc files using parseTobari
 */

import { readFileSync, writeFileSync } from 'fs';
import { parseTobari } from '../packages/codec/src/parse.js';

async function main() {
  const inputPath = process.argv[2] || 'examples/juminhyo/juminhyo.cose';
  const outputPath = process.argv[3] || inputPath.replace('.cose', '-plain.cose');

  console.log(`Decrypting ${inputPath}...`);

  const data = readFileSync(inputPath);
  const result = await parseTobari(new Uint8Array(data), {});

  writeFileSync(outputPath, Buffer.from(result.rawMdoc));
  console.log(`✓ Decrypted to ${outputPath}`);
  console.log(`  DocType: ${result.docType}`);
  console.log(`  Size: ${result.rawMdoc.byteLength} bytes`);
}

main().catch(console.error);
