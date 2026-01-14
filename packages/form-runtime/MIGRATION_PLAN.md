# Web/A Form Runtime Migration Plan

This document outlines the strategy for extracting the Web/A Form Runtime from `srn` and integrating it into `tobari` as `@tobari/form-runtime`.

## 1. Objective
To create a standalone, browser-compatible runtime library that powers the interactve features of Web/A Forms (calculation, validation, signing, encryption), removing dependencies on `srn`'s SSG infrastructure.

## 2. Scope analysis
The source code resides in `srn/src/form/client`. It consists of approximately 40 files (~4,000 LOC).

### Component Categorization

| Category | Complexity | Dependency Risk | Migration Strategy |
| :--- | :--- | :--- | :--- |
| **Logic** (`calculator.ts`, `data.ts`, `postal.ts`) | Low | Low | **Direct Copy**. These are mostly pure logic or DOM manipulation. Minor updates to imports needed. |
| **UI** (`ui.ts`, `validation-dialog.ts`, `search.ts`) | Medium | Low | **Direct Copy**. Heavily coupled to DOM structure (which the Compiler assumes), so they must move together. |
| **Crypto** (`signer.ts`, `l2crypto.ts`, `pqc.ts`) | High | **High** | **Refactor/Replace**. heavily relies on `@srn/core` and custom WASM. We should aim to replace these with `@tobari/crypto` equivalents where possible, or carefully port minimal logic. |
| **Vendor** (`src/vendor/*`) | Medium | Medium | **Evaluate**. Check if we can use NPM packages instead of vendored files (e.g., `@noble/curves`). |

## 3. Detailed Strategy by Module

### 3.1. Foundation (`index.ts`, `runtime.ts`)
- **Action**: Copy files.
- **Change**: Remove `window` global pollution where possible, or isolate it.
- **Dependency**: Uses `DataManager`, `UIManager`, `Calculator`.

### 3.2. Data Management (`data.ts`)
- **Action**: Copy file.
- **Change**: `signAndDownload` method uses `globalSigner`. This needs to be decoupled.
- **Refactor**: Inject `Signer` interface instead of importing singleton `globalSigner`.

### 3.3. Cryptography (`signer.ts`, `l2crypto.ts`)
- **Challenge**: `srn` uses a specific WASM build for `ml-kem`. `tobari` uses `crypto-wasm`.
- **Plan A (Ideal)**: Rewrite `signer.ts` to use `@tobari/crypto` and `@tobari/signer`.
- **Plan B (Pragmatic)**: Copy `srn`'s crypto logic temporarily, but fetch WASM from `tobari`'s build artifacts if compatible.
- **Decision**: **Try Plan A first**. Use `@tobari/crypto` for standard operations. If PQC/Hybrid encryption logic is too specific to `srn`'s L2 spec, port the logic but swap the primitives.

### 3.4. dependencies
We need to add the following to `packages/form-runtime/package.json`:
- `@tobari/compiler` (Workspace)
- `@tobari/crypto` (Workspace)
- `cbor-x` (Used for data encoding)
- `@noble/curves`, `@noble/hashes` (Likely needed for client-side keys)

## 4. Execution Steps

1.  **Scaffold**: Create `packages/form-runtime` structure (Done).
2.  **Logic Port**: Copy Logic & UI files first. verify they compile with dummy Crypto/Signer.
    - `calculator.ts`, `postal.ts`, `postal-group.ts`, `ui.ts`
3.  **Crypto Port**:
    - Import `@tobari/crypto`.
    - Create an adapter `Signer` class that implements `srn`'s signer interface but calls `tobari` logic.
4.  **Integration**:
    - Copy `main.ts` (or `index.ts`) and bundle it using `bun build`.
    - Create a small HTML test harness to verify the bundle runs in browser.

## 5. Token Conservation Strategy
- **Do not read all files at once**. Trust filenames for Logic/UI components.
- **Focus on `signer.ts`**. This is the only file that really needs deep inspection.
- **Incremental Build**. Get the "No-Crypto" form working first (Input, Calc, Validation). Then add Signing.

