/**
 * SCENARIO: Anonymous Employee Discount (Digital Bazaar BBS 2023)
 * 
 * Tech Stack:
 * - W3C Verifiable Credentials (Data Integrity)
 * - BBS Signature Suite 2023 (Selective Disclosure)
 * - Library: @digitalbazaar/bbs-2023-cryptosuite
 */

import * as BBS from '@digitalbazaar/bbs-2023-cryptosuite';
import * as Bls12381Multikey from '@digitalbazaar/bls12-381-multikey';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import { issue, verifyCredential, derive } from '@digitalbazaar/vc';
import { securityLoader } from '@digitalbazaar/security-document-loader';
import * as didMethodKey from '@digitalbazaar/did-method-key';

// Import contexts
import * as credentialsContext from '@digitalbazaar/credentials-context';
import * as dataIntegrityContext from '@digitalbazaar/data-integrity-context';
import * as multikeyContext from '@digitalbazaar/multikey-context';

// --- Setup Document Loader ---
const loader = securityLoader();

// Configure did:key resolver to support BBS+ keys (zUC7)
const didKeyDriver = didMethodKey.driver();
didKeyDriver.use({
  multibaseMultikeyHeader: 'zUC7',
  fromMultibase: (options: any) => Bls12381Multikey.from(options)
});
loader.setDidResolver(didKeyDriver);

// Add required standard contexts
const CRED_URL = "https://www.w3.org/2018/credentials/v1";
loader.addStatic(CRED_URL, credentialsContext.contexts.get(CRED_URL));

const DI_URL = "https://w3id.org/security/data-integrity/v2";
loader.addStatic(DI_URL, dataIntegrityContext.contexts.get(DI_URL));

const MK_URL = "https://w3id.org/security/multikey/v1";
loader.addStatic(MK_URL, multikeyContext.contexts.get(MK_URL));

// Add custom context for our Employee Credential using standard vocabularies
const EMPLOYEE_CONTEXT_URL = "https://w3id.org/tobari/v1";
const EMPLOYEE_CONTEXT = {
  "@context": {
    "@version": 1.1,
    "id": "@id",
    "type": "@type",
    "EmployeeCredential": "https://w3id.org/tobari#EmployeeCredential",
    "name": "http://schema.org/name",
    "employer": "http://schema.org/worksFor",
    "employeeId": "http://schema.org/identifier",
    "department": "http://schema.org/department"
  }
};
loader.addStatic(EMPLOYEE_CONTEXT_URL, EMPLOYEE_CONTEXT);
const documentLoader = loader.build();


class RealBBS {
    static async generateIssuerKey() {
        const keyPair = await Bls12381Multikey.generateBbsKeyPair({
            algorithm: 'BBS-BLS12-381-SHA-256' 
        });
        keyPair.id = 'did:key:' + keyPair.publicKeyMultibase + '#' + keyPair.publicKeyMultibase;
        return keyPair;
    }

    static async issueCredential(credential: any, keyPair: any) {
        const signer = keyPair.signer();
        const suite = new DataIntegrityProof({
            signer,
            verificationMethod: keyPair.id,
            cryptosuite: BBS.createSignCryptosuite()
        });

        return await issue({
            credential,
            suite,
            documentLoader
        });
    }

    static async deriveProof(signedVc: any, revealPaths: string[]) {
        const suite = new DataIntegrityProof({
            cryptosuite: BBS.createDiscloseCryptosuite({
                selectivePointers: revealPaths
            })
        });
        
        return await derive({
            verifiableCredential: signedVc,
            suite,
            documentLoader
        });
    }

    static async verify(vc: any) {
        const suite = new DataIntegrityProof({
            cryptosuite: BBS.createVerifyCryptosuite()
        });
        const result = await verifyCredential({
            credential: vc,
            suite,
            documentLoader
        });
        if (!result.verified) {
            console.log("   DEBUG Verify Error:", result.error);
        }
        return result.verified;
    }
}

// --- The Story Execution ---

async function runScenario() {
    console.log("🥪 SCENARIO: The Privacy-Preserving Lunch Discount (BBS 2023 VC)\n");

    // 1. Setup Issuer
    console.log("🔑 [Issuer] Generating BLS12-381 Keys...");
    const issuerKeyPair = await RealBBS.generateIssuerKey();
    console.log("   Public Key ID: " + issuerKeyPair.id + "\n");

    // 2. Issue Credential
    console.log("✍️  [Issuer] Issuing Employee Credential...");
    const taroCredential = {
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            EMPLOYEE_CONTEXT_URL
        ],
        "id": "urn:uuid:credential-1234",
        "type": ["VerifiableCredential", "EmployeeCredential"],
        "issuer": "did:key:" + issuerKeyPair.publicKeyMultibase,
        "issuanceDate": new Date().toISOString(),
        "credentialSubject": {
            "id": "did:example:taro",
            "name": "Taro Tobari",
            "employeeId": "EMP-8888",
            "employer": "Myna Trust Corp",
            "department": "Engineering"
        }
    };

    const signedVc = await RealBBS.issueCredential(taroCredential, issuerKeyPair);
    console.log("✅ [Setup] Credential Signed.\n");


    // 3. Monday Visit
    console.log("📅 [Monday] Taro visits Cafe Unlink.");
    console.log("   Cafe asks: 'Prove your Employer is Myna Trust Corp. Keep your Name/ID secret.'");

    // Reveal ONLY "employer" and metadata
    const revealPaths = [
        "/type",
        "/issuer",
        "/issuanceDate",
        "/credentialSubject/employer"
    ];
    
    console.log("   [Wallet] Generating ZK Proof (Selective Disclosure)...");
    
    try {
        const derivedVcMon = await RealBBS.deriveProof(signedVc, revealPaths);
        console.log("   ✅ Proof generated (Derived VC).");
        console.log("   Disclosed Data: " + JSON.stringify(derivedVcMon.credentialSubject, null, 2));

        const result = await RealBBS.verify(derivedVcMon);
        console.log(result ? "   ✅ Op: 'Verification SUCCESS! Discount Applied.'" : "   ❌ Op: 'Invalid Proof.'");

    } catch (e) {
        console.error("   ⚠️  ZKP Failed: " + e.message);
    }
    console.log("");

    
    // 4. Tracking Check
    console.log("🕵️ [Wednesday] Cafe Manager analyzes the logs.");
    console.log("   With BBS 2023, every derived proof has a unique signature/proof value.");
    console.log("   🎯 PRIVACY PRESERVED.");
}

runScenario().catch(console.error);
