import { expect, test, describe, mock } from "bun:test";
import { verifyIdentityEvidence, verifyTobari, verifyPresentation } from "../src/validator";
import { encode, decode } from "cbor-x";
import { COSE_ALG, COSE_HEADER_LABELS } from "@tobari/crypto/utils";

// Mock crypto for deterministic testing
const originalCrypto = global.crypto;

describe("Validator Coverage - Identity Evidence", () => {
    
    test("Passport - should handle missing SOD or DGs gracefully", async () => {
        const data = { sod: "invalid", dg1: null }; 
        const result = await verifyIdentityEvidence(data);
        // Should not crash, just return valid=false or specific details
        // In current logic: "if (data.sod && (data.dg1 || data.dg2))" checks presence.
        // If dg1 is null, it might skip verification.
        
        // Case 1: Minimal valid structure to enter block
        const data2 = { sod: "c29k", dg1: "ZGcx" }; // dummy base64
        const res2 = await verifyIdentityEvidence(data2);
        
        expect(res2.overallValid).toBe(false);
        // It enters the block, fails verification, and pushes "Passport Authenticity"
        const sodDetail = res2.details.find((d: any) => d.type === "Passport Authenticity");
        expect(sodDetail).toBeDefined();
    });

    test("Driver's License - integrity check", async () => {
        // Valid case simulation
        const raw = new Uint8Array([1, 2, 3]);
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
        // We can't easily mock the signature check logic inside without full crypto, 
        // but we can check the flow.
        
        const data = {
            raw_data_group1: Buffer.from(raw).toString('base64'),
            signature: "sig"
        };
        
        const res = await verifyIdentityEvidence(data);
        // It should pass the "Evidence Present" check even if signature verification isn't fully implemented in that block 
        // (The code says: "Police signature and raw data group found. Integrity verified via hash.")
        
        const dlDetail = res.details.find((d: any) => d.type === "Driver's License Integrity");
        expect(dlDetail).toBeDefined();
        expect(dlDetail.status).toBe("Evidence Present");
    });
    
    test("JPKI - should handle invalid certs", async () => {
        const data = {
            auth_cert: "invalid_cert_base64"
        };
        
        const res = await verifyIdentityEvidence(data);
        const jpkiDetail = res.details.find((d: any) => d.type === "JPKI");
        expect(jpkiDetail).toBeDefined();
        expect(jpkiDetail.status).toBe("Error");
    });
});

describe("Validator Coverage - verifyTobari", () => {
    test("should handle invalid input format", async () => {
        const res = await verifyTobari("not_base64", {} as any);
        expect(res.isValid).toBe(false);
    });

    test("should handle missing issuerSigned", async () => {
        const doc = encode({ other: "data" });
        const res = await verifyTobari(doc, {} as any);
        expect(res.isValid).toBe(false);
        expect(res.error).toContain("missing issuerSigned");
    });
});

describe("Validator Coverage - verifyPresentation", () => {
    test("should handle missing public key", async () => {
        const presentation = {
            documents: [{ docType: "org.iso.18013.5.1.mDL", issuerSigned: { issuerAuth: new Uint8Array(0) } }]
        };
        
        try {
            await verifyPresentation(presentation, {});
        } catch (e: any) {
            // It might return a result with error or throw depending on where it fails.
            // The code catches errors inside the loop and returns result.error.
        }
        
        const results = await verifyPresentation(presentation, {});
        expect(results[0].error).toContain("No public key provided");
    });
    
    test("should handle invalid issuer auth token", async () => {
        const presentation = {
            documents: [{ 
                docType: "test", 
                issuerSigned: { 
                    issuerAuth: encode([
                        new Uint8Array(0), 
                        {}, 
                        new Uint8Array(0), 
                        new Uint8Array(0)
                    ]) // Malformed COSE
                } 
            }]
        };
        
        // Mock public key
        const keyPair = await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["sign", "verify"]
        );
        
        const results = await verifyPresentation(presentation, { "test": keyPair.publicKey });
        expect(results[0].error).toBeDefined();
        expect(results[0].error).toContain("Issuer signature verification failed");
    });
});
