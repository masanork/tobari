#!/usr/bin/env bun
import { parseArgs } from "util";

// Dummy signer that mimics the behavior of tobari-signer for testing
// It reads --request JSON, parses it, and outputs a dummy signature JSON.

const args = process.argv.slice(2);
let requestJson = "";

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--request") {
        requestJson = args[i + 1];
        break;
    }
}

if (!requestJson) {
    console.error("No request provided");
    process.exit(1);
}

try {
    const req = JSON.parse(requestJson);
    
    // Validate required fields
    if (!req.challenge || !req.rp_id) {
        throw new Error("Missing challenge or rp_id");
    }

    // Generate dummy output
    const output = {
        credential_id: "dummy_cred_id_base64url",
        authenticator_data: "dummy_auth_data_base64url",
        // Valid ECDSA signature format (DER) dummy for P-256 usually starts with 30...
        // But here we just return random bytes encoded as base64url because the test won't crypto-verify it fully unless we mock keys.
        // Let's return a valid-looking base64url string.
        signature: "MEQCIQD1l_hU4q...", 
        user_handle: "dummy_user_handle"
    };

    console.log(JSON.stringify(output));
    process.exit(0);

} catch (e) {
    console.error("Error processing request:", e);
    process.exit(1);
}
