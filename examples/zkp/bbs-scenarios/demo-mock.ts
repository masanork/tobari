
/**
 * Mock ZK-Proof generator for Unlinkability demonstration.
 * 
 * In a real implementation, this would use BBS+ Signatures or Camenisch-Lysyanskaya Signatures.
 * Here we simulate the property that:
 * 1. Proofs are randomized (unlinkable).
 * 2. Proofs selectively disclose attributes.
 * 3. Issuer signature is never revealed.
 */

import { randomBytes, createHash } from 'crypto';

// --- Types ---

interface Credential {
    id: string; // Internal ID
    attributes: Record<string, string>;
    issuerSignature: string; // The static signature (kept secret)
}

interface Proof {
    revealedAttributes: Record<string, string>;
    zkProof: string; // The "Zero Knowledge Proof" string (randomized)
    nonce: string;
}

interface IssuerKeyPair {
    publicKey: string;
    privateKey: string;
}

// --- Mock Crypto ---

class MockBBS {
    static generateIssuerKey(): IssuerKeyPair {
        return {
            publicKey: "pub_key_mock_" + randomBytes(4).toString('hex'),
            privateKey: "priv_key_mock_" + randomBytes(4).toString('hex')
        };
    }

    static sign(attributes: Record<string, string>, privateKey: string): string {
        // In reality, this is a signature over the vector of messages (attributes)
        const content = Object.values(attributes).sort().join('|');
        const h = createHash('sha256').update(content + privateKey).digest('hex');
        return `bbs_sig_${h}`;
    }

    static verifyProof(proof: Proof, issuerPublicKey: string): boolean {
        // In a real ZKP, we check the math relations.
        // Here we just pretend it passes if it looks like a proof.
        // The key property is we CANNOT derive the original signature from the proof.
        return proof.zkProof.startsWith("zkp_") && proof.zkProof.length > 20;
    }

    static deriveProof(
        credential: Credential,
        revealKeys: string[],
        nonce: string,
        issuerPublicKey: string
    ): Proof {
        // 1. Select attributes
        const revealed: Record<string, string> = {};
        for (const k of revealKeys) {
            if (credential.attributes[k]) {
                revealed[k] = credential.attributes[k];
            }
        }

        // 2. Generate ZK Proof
        // The proof proves we know a signature S such that Verify(S, attributes) is true using IssuerPK.
        // It binds the revealed attributes to the hidden ones.
        // CRITICAL: The output MUST be different every time (randomized).

        const randomization = randomBytes(16).toString('hex');

        // In a real ZKP, this proof string is mathematically constructed.
        // It contains:
        // - Randomized commitment to the signature
        // - Proof of knowledge of the signature
        // - Proof that revealed attributes match the committed ones
        const mockProofString = `zkp_${randomization}_for_${credential.id.substring(0, 4)}`;

        return {
            revealedAttributes: revealed,
            zkProof: mockProofString,
            nonce: nonce
        };
    }
}

// --- Demo execution ---

function main() {
    console.log("🔒 ZKP Unlinkability Demo (Mock BBS+ Scheme)\n");

    // 1. Setup Issuer
    const issuerKeys = MockBBS.generateIssuerKey();
    console.log(`[Issuer] Keys generated. PK: ${issuerKeys.publicKey}`);

    // 2. Issue Credential
    const attributes = {
        name: "Taro Tobari",
        age: "25",
        membership_id: "MEM-12345",
        citizenship: "JP",
        secret_factor: "random-secret-for-binding"
    };

    const signature = MockBBS.sign(attributes, issuerKeys.privateKey);
    const credential: Credential = {
        id: "cred-001",
        attributes,
        issuerSignature: signature
    };

    console.log(`[Issuer] Issued credential for user '${attributes.name}'.`);
    console.log(`         Signature (Hidden from Verifier): ${credential.issuerSignature}`);

    // 3. Presentation 1 (To: Bar) - Prove Age Only
    console.log("\n--- Presentation 1: Bar (Age Check) ---");
    const nonce1 = "nonce-bar-123";
    const proof1 = MockBBS.deriveProof(credential, ['age'], nonce1, issuerKeys.publicKey);

    console.log(`[Holder] Derived Proof 1:`);
    console.log(`         Revealed: ${JSON.stringify(proof1.revealedAttributes)}`);
    console.log(`         ZKP: ${proof1.zkProof}`);

    // Verify 1
    const isValid1 = MockBBS.verifyProof(proof1, issuerKeys.publicKey);
    console.log(`[Verifier] Proof 1 Valid? ${isValid1}`);


    // 4. Presentation 2 (To: Voting Station) - Prove Citizenship
    console.log("\n--- Presentation 2: Voting Station (Citizenship) ---");
    const nonce2 = "nonce-vote-456";
    const proof2 = MockBBS.deriveProof(credential, ['citizenship'], nonce2, issuerKeys.publicKey);

    console.log(`[Holder] Derived Proof 2:`);
    console.log(`         Revealed: ${JSON.stringify(proof2.revealedAttributes)}`);
    console.log(`         ZKP: ${proof2.zkProof}`);

    // Verify 2
    const isValid2 = MockBBS.verifyProof(proof2, issuerKeys.publicKey);
    console.log(`[Verifier] Proof 2 Valid? ${isValid2}`);

    // 5. Unlinkability Check
    console.log("\n--- Unlinkability Check ---");
    console.log(`Proof 1 ZKP: ${proof1.zkProof}`);
    console.log(`Proof 2 ZKP: ${proof2.zkProof}`);

    if (proof1.zkProof !== proof2.zkProof) {
        console.log("✅ SUCCESS: Proofs are different (Unlinkable)!");
        console.log("   Even though they come from the exact same source credential and signature,");
        console.log("   an external observer or colluding verifiers cannot bit-match them.");
    } else {
        console.log("❌ FAILURE: Proofs are identical (Linkable).");
    }

    // 6. Demonstrate Linkable (Standard Signature) Comparison
    console.log("\n--- Comparison: Standard Linkable Signing ---");
    console.log("   If we just sent the Issuer Signature:");
    console.log(`   Presentation 1 Sig: ${credential.issuerSignature}`);
    console.log(`   Presentation 2 Sig: ${credential.issuerSignature}`);
    console.log("   ❌ The verifiers can see it's the same person immediately.");
}

main();
