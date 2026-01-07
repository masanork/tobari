# Myna Card Implementation Insights

## Overview
This document captures key insights gained during the refactoring of the Myna Card (Individual Number Card) implementation, specifically regarding face photo retrieval. It highlights the discrepancy between intuitive assumptions about security levels and the actual system design, serving as a lesson for future development.

## The Trap of "Visual AP" vs. "Input Assistance AP"

### The Misconception (Original Implementation)
The initial implementation attempted to retrieve the face photo using a complex logic involving a "B-Number".
- **Logic:** Generate a key based on [Date of Birth + Expiration Date + Security Code] -> Access "Visual Application (AP)".
- **Context:** This mechanism is designed for physical scenarios (e.g., bank counters) where an OCR device reads the card face to "unlock" the digital photo, verifying that the physical card matches the chip.
- **Problem:** In a pure software environment (card reader), the **Security Code** is often not digitally readable (or requires circular logic to fetch). Trying to emulate this OCR-based auth purely via software led to complex, fragile code that often failed.

### The Solution (Input Assistance AP)
The refactored implementation uses the "Card Surface Input Assistance AP" (`Card-AP`).
- **Logic:** Verify the standard **4-digit User Authentication PIN** -> Read File `00 02`.
- **Insight:** Despite the sensitivity of a face photo, the system groups it with basic information (Name, Address) under the same 4-digit PIN protection level.
- **Result:** Drastically simplified flow. No need for B-Number generation or proprietary authentication schemes.

## Why Reverse Engineering Alone Would Fail

Reaching this "simple" solution via blind fuzzing or reverse engineering without documentation is nearly impossible due to:

1.  **AID Complexity:** The entry point (`D3 92 10 00 31 00 01 01 04 08`) is a specific 16-byte sequence that cannot be brute-forced.
2.  **Silent Failures:** Without PIN verification, the card returns generic "Security Status Not Satisfied" errors (`69 82`). It does not list available files, effectively hiding `00 02` (Photo) from discovery.
3.  **Counter-Intuitive Security:** A developer's natural instinct is that "Face Photo" requires higher security than "Address". The system design contradicts this, placing them in the same bucket. Without the specification clarifying this (`docs/mynacard.ja.md`), one would continue digging into the more complex "Visual AP" route, assuming the "easy path" simply doesn't exist.

## Conclusion
The correct implementation was not about cracking a complex cryptographic puzzle, but rather **knowing which door is unlocked by the standard key**. This emphasizes the critical value of domain-specific specifications (like J-LIS guidelines or detailed OSS analysis) over raw technical probing in government ID systems.
