/**
 * SCAC with BBS+ Selective Disclosure
 * 
 * Demonstrates:
 * 1. Issuing a SCAC (Crypto Account Credential) using BBS+ 2023.
 * 2. Deriving an anonymous proof that only reveals the wallet address.
 */

import * as BBS from '@digitalbazaar/bbs-2023-cryptosuite';
import * as Bls12381Multikey from '@digitalbazaar/bls12-381-multikey';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import { issue, verifyCredential, derive } from '@digitalbazaar/vc';
import { securityLoader } from '@digitalbazaar/security-document-loader';
import * as didMethodKey from '@digitalbazaar/did-method-key';
import * as credentialsContext from '@digitalbazaar/credentials-context';
import * as dataIntegrityContext from '@digitalbazaar/data-integrity-context';
import * as multikeyContext from '@digitalbazaar/multikey-context';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

// --- Setup Infrastructure ---
const loader = securityLoader();
const didKeyDriver = didMethodKey.driver();
didKeyDriver.use({
  multibaseMultikeyHeader: 'zUC7',
  fromMultibase: (options: any) => Bls12381Multikey.from(options)
});
loader.setDidResolver(didKeyDriver);

// Standard Contexts
const CRED_V1 = "https://www.w3.org/2018/credentials/v1";
loader.addStatic(CRED_V1, credentialsContext.contexts.get(CRED_V1));
const DI_V2 = "https://w3id.org/security/data-integrity/v2";
loader.addStatic(DI_V2, dataIntegrityContext.contexts.get(DI_V2));
const MK_V1 = "https://w3id.org/security/multikey/v1";
loader.addStatic(MK_V1, multikeyContext.contexts.get(MK_V1));

const documentLoader = loader.build();

async function main() {
    console.log("🚀 Generating SCAC with BBS+ Selective Disclosure...\n");

    // 1. Setup Issuer
    const keyPair = await Bls12381Multikey.generateBbsKeyPair({
        algorithm: 'BBS-BLS12-381-SHA-256' 
    });
    keyPair.id = 'did:key:' + keyPair.publicKeyMultibase + '#' + keyPair.publicKeyMultibase;

    // 2. Prepare Data (Mapped from scac-data.yaml)
    const dataStr = await fs.readFile(path.join(__dirname, 'scac-data.yaml'), 'utf-8');
    const rawData = yaml.load(dataStr) as any;

    const credential = {
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            {
                "@version": 1.1,
                "id": "@id",
                "type": "@type",
                "SelfHostedCryptoAccountCredential": "https://io.github.masanork.tobari#SelfHostedCryptoAccountCredential",
                "accounts": "https://io.github.masanork.tobari#accounts",
                "chain": "http://schema.org/name",
                "chain_id": "http://schema.org/identifier",
                "address": "http://schema.org/address",
                "binding": "http://schema.org/action",
                "family_name": "http://schema.org/familyName",
                "given_name": "http://schema.org/givenName",
                "birth_date": "http://schema.org/birthDate",
                "nationality": "http://schema.org/nationality",
                "document_type": "https://io.github.masanork.tobari#documentType",
                "verification_level": "https://io.github.masanork.tobari#verificationLevel"
            }
        ],
        "id": "urn:uuid:scac-demo-" + Date.now(),
        "type": ["VerifiableCredential", "SelfHostedCryptoAccountCredential"],
        "issuer": "did:key:" + keyPair.publicKeyMultibase,
        "issuanceDate": new Date().toISOString(),
        "credentialSubject": {
            "id": "did:example:holder-eth-address",
            "verification_level": rawData.verification_level,
            "family_name": rawData.family_name,
            "given_name": rawData.given_name,
            "birth_date": rawData.birth_date,
            "nationality": rawData.nationality,
            "document_type": rawData.document_type,
            "accounts": rawData.accounts 
        }
    };

    // 3. Issue BBS+ Signed VC
    console.log("✍️  [Issuer] Signing Multi-Chain Portfolio with BBS+...");
    const signer = keyPair.signer();
    const suite = new DataIntegrityProof({
        signer,
        verificationMethod: keyPair.id,
        cryptosuite: BBS.createSignCryptosuite()
    });

    const signedVc = await issue({
        credential,
        suite,
        documentLoader
    });
    console.log("   ✅ SCAC Issued. (Contains Name, DOB, and 3 Accounts)\n");

    // 4. Selective Disclosure Demo
    console.log("📅 [Scenario] User wants to log in to an exchange.");
    console.log("   Required: Proof of Ethereum address ownership AND age verification.");
    console.log("   Secret: User's real name and other accounts (Solana, etc.)\n");

    // Reveal only necessary fields
    const revealPaths = [
        "/type",
        "/issuer",
        "/issuanceDate",
        "/credentialSubject/birth_date",
        "/credentialSubject/accounts/0" 
    ];

    console.log("🛡️  [Holder] Generating ZK Proof (Selective Disclosure)...");
    const discloseSuite = new DataIntegrityProof({
        cryptosuite: BBS.createDiscloseCryptosuite({
            selectivePointers: revealPaths
        })
    });

    const derivedVc = await derive({
        verifiableCredential: signedVc,
        suite: discloseSuite,
        documentLoader
    });

    console.log("   ✅ Derived VC generated.");
    console.log("   --- DISCLOSED DATA ---");
    console.log(JSON.stringify(derivedVc.credentialSubject, null, 2));
    console.log("   ----------------------\n");

    // 5. Verification
    console.log("🔍 [Verifier] Validating ZK Proof...");
    const verifySuite = new DataIntegrityProof({
        cryptosuite: BBS.createVerifyCryptosuite()
    });

    const result = await verifyCredential({
        credential: derivedVc,
        suite: verifySuite,
        documentLoader
    });

    if (result.verified) {
        console.log("   ✅ VERIFICATION SUCCESS!");
        console.log("   The exchange now knows the user is the owner of the Eth address");
        console.log("   and has a verified birth_date, WITHOUT seeing the user's name.");
    } else {
        console.log("   ❌ VERIFICATION FAILED.");
        console.error(result.error);
    }
}

main().catch(console.error);
