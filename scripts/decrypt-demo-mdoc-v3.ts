#!/usr/bin/env bun
/**
 * Decrypt demo mdoc files using existing readTobariFileAsBuffer
 */

import { writeFileSync } from 'fs';
import { readTobariFileAsBuffer } from '../packages/mcp-server/src/utils.js';

async function main() {
  const inputPath = process.argv[2] || 'examples/juminhyo/juminhyo.cose';
  const outputPath = process.argv[3] || inputPath.replace('.cose', '-plain.cose');

  console.log(`Decrypting ${inputPath}...`);

  // readTobariFileAsBuffer will automatically decrypt if needed
  const decrypted = await readTobariFileAsBuffer(inputPath, {});

  writeFileSync(outputPath, Buffer.from(decrypted));
  console.log(`✓ Decrypted to ${outputPath}`);
  console.log(`  Size: ${decrypted.byteLength} bytes`);
}

main().catch(console.error);
