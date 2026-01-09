
/**
 * SCENARIO: Anonymous Employee Discount
 * 
 * Context:
 * "Cafe Unlink" offers a 10% discount to employees of "Myna Trust Corp".
 * Taro works at Myna Trust. He wants the discount but values his privacy.
 * He visits the cafe multiple times.
 * 
 * Problem with Standard Id (Legacy):
 * - Taro shows his Employee ID card or a standard digital cert.
 * - The Cafe records: "Employee ID 12345 visited on Monday."
 * - The Cafe records: "Employee ID 12345 visited on Tuesday."
 * -> The Cafe builds a tracking profile on Taro.
 * 
 * Solution with ZKP (Tobari Unlinkable):
 * - Taro proves: "I have a valid credential issued by Myna Trust HR."
 * - Taro proves: "Employer Name = 'Myna Trust Corp'."
 * - He reveals NOTHING else (No Name, No ID).
 * - Every time he generates a proof, it looks completely different.
 * -> The Cafe validates eligibility but CANNOT link the visits.
 */

import { randomBytes, createHash } from 'crypto';

// --- (Reusing Mock Crypto Logic for Demo) ---
class MockBBS {
    static generateIssuerKey() {
        return {
            publicKey: "pk_issuer_" + randomBytes(4).toString('hex'),
            privateKey: "sk_issuer_" + randomBytes(4).toString('hex')
        };
    }

    static sign(attributes: Record<string, string>, privateKey: string) {
        // Simulating a signature on the attribute vector
        const content = Object.values(attributes).sort().join('|');
        const h = createHash('sha256').update(content + privateKey).digest('hex');
        return `bbs_signature_${h.substring(0, 16)}...`;
    }

    static deriveProof(credential: any, predicate: (attrs: any) => boolean, nonce: string) {
        // In real ZKP, we prove the predicate is true without revealing values if needed.
        // Here we simulate a "Signature Proof of Knowledge" that hides the signature
        // and selectively discloses only what is needed.

        // 1. Check if credential satisfies predicate internally
        if (!predicate(credential.attributes)) {
            throw new Error("Credential does not satisfy the requirements!");
        }

        // 2. Generate Randomized Proof
        // The proof is unique to this 'nonce' (session) and random factors
        const randomization = randomBytes(8).toString('hex');
        const proofValue = `zkp_proof_${randomization}_${nonce}_verified_issuer`;

        return {
            proofValue,
            nonce,
            // In this scenario, we reveal the Employer Name to match the discount rule,
            // but we keep the Employee Name/ID hidden.
            revealed: {
                "employer": credential.attributes.employer
            }
        };
    }

    static verify(proof: any, expectedEmployer: string) {
        // 1. Verify the proof is cryptographically valid (Mock: starts with zkp_)
        if (!proof.proofValue.startsWith('zkp_proof_')) return false;

        // 2. Verify the disclosed attribute matches the requirement
        if (proof.revealed.employer !== expectedEmployer) return false;

        return true;
    }
}

// --- The Story Execution ---

function runScenario() {
    console.log("🥪 SCENARIO: The Privacy-Preserving Lunch Discount\n");

    // 1. Setup: HR Department issues Credential
    const hrKeys = MockBBS.generateIssuerKey();
    const taroData = {
        name: "Taro Tobari",
        id: "EMP-8888",
        employer: "Myna Trust Corp",
        department: "Engineering"
    };

    // HR signs the data. Taro gets this credential.
    const taroCredential = {
        attributes: taroData,
        signature: MockBBS.sign(taroData, hrKeys.privateKey)
    };

    console.log("✅ [Setup] Taro received his Digital Work Certificate.");
    console.log(`   Internal Data: ${JSON.stringify(taroData)}`);
    console.log(`   (Signature is hidden in his wallet)\n`);


    // 2. Monday Visit
    console.log("📅 [Monday] Taro visits Cafe Unlink.");
    console.log("   Cafe asks: 'Are you a Myna Trust employee? Prove it with a Fresh Nonce.'");
    const sessionNonceMon = "nonce_monday_001";

    // Taro's wallet generates a ZK Proof
    // He chooses to reveal ONLY 'employer'. Name and ID are hidden.
    const proofMonday = MockBBS.deriveProof(
        taroCredential,
        (attrs) => attrs.employer === "Myna Trust Corp",
        sessionNonceMon
    );

    console.log(`   [Wallet] Generating Proof...`);
    console.log(`   Proof Sent: ${JSON.stringify(proofMonday)}`);

    const validMon = MockBBS.verify(proofMonday, "Myna Trust Corp");
    console.log(validMon ? "   Op: 'Discount Applied! Enjoy.'" : "   Op: 'Invalid.'");
    console.log("");


    // 3. Tuesday Visit
    console.log("📅 [Tuesday] Taro visits Cafe Unlink again.");
    console.log("   Cafe asks: 'Are you a Myna Trust employee?' (New Session)");
    const sessionNonceTue = "nonce_tuesday_002";

    // Taro's wallet generates a NEW ZK Proof from the SAME credential
    const proofTuesday = MockBBS.deriveProof(
        taroCredential,
        (attrs) => attrs.employer === "Myna Trust Corp",
        sessionNonceTue
    );

    console.log(`   [Wallet] Generating Proof...`);
    console.log(`   Proof Sent: ${JSON.stringify(proofTuesday)}`);

    const validTue = MockBBS.verify(proofTuesday, "Myna Trust Corp");
    console.log(validTue ? "   Op: 'Discount Applied! Enjoy.'" : "   Op: 'Invalid.'");
    console.log("");


    // 4. The Cafe's Tracking Attempt
    console.log("🕵️ [Wednesday] Cafe Manager analyzes the logs to track customers.");
    console.log("   Log Monday:  " + proofMonday.proofValue);
    console.log("   Log Tuesday: " + proofTuesday.proofValue);

    if (proofMonday.proofValue === proofTuesday.proofValue) {
        console.log("   ⚠️  MATCH FOUND: 'This guy came yesterday! Tracking ID: ...'");
    } else {
        console.log("   ❌ NO MATCH: The proof strings are completely different.");
        console.log("   The Manager knows two valid employees came, but cannot tell if it's the same person.");
        console.log("   🎯 PRIVACY PRESERVED (Unlinkability achieved)");
    }
}

runScenario();
