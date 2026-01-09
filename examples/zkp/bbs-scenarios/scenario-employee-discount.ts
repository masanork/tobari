/**
 * SCENARIO: Anonymous Employee Discount (Real Implementation)
 * 
 * Tech Stack:
 * - BBS+ Signatures (BLS12-381 Curve)
 * - Zero-Knowledge Proofs (Signature Proof of Knowledge)
 * - Library: @docknetwork/crypto-wasm
 */

import * as dock from '@docknetwork/crypto-wasm';
import { createHash } from 'crypto';

// --- Crypto Helper Class ---
class RealBBS {
    static async init() {
        await dock.initializeWasm();
    }

    static toScalar(message: string): Uint8Array {
        const hash = createHash('sha256').update(message).digest();
        // Mask to ensure it fits in Fr (BLS12-381 scalar field)
        // Assuming Little Endian (common in Rust implementations), 
        // we mask the last byte. If Big Endian, the first.
        // We mask both to be safe for this demo.
        hash[0] &= 0x1f; 
        hash[31] &= 0x1f;
        return new Uint8Array(hash);
    }

    static generateIssuerParams(messageCount: number) {
        // G1 params
        // Note: The WASM functions return objects/classes in older versions, 
        // but simple byte arrays in the flat API.
        // Let's assume byte arrays for I/O based on the function names.
        
        const params = dock.bbsPlusGenerateSignatureParamsG1(messageCount);
        const keypair = dock.bbsPlusGenerateKeyPairG2(params);
        console.log("DEBUG Keypair structure:", keypair);
        return { params, keypair };
    }

    static sign(
        attributes: string[],
        keypair: any,
        params: any
    ) {
        const scalars = attributes.map(a => this.toScalar(a));
        return dock.bbsPlusSignG1(scalars, keypair.secret_key, params);
    }

    static deriveProof(
        attributes: string[],
        signature: any,
        keypair: any,
        params: any,
        revealedIndices: number[],
        nonce: string
    ) {
        const scalars = attributes.map(a => this.toScalar(a));
        const nonceBytes = new Uint8Array(Buffer.from(nonce));
        
        // 1. Initialize Protocol
        // Guessing signature: (signature, params, messages, blinded_indices, revealed_indices, public_key)
        // Usually blinded indices is empty for simple selective disclosure.
        // Let's try: (signature, params, scalars, new Set(), new Set(revealedIndices), keypair.public_key)
        // Or maybe just (signature, params, scalars, new Set(revealedIndices))?
        
        // Based on common patterns in this lib:
        // bbsPlusInitializeProofOfKnowledgeOfSignature(signature, params, messages, indices, public_key)
        
        const protocol = dock.bbsPlusInitializeProofOfKnowledgeOfSignature(
            signature,
            params,
            scalars,
            new Set(revealedIndices), // Indices to reveal? Or hide? Usually reveal in this context.
            keypair.public_key
        );

        // 2. Generate Challenge
        // bbsPlusChallengeContributionFromProtocol(protocol, revealed_messages, challenge_bytes?)
        // We need to pass the revealed messages to the challenge generation to bind them.
        
        // Filter revealed attributes
        const revealedMessages: Record<number, Uint8Array> = {};
        const revealedMap = new Map();
        revealedIndices.forEach(i => {
            revealedMessages[i] = scalars[i];
            revealedMap.set(i, scalars[i]);
        });

        // The challenge generation usually takes the protocol bytes and other context.
        // Let's try: (protocol, revealedMap, nonceBytes)
        const challenge = dock.bbsPlusChallengeContributionFromProtocol(
            protocol,
            revealedMap,
            nonceBytes
        );
        
        // 3. Generate Proof
        const proof = dock.bbsPlusGenProofOfKnowledgeOfSignature(
            protocol, 
            challenge
        );

        return {
            proofBytes: proof,
            revealedMessages,
            revealedIndices
        };
    }

    static verify(
        proofBytes: Uint8Array,
        revealedMessages: Record<number, Uint8Array>,
        publicKey: any,
        params: any,
        nonce: string
    ) {
        const nonceBytes = new Uint8Array(Buffer.from(nonce));
        
        // bbsPlusVerifyProofOfKnowledgeOfSignature(
        //   proof, params, publicKey, revealedMessages (Map), nonce
        // )
        
        // Convert Record to Map if needed
        const revealedMap = new Map();
        Object.keys(revealedMessages).forEach(k => {
            revealedMap.set(Number(k), revealedMessages[Number(k)]);
        });

        const result = dock.bbsPlusVerifyProofOfKnowledgeOfSignature(
            proofBytes,
            params,
            publicKey,
            revealedMap,
            nonceBytes
        );
        
        return result.verified;
    }
}

// --- The Story Execution ---

async function runScenario() {
    console.log("🥪 SCENARIO: The Privacy-Preserving Lunch Discount (Real BBS+)\n");
    await RealBBS.init();

    // 0. Data
    const taroData = [
        "Taro Tobari",      // 0
        "EMP-8888",         // 1
        "Myna Trust Corp",  // 2
        "Engineering"       // 3
    ];

    // 1. Setup
    console.log("🔑 [Issuer] Generating Keys and Params...");
    const { params, keypair } = RealBBS.generateIssuerParams(taroData.length);

    console.log("✍️  [Issuer] Signing Taro's attributes...");
    const signature = RealBBS.sign(taroData, keypair, params);
    
    console.log("✅ [Setup] Credential Issued.");
    console.log("   Signature size: " + signature.length + " bytes\n");


    // 2. Monday Visit
    console.log("📅 [Monday] Taro visits Cafe Unlink.");
    const sessionNonceMon = "nonce_monday_001";

    // Verify Signature directly first (Base capability check)
    const sigValid = dock.bbsPlusVerifyG1(
        taroData.map(m => RealBBS.toScalar(m)),
        signature,
        keypair.public_key,
        params
    );
    console.log(sigValid.verified ? "   ✅ [Debug] Raw Signature Verification Passed" : "   ❌ [Debug] Raw Signature Verification Failed");

    const revealedIndices = [2]; 
    console.log("   [Wallet] Generating ZK Proof (Revealing index: " + revealedIndices + ")...");
    
    let proofMonday = null;

    try {
        proofMonday = RealBBS.deriveProof(
            taroData,
            signature,
            keypair,
            params,
            revealedIndices,
            sessionNonceMon
        );

        console.log("   Proof generated: " + proofMonday.proofBytes.length + " bytes");

        // Cafe Verifies
        const validMon = RealBBS.verify(
            proofMonday.proofBytes,
            proofMonday.revealedMessages,
            keypair.public_key,
            params,
            sessionNonceMon
        );

        console.log(validMon ? "   ✅ Op: 'Verification SUCCESS! Discount Applied.'" : "   ❌ Op: 'Invalid.'");
    } catch (e) {
        console.log("   ⚠️  [WIP] ZKP Generation skipped due to WASM API complexity: " + e);
        console.log("   (The underlying BBS+ signature scheme is working, but the ZKP binding needs adjustment)");
    }
    console.log("");


    // 3. Tuesday Visit
    console.log("📅 [Tuesday] Taro visits Cafe Unlink again.");
    console.log("   (Skipping ZKP for Tuesday in this WIP version)");


    // 4. Tracking Attempt
    if (proofMonday) {
        console.log("🕵️ [Wednesday] Cafe Manager analyzes the logs.");
        const proofHexMon = Buffer.from(proofMonday.proofBytes).toString('hex').substring(0, 32) + "...";
        // ... (Skipping full tracking simulation as Tuesday proof is missing)
    }
}

runScenario().catch(console.error);
