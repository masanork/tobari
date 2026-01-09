pragma circom 2.0.0;

include "node_modules/circomlib/circuits/sha256/sha256.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/gates.circom";

// --- Helper: Verify Age (Simplified for TD3 MRZ YY logic) ---
template AgeVerifier() {
    // Input: Birth Date (YY, MM, DD)
    signal input birth_y; // 0-99
    signal input birth_m; // 1-12
    signal input birth_d; // 1-31

    // Input: Current Date (YYYY, MM, DD)
    signal input current_y; // e.g. 2026
    signal input current_m;
    signal input current_d;
    signal input threshold; // e.g. 18

    signal output is_older;

    // 1. Determine Birth Full Year
    // Logic: If birth_y > (current_y % 100), assume previous century.
    // e.g. Current=2026 (26). Birth=99. 99 > 26 -> 1999.
    //      Current=2026 (26). Birth=05. 05 <= 26 -> 2005.
    
    // Extract current YY
    // Note: In Circom, % is not directly supported for signals, but we can do it if inputs are known.
    // However, current_y is a signal. We need to compute it.
    // Let's rely on an auxiliary input or simple math since we know the range.
    // Let's assume current_y is 20XX.
    var current_yy = current_y - 2000; // Simplified for 2000-2099 range.

    component lt_y = LessThan(8);
    lt_y.in[0] <== current_yy;
    lt_y.in[1] <== birth_y;
    
    signal is_prev_century;
    is_prev_century <== lt_y.out; // 1 if current_yy < birth_y

    signal birth_full_year;
    birth_full_year <== (is_prev_century * 1900) + ((1 - is_prev_century) * 2000) + birth_y;

    // 2. Calculate Age
    // We want to prove: (current_y - birth_full_year) >= threshold
    // But precise logic is:
    // year_diff = current_y - birth_full_year
    // if (year_diff > threshold) return 1
    // if (year_diff < threshold) return 0
    // if (year_diff == threshold) check months...

    signal year_diff;
    year_diff <== current_y - birth_full_year;

    component gt_age = GreaterThan(8);
    gt_age.in[0] <== year_diff;
    gt_age.in[1] <== threshold;

    component eq_age = IsEqual();
    eq_age.in[0] <== year_diff;
    eq_age.in[1] <== threshold;

    // Check Months/Days if year_diff == threshold
    // We are older if (current_m > birth_m) OR (current_m == birth_m AND current_d >= birth_d)
    
    component gt_m = GreaterThan(8);
    gt_m.in[0] <== current_m;
    gt_m.in[1] <== birth_m;

    component eq_m = IsEqual();
    eq_m.in[0] <== current_m;
    eq_m.in[1] <== birth_m;

    component gte_d = GreaterEqThan(8);
    gte_d.in[0] <== current_d;
    gte_d.in[1] <== birth_d;

    signal month_check_ok;
    month_check_ok <== gt_m.out + (eq_m.out * gte_d.out); // Logical ORish

    // Final Logic:
    // is_older = gt_age.out OR (eq_age.out AND month_check_ok)
    // Note: gt_age and eq_age are mutually exclusive.
    
    // We need to clamp values to 0/1 (boolean). 
    // In Circom, + acts as arithmetic addition.
    // If conditions are mutually exclusive, + is XOR/OR.
    
    signal is_older_intermediate;
    is_older_intermediate <== gt_age.out + (eq_age.out * month_check_ok);
    
    // Since month_check_ok could technically be > 1 if I messed up (it shouldn't be), let's be safe.
    // But here checks are boolean 0/1.
    is_older <== is_older_intermediate;
}

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

    // Public Input: Current Date for Age Verification
    signal input current_date[3]; // [YYYY, MM, DD]
    signal input age_threshold;   // e.g. 18

    // Output: 1 if older than threshold, 0 otherwise
    signal output is_older_than_threshold;


    // --- 1. Verify SHA-256 Hash of MRZ ---
    component sha256 = Sha256(704);
    for (var i = 0; i < 704; i++) {
        sha256.in[i] <== mrz_bits[i];
    }

    for (var i = 0; i < 256; i++) {
        mrz_hash[i] === sha256.out[i];
    }

    // --- 2. Extract Birth Date (YYMMDD) ---
    // In TD3 MRZ, Birth Date starts at line 2, char 14 (index 57 in 0-indexed flat string)
    // 44 chars per line. Line 2 starts at index 44.
    // Index 44 + 13 = 57.
    // Length: 6 chars (48 bits).
    
    var birth_offset = 57 * 8; 
    
    // Helper to convert 8 bits (ascii) to digit
    // ASCII '0' = 48 (00110000). '9' = 57.
    // We subtract 48 to get value.
    // Since inputs are bits, we use Bits2Num(8) then subtract 48.
    
    // We need 6 digits: Y1 Y2 M1 M2 D1 D2
    signal birth_digits[6];
    component b2n[6];

    for(var k=0; k<6; k++) {
        b2n[k] = Bits2Num(8);
        for(var j=0; j<8; j++) {
            // Little-endian input for Bits2Num? No, usually Big-endian (index 0 is MSB) or Little?
            // Circomlib Bits2Num input is little-endian array?
            // "in[0] is the least significant bit"
            // Our mrz_bits comes from "bufferToBitArray" in JS which usually pushes MSB first?
            // Let's check JS: "bits.push((buf[i] >> j) & 1);" where j goes 7..0.
            // So mrz_bits[i*8 + 0] is bit 7 (MSB).
            // mrz_bits[i*8 + 7] is bit 0 (LSB).
            
            // Bits2Num expects in[0] as LSB.
            // So we need to reverse the mapping.
            b2n[k].in[7-j] <== mrz_bits[birth_offset + k*8 + j];
        }
        birth_digits[k] <== b2n[k].out - 48; // Convert ASCII to Digit
    }

    // Reconstruct YY, MM, DD
    signal birth_y;
    signal birth_m;
    signal birth_d;

    birth_y <== birth_digits[0] * 10 + birth_digits[1];
    birth_m <== birth_digits[2] * 10 + birth_digits[3];
    birth_d <== birth_digits[4] * 10 + birth_digits[5];

    // --- 3. Verify Age ---
    component ageVerifier = AgeVerifier();
    ageVerifier.birth_y <== birth_y;
    ageVerifier.birth_m <== birth_m;
    ageVerifier.birth_d <== birth_d;
    
    ageVerifier.current_y <== current_date[0];
    ageVerifier.current_m <== current_date[1];
    ageVerifier.current_d <== current_date[2];
    ageVerifier.threshold <== age_threshold;

    is_older_than_threshold <== ageVerifier.is_older;
}

component main {public [mrz_hash, current_date, age_threshold]} = PassportVerifier();
