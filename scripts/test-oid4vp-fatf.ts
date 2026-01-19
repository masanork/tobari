import { $ } from "bun";
import { expect } from "bun:test";
import path from "path";
import fs from "fs";

// Colors for output
const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

function log(msg: string, color: string = COLORS.reset) {
  console.log(`${color}${msg}${COLORS.reset}`);
}

function header(msg: string) {
  console.log(`\n${COLORS.blue}➤ ${msg}${COLORS.reset}`);
}

async function runCommand(cmd: string, args: string[]) {
  const commandStr = `${cmd} ${args.join(" ")}`;
  log(`$ ${commandStr}`, COLORS.gray);
  
  // Use Bun.spawn to execute
  const proc = Bun.spawn([cmd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  
  const text = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error(COLORS.red + "Command failed:" + COLORS.reset);
    console.error(err);
    console.error(text);
    throw new Error(`Command failed: ${commandStr}`);
  }
  
  return text;
}

async function main() {
  log("Starting FATF Travel Rule (OID4VP) Flow Test...", COLORS.green);

  const TMP_DIR = "tmp/oid4vp-test";
  const MDOC_PATH = "examples/juminhyo/juminhyo.cose";
  const VP_OUTPUT = path.join(TMP_DIR, "vp-response.cose");
  const REQUEST_FILE = path.join(TMP_DIR, "request.json");

  // Setup
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  // 1. Prepare Credential (Issuer)
  header("Step 1: Preparing User Credential (mDoc)");
  if (!fs.existsSync(MDOC_PATH)) {
    log("Generatng demo credential...", COLORS.yellow);
    await runCommand("bun", ["run", "examples/juminhyo/gen-tobari.ts"]);
  } else {
    log("Using existing credential: " + MDOC_PATH);
  }

  // 2. VASP Generates OID4VP Request
  header("Step 2: VASP Generates OID4VP Authorization Request");
  const request = {
    client_id: "did:web:vasp.example.com",
    response_uri: "https://vasp.example.com/callback/12345",
    nonce: "n-" + Math.random().toString(36).substring(7),
    presentation_definition: {
      id: "fatf-travel-rule-req",
      input_descriptors: [
        {
          id: "identity",
          name: "Legal Identity",
          purpose: "FATF Compliance (Travel Rule)",
          constraints: {
            fields: [
              // Requesting Name and DoB from Juminhyo/mDL
              { path: ["$.mdoc.org.iso.18013.5.1.family_name"] },
              { path: ["$.mdoc.org.iso.18013.5.1.birth_date"] }
            ]
          }
        },
        // In a real scenario, we would also ask for SCAC (org.jaopp.scac)
        // For this test using juminhyo.cose, we'll stick to fields present in it.
        // { path: ["$.mdoc.org.jaopp.scac.wallet_address"] } 
      ]
    }
  };
  
  fs.writeFileSync(REQUEST_FILE, JSON.stringify(request, null, 2));
  log(`Request saved to ${REQUEST_FILE}`, COLORS.cyan);
  log(JSON.stringify(request, null, 2), COLORS.gray);

  // 3. User Wallet Generates VP
  header("Step 3: User Generates VP (Holder Binding)");
  // Note: present-cli now supports --definition
  const output = await runCommand("bun", [
    "run", 
    "packages/codec/src/present-cli.ts",
    MDOC_PATH,
    VP_OUTPUT,
    `--definition=${REQUEST_FILE}`
  ]);
  
  log(output, COLORS.gray);
  if (!output.includes("Holder Binding Added")) {
    throw new Error("VP generation failed to include Holder Binding signature!");
  }
  log("✓ VP Generated successfully", COLORS.green);

  // 4. VASP Verifies VP
  header("Step 4: VASP Verifies Presentation");
  const verifyOutput = await runCommand("bun", [
    "run",
    "packages/codec/src/verify-cli.ts",
    VP_OUTPUT
  ]);

  log(verifyOutput, COLORS.gray);

  // Assertions on verification output
  header("Step 5: Assertions");
  
  const checks = [
    { text: "Holder Binding Verification", msg: "Holder Binding check ran" },
    { text: "Device Signature: VALID", msg: "Device Signature is valid" },
    { text: `Nonce: ${request.nonce}`, msg: "Nonce matches request" },
    // Note: verify-cli might show hashes for ClientID/ResponseURI, so we check logs carefully
    // Usually it displays the input values if we pass them, but verify-cli currently just parses what's in the VP structure (hashes).
    // So we check if the section exists.
    { text: "[OID4VP Session Data]", msg: "OID4VP Session Data present" }
  ];

  for (const check of checks) {
    if (verifyOutput.includes(check.text)) {
      log(`✓ ${check.msg}`, COLORS.green);
    } else {
      log(`✗ ${check.msg}`, COLORS.red);
      throw new Error(`Verification failed: missing '${check.text}'`);
    }
  }

  log("\n🎉 FATF OID4VP Flow Test PASSED!", COLORS.green);
}

main().catch((e) => {
  console.error(COLORS.red + "\nTest Failed:" + COLORS.reset, e);
  process.exit(1);
});
