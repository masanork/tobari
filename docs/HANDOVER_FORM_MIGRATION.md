# Handover Report: Web/A Form Migration & Engine Development

**Date:** 2026-01-14
**Author:** Antigravity (Assistant)

## 1. Executive Summary

This sprint focused on migrating the Web/A Form runtime functionalities from `srn` to the `tobari` monorepo.
Two parallel paths were established:
1.  **v1 (Legacy Support)**: A direct port of the Markdown-to-HTML architecture to support existing assets.
2.  **v2 (Next-Gen)**: A newly designed, schema-driven, lightweight engine (`form-engine`) native to Tobari's philosophy (Lit/Zod/CBOR).

**Status Update:** v2 Engine has been enhanced with Array support, Data Validation, and a Migration Tool. It is ready for wider adoption testing.

## 2. Deliverables

### Path A: v1 Legacy Runtime (Usage: Deprecated)

*   **`@tobari/compiler`**:
    *   Parses Markdown forms into HTML structure + JSON metadata.
    *   **Status**: Maintenance mode.
*   **`@tobari/form-runtime`**:
    *   Client-side library injected into generated HTML.
    *   **Status**: Maintenance mode.

### Path B: v2 Form Engine (Usage: Recommended)

*   **`docs/TOBARI_FORM_SPEC.md`**:
    *   Specification for the new Schema-Driven architecture.
*   **`@tobari/form-engine`**:
    *   **Tech Stack**: Lit (Web Components), Zod (Schema Validation), CBOR (Data Format).
    *   **Features**:
        *   Dynamic rendering from JSON schema.
        *   Text, Integer, Select, Group, and **Array** (Dynamic List) fields.
        *   **Real-time & Submit-time Validation** using Zod.
        *   Better styling and error reporting.
    *   **Status**: Feature Complete for MVP.
*   **Migration Tool**:
    *   `packages/form-engine/scripts/migrate.ts`: Converts v1 Markdown forms to v2 JSON Schema.
    *   Usage: `bun run packages/form-engine/scripts/migrate.ts <input.md>`

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

### Immediate
1.  **Full Migration**:
    *   Convert all existing example forms (in `examples/`) to v2 using the migration tool.
    *   Verify them in the v2 engine demo.
2.  **Deprecation**:
    *   Remove v1 packages (`packages/compiler`, `packages/form-runtime`, `packages/cli`) once migration is confirmed.

### Long Term
1.  **PQC Integration**:
    *   Re-introduce PQ/Hybrid interactions (Kyber/Dilithium) to `form-engine` using `@tobari/crypto` WASM.
2.  **Verifiable Credentials**:
    *   Ensure v2 Output (CBOR) is fully compliant with W3C VC data model or mdoc (ISO 18013-5) standards.

## 5. Development Guide

### Running Tests
```bash
# v2 Engine
bun test packages/form-engine
```

### Running Migration
```bash
bun run packages/form-engine/scripts/migrate.ts <path-to-markdown>
```

### Building v2 Engine
```bash
cd packages/form-engine
bun run build
# Open index.html to verify
```