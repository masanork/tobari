# Post-Quantum Cryptography (PQC) PoC Plan

## Objective
Evaluate the feasibility, performance, and data size overhead of **Hybrid Post-Quantum Cryptography** in the `civ` library.

## 1. Candidate Algorithms
Based on the current NIST selection:
- **KEM**: `ML-KEM-768` (formerly Kyber768)
- **Signature**: `ML-DSA-65` (formerly Dilithium3)
- **Hybrid Suite**: `X25519 + ML-KEM-768`

## 2. Technical Stack
- **Library**: `pqcrypto` crate (Rust) or `liboqs` bindings.
- **HPKE Integration**: Use an HPKE implementation that supports custom KEMs or implement a simple "Combined KEM" wrapper.

## 3. Evaluation Metrics

### A. Data Size (Payload Bloat)
Measure the total size of an encrypted credential:
| Suite | Public Key | Encapsulation (ct) | Signature | Total Overhead |
|-------|------------|---------------------|-----------|----------------|
| P-256 (Classical) | 65 B | ~32 B | 64 B | ~161 B |
| ML-KEM-768 | 1184 B | 1088 B | - | ~2272 B |
| Hybrid (P-256 + ML-KEM) | ~1250 B | ~1120 B | - | **~2.4 KB** |

### B. Performance
- Benchmarking in **WebAssembly (WASM)**: PQC algorithms are often CPU-intensive. We need to verify if the latency is acceptable for a mobile user experience.
- Memory usage during key generation.

## 4. Implementation Steps
1. Create a standalone Rust CLI tool to generate Hybrid Keys.
2. Encrypt/Decrypt a dummy credential using Hybrid HPKE.
3. Compare the resulting JSON/CBOR size with the P-256 version.
4. Document the "PQC bloat factor" to inform future hardware requirements.

## 5. Passkey / Hardware Integration Research
- Monitor Apple/Google/Microsoft announcements regarding PQC support in Secure Enclave and Passkeys (FIDO Alliance PQC Working Group).
- Draft a plan for "Hardware PQC" once devices become available.
