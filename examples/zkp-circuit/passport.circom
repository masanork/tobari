pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * Passport DG1 Integrity Verifier
 * 
 * Proves that the user knows a valid DG1 content (MRZ) that:
 * 1. Hashes to a specific value (Public Hash) - proving possession.
 * 2. Contains specific Birth Date (YYMMDD) at specific position.
 * 3. Contains specific Expiry Date (YYMMDD) at specific position.
 * 
 * Note: Real passport verification requires RSA/ECDSA signature verification (SOD).
 * This circuit is a simplified PoC focusing on data extraction and hashing.
 */

template PassportVerifier() {
    // Input: MRZ data (TD3 format: 88 chars = 88 bytes = 704 bits)
    // We process it in chunks or bits. For SHA256, we need bits.
    signal input mrz_bits[704]; 

    // Public Input: Hash of the MRZ (to bind the proof to a specific passport snapshot)
    signal input mrz_hash[256];

    // Public Input: Identity Claims (Birth Date, Expiry Date)
    // Format: YYMMDD (6 digits -> 6 bytes -> 48 bits)
    // We pass them as integers or raw bits. Let's use bits for direct comparison.
    signal input birth_date_bits[48];
    signal input expiry_date_bits[48];

    // --- 1. Verify SHA-256 Hash of MRZ ---
    component sha256 = Sha256(704);
    for (var i = 0; i < 704; i++) {
        sha256.in[i] <== mrz_bits[i];
    }

    for (var i = 0; i < 256; i++) {
        mrz_hash[i] === sha256.out[i];
    }

    // --- 2. Verify Birth Date ---
    // In TD3 MRZ, Birth Date starts at line 2, char 14 (index 57 in 0-indexed flat string)
    // 44 chars per line. Line 2 starts at index 44.
    // Index 44 + 13 = 57.
    // Length: 6 chars (48 bits).
    
    var birth_offset = 57 * 8; 
    for (var i = 0; i < 48; i++) {
        mrz_bits[birth_offset + i] === birth_date_bits[i];
    }

    // --- 3. Verify Expiry Date ---
    // In TD3 MRZ, Expiry Date starts at line 2, char 22 (index 65)
    // Index 44 + 21 = 65.
    
    var expiry_offset = 65 * 8;
    for (var i = 0; i < 48; i++) {
        mrz_bits[expiry_offset + i] === expiry_date_bits[i];
    }
}

component main {public [mrz_hash, birth_date_bits, expiry_date_bits]} = PassportVerifier();
