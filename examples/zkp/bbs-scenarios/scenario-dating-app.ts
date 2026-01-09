
/**
 * SCENARIO: Privacy-Preserving Dating App Registration
 * 
 * Context:
 * "MatchUnlink" is a high-end dating app.
 * To join, you must prove:
 * 1. You are an adult (Age >= 18).
 * 2. You have a stable income (Income >= 6,000,000 JPY).
 * 3. You are single (Marital Status = "Unmarried").
 * 
 * Challenge:
 * Users do NOT want to upload their Driver's License, Tax Certificate, or Koseki (Family Register)
 * to a dating app server, risking data leaks.
 * 
 * Solution:
 * **Multi-Credential ZKP with Link Secrets**.
 * 
 * Mechanism:
 * 1. The user obtains 3 separate credentials from different authorities (Gov, Tax Agency, Municipality).
 * 2. Each credential includes a hidden user-specific "Link Secret" (embedded during issuance).
 * 3. The user generates a SINGLE compound proof that says:
 *    "I hold Credential A (Age), Credential B (Income), and Credential C (Status).
 *     They all satisfy the conditions.
 *     AND they all share the SAME Link Secret (meaning they belong to the same person)."
 * 
 * Result:
 * - App verifies the attributes.
 * - App knows the certs belong to one person.
 * - App learns NOTHING else (No Name, No Address, No exact Birthdate, No exact Income).
 */

import { randomBytes, createHash } from 'crypto';

// --- Mock Multi-Credential ZKP Engine ---

class MockMultiBBS {
    static generateIssuerKey(name: string) {
        return {
            name,
            privateKey: `sk_${name}_` + randomBytes(4).toString('hex')
        };
    }

    // Issuer signs attributes INCLUDING the user's Link Secret (blinded in real life)
    static sign(attributes: Record<string, string | number>, linkSecret: string, privateKey: string) {
        // We hash the attributes AND the linkSecret together.
        // In real BBS+, the Link Secret is a scalar committed to by the holder, 
        // and the Issuer signs on the commitment.
        const content = Object.entries(attributes)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([k, v]) => `${k}:${v}`)
            .join('|');

        const h = createHash('sha256').update(content + linkSecret + privateKey).digest('hex');
        return {
            issuer: privateKey.split('_')[1],
            signature: `sig_${h.substring(0, 12)}`,
            attributes,
            linkSecret // Stored in the credential for our simulation (hidden in real life)
        };
    }

    static deriveCompoundProof(
        credentials: any[],
        predicates: ((attrs: any) => boolean)[],
        nonce: string
    ) {
        // 1. Check all credentials contain the SAME Link Secret
        const firstSecret = credentials[0].linkSecret;
        const allSameSecret = credentials.every(c => c.linkSecret === firstSecret);
        if (!allSameSecret) {
            throw new Error("Credentials do not belong to the same identity! (Link Secret Mismatch)");
        }

        // 2. Check each credential satisfies its specific predicate
        // (Assuming 1-to-1 mapping for simplicity of this partial demo)
        for (let i = 0; i < credentials.length; i++) {
            if (!predicates[i](credentials[i].attributes)) {
                throw new Error(`Credential ${i} failed predicate check.`);
            }
        }

        // 3. Generate a Compound Proof
        // In ZKP, this proves knowledge of signatures AND equality of the Link Secret
        const randomization = randomBytes(8).toString('hex');

        return {
            proofValue: `zkp_compound_${randomization}_${nonce}`,
            nonce,
            // We reveal NOTHING except the fact that the predicates passed.
            // In a real ZKP, we might output "Range Proof: Income > 6000000" explicitly.
            provedPredicates: [
                "Age >= 18",
                "Income >= 6,000,000",
                "Status == 'Unmarried'"
            ]
        };
    }

    static verify(proof: any) {
        // Verify the math (Mock)
        return proof.proofValue.startsWith('zkp_compound_');
    }
}

// --- The Scenario ---

const LINK_SECRET = "taro-secret-identity-factor-999"; // User's hidden secret

function runDatingScenario() {
    console.log("💘 SCENARIO: Anonymous High-Spec Dating App Registration\n");

    // 1. Issuers Setup
    const govIssuer = MockMultiBBS.generateIssuerKey("GOV_ID");
    const taxIssuer = MockMultiBBS.generateIssuerKey("TAX_AGENCY");
    const cityIssuer = MockMultiBBS.generateIssuerKey("CITY_HALL");

    // 2. Taro collects credentials (User activity)
    // He presents his Link Secret (blinded) to each issuer to get these bound to him.

    // Cred 1: Identity Card (My Number Card)
    const credIdentity = MockMultiBBS.sign({
        type: "Identity",
        name: "Taro Tobari",
        birthYear: 1995, // Age 30
        address: "Tokyo"
    }, LINK_SECRET, govIssuer.privateKey);

    // Cred 2: Income Certificate (Tax Return)
    const credIncome = MockMultiBBS.sign({
        type: "Tax",
        year: 2025,
        currency: "JPY",
        amount: 8500000 // 8.5 Million Yen
    }, LINK_SECRET, taxIssuer.privateKey);

    // Cred 3: Koseki (Civil Status)
    const credKoseki = MockMultiBBS.sign({
        type: "Koseki",
        details: "Single/Unmarried", // Simplified
        issueDate: "2026-01-01"
    }, LINK_SECRET, cityIssuer.privateKey);

    console.log("✅ [Wallet] Taro collected 3 credentials bound to his Link Secret.");
    console.log("   1. Gov ID (Age 30)");
    console.log("   2. Tax Cert (8.5M JPY)");
    console.log("   3. Koseki (Single)\n");


    // 3. Registration Presentation
    console.log("📱 [App] MatchUnlink Registration.");
    console.log("   Requirements: Age >= 18 AND Income >= 6M AND Single.");
    console.log("   ... AND verify all certs belong to the SAME person.");

    const sessionNonce = "login_challenge_xyz";

    // User selects the 3 credentials and generates a proof
    try {
        const proof = MockMultiBBS.deriveCompoundProof(
            [credIdentity, credIncome, credKoseki],
            [
                (c) => (2026 - c.birthYear) >= 18,     // Predicate 1
                (c) => c.amount >= 6000000,            // Predicate 2
                (c) => c.details === "Single/Unmarried"// Predicate 3
            ],
            sessionNonce
        );

        console.log("🚀 [Wallet] Generated ZK Compound Proof.");
        console.log(`   Proof String: ${proof.proofValue}`);
        console.log(`   Proved: ${JSON.stringify(proof.provedPredicates)}`);

        // 4. Verification
        const isValid = MockMultiBBS.verify(proof);
        if (isValid) {
            console.log("\n🎉 [Server] Verification SUCCESS!");
            console.log("   - User meets all criteria.");
            console.log("   - User identity (Name/Address) is UNKNOWN.");
            console.log("   - Credentials are confirmed to belong to the SAME entity.");
            console.log("   -> Account Created.");
        } else {
            console.log("❌ Verified Failed.");
        }

    } catch (e) {
        console.error("❌ Proof Generation Failed:", e);
    }
}

// Optional: Test Failure Case (Borrowing someone else's high income cert)
function runAttackScenario() {
    console.log("\n😈 [Attack] Jiro tries to use Taro's Income Cert mixed with Jiro's ID.");

    // Jiro's Secret
    const JIRO_SECRET = "jiro-secret-111";

    const govIssuer = MockMultiBBS.generateIssuerKey("GOV_ID"); // Reusing/New keys for sim
    const taxIssuer = MockMultiBBS.generateIssuerKey("TAX_AGENCY");

    // Jiro's ID (Low Income)
    const credIdentityJiro = MockMultiBBS.sign({ birthYear: 2000 }, JIRO_SECRET, govIssuer.privateKey);

    // Taro's Income (High Income) - from previous run effectively
    const credIncomeTaro = MockMultiBBS.sign({ amount: 8500000 }, "taro-secret-999", taxIssuer.privateKey);

    try {
        console.log("   [Wallet] Jiro attempts to combine Jiro's ID + Taro's Income...");
        MockMultiBBS.deriveCompoundProof(
            [credIdentityJiro, credIncomeTaro],
            [() => true, () => true], // Predicates irrelevant here
            "nonce_attack"
        );
    } catch (e: any) {
        console.log(`   🛡️ BLOCKED: ${e.message}`);
        console.log("   The math prevents combining credentials with different Link Secrets.");
    }
}

runDatingScenario();
runAttackScenario();
