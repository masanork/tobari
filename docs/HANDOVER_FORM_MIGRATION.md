# Handover Report: Web/A Form Migration & Engine Development

**Date:** 2026-01-14
**Author:** Antigravity (Assistant)

## 1. Executive Summary

This sprint focused on migrating the Web/A Form runtime functionalities from `srn` to the `tobari` monorepo.
Two parallel paths were established:
1.  **v1 (Legacy Support)**: A direct port of the Markdown-to-HTML architecture to support existing assets.
2.  **v2 (Next-Gen)**: A newly designed, schema-driven, lightweight engine (`form-engine`) native to Tobari's philosophy (Lit/Zod/CBOR).

## 2. Deliverables

### Path A: v1 Legacy Runtime (Usage: Existing Markdown Forms)

*   **`@tobari/compiler`**:
    *   Parses Markdown forms into HTML structure + JSON metadata.
    *   Supports `text`, `number`, `radio`, `calc`, `dynamic table` syntax.
    *   **Status**: Fully tested (`bun test packages/compiler` passes).
*   **`@tobari/form-runtime`**:
    *   Client-side library injected into generated HTML.
    *   Handles data binding, calculation, validation, and signing.
    *   **Status**: logic fully migrated and tested. PQC support is currently omitted (uses WebCrypto P-256).
*   **`@tobari/cli` (`md2form`)**:
    *   CLI tool to convert `.md` -> `.html` (standalone).
    *   Command: `bun run packages/cli/src/md2form.ts <input.md> -o <output.html>`

### Path B: v2 Form Engine (Usage: Future Standard)

*   **`docs/TOBARI_FORM_SPEC.md`**:
    *   Specification for the new Schema-Driven architecture.
*   **`@tobari/form-engine`**:
    *   **Tech Stack**: Lit (Web Components), Zod (Schema Validation), CBOR (Data Format).
    *   **Features**: Dynamic rendering from JSON schema, reactive updates, nested group support.
    *   **Demo**: Open `packages/form-engine/index.html` (after `bun run build`) to see the prototype.
    *   **Status**: Core engine implemented. 180KB bundle (unminified). Schema validation tests pass.

## 3. Architecture Comparison

| Feature | v1 (Legacy) | v2 (Next-Gen) |
| :--- | :--- | :--- |
| **Source** | Markdown (Unstructured Text) | JSON/YAML/CDDL Schema (Typed) |
| **Parsing** | Regex-heavy Parser (Server-side) | Zod Schema Validation (Client-side) |
| **UI** | HTML String Injection | Reactive Web Components (Lit) |
| **Output** | JSON-LD | CBOR / COSE |
| **Complexity** | High (DOM manipulation, Regex) | Low (Declarative, Type-safe) |
| **Size** | Large (Parser + Runtime) | Minimal (Engine only) |

## 4. Pending Tasks & Next Steps

### Immediate (Next Sprint)
1.  **v2 UI Refinement**:
    *   Implement Arrays/Dynamic Lists (currently only static `group` supported).
    *   Add better styling and validation error messages to `<tobari-form>`.
2.  **Migration Tool**:
    *   Develop a script (or AI prompt) to convert existing `srn` Markdown files into v2 JSON Schemas.

### Long Term
1.  **PQC Integration**:
    *   Re-introduce PQ/Hybrid interactions (Kyber/Dilithium) to `form-engine` using `@tobari/crypto` WASM.
2.  **Verifiable Credentials**:
    *   Ensure v2 Output (CBOR) is fully compliant with W3C VC data model or mdoc (ISO 18013-5) standards.

## 5. Development Guide

### Running Tests
```bash
# v1 Compiler
bun test packages/compiler

# v1 Runtime
bun test packages/form-runtime

# v2 Engine
bun test packages/form-engine
```

### Building v2 Engine
```bash
cd packages/form-engine
bun run build
# Open index.html to verify
```
