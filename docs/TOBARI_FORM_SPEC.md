# Tobari Form Specification (Web/A v2)

This document outlines the specification for the next generation of Web/A Forms, designed to be native to the Tobari ecosystem. It moves away from the legacy Markdown/HTML-parsing approach to a Schema-Driven, CBOR-native architecture.

## 1. Design Philosophy

-   **Schema-First**: Define the *data structure* first, not the UI. The UI is derived from the schema.
-   **CBOR Native**: The canonical data format is CBOR. Forms produce CBOR objects signed with COSE (RFC 9052).
-   **No "Magic" Parsing**: Avoid complex regex parsing of text (Markdown). Use structured definitions (YAML/JSON/CDDL).
-   **Minimal Runtime**: The runtime engine should be small, handling only rendering, validation, and signing.

## 2. Form Definition Schema

Forms are defined using a structured format (YAML/JSON) that maps easily to CDDL.

### Example Definition (YAML)

```yaml
meta:
  title: "Identity Verification"
  version: "2.0"
  security: "high" # Enforces PQC/L2

fields:
  - key: full_name
    type: text
    label: Full Name
    required: true
    autocomplete: name

  - key: age
    type: integer
    label: Age
    min: 18
    max: 150

  - key: evidence
    type: group
    label: Evidence
    fields:
      - key: type
        type: select
        options: 
          - [driver_license, "Driver License"]
          - [passport, "Passport"]
      - key: number
        type: text
        label: Document Number

output:
  format: cose_sign1
  alg: ES256
```

### Mapping to CDDL

This YAML definition implies a CDDL structure for the output payload:

```cddl
IdentityVerification = {
  full_name: tstr,
  age: 18..150,
  evidence: {
    type: "driver_license" / "passport",
    number: tstr
  }
}
```

## 3. Architecture

### 3.1. Compilation (Build Time)
Instead of compiling to HTML string literals:
1.  **Input**: Form Definition (YAML/CDDL)
2.  **Process**: 
    -   Validate Schema.
    -   Generate `schema.json` (canonical runtime definition).
    -   (Optional) Generate TypeScript types for the output.
3.  **Output**: A minimal HTML shell that loads the **Form Engine** and injects `schema.json`.

### 3.2. Runtime (Browser)
The `packages/form-engine` (new package) replaces `form-runtime`.
-   **Loader**: Reads `schema.json`.
-   **Renderer**: Dynamically creates DOM elements based on schema types.
    -   `text` -> `<input type="text">`
    -   `integer` -> `<input type="number" step="1">`
-   **Binder**: Maintains a reactive state object (Signal/Store).
-   **Signer**:
    1.  Serialize state to CBOR.
    2.  Sign using `packages/crypto` (WebCrypto/WASM).
    3.  Output `.cbor` file (not HTML).

## 4. Migration Guide (Legacy Markdown to Schema)

AI agents can automate the migration of existing `srn` Markdown forms to this new schema.

| Markdown Pattern | Tobari Schema (YAML) |
| :--- | :--- |
| `- [text:name (required)] Name` | `{ key: "name", type: "text", label: "Name", required: true }` |
| `- [number:age (min=0)] Age` | `{ key: "age", type: "integer", label: "Age", min: 0 }` |
| `[dynamic table:items]` | `{ key: "items", type: "array", items: { type: "object", fields: [...] } }` |
| `- [calc:sum (formula:a+b)]` | `{ key: "sum", type: "computed", formula: "a + b" }` |

## 5. Key Improvements over v1

1.  **Size**: No parser logic in the browser. No complex Markdown regex in the compiler.
2.  **Validation**: Schema definitions (min, max, pattern) are strictly enforced by the schema engine, not ad-hoc DOM checks.
3.  **Security**: Inputs are typed. CBOR prevents many text-based injection attacks.

## 6. Implementation Roadmap

1.  **Design**: Finalize the YAML Schema specification.
2.  **Engine**: Create `@tobari/form-engine` (React or Vanilla JS) to render YAML schema.
3.  **Converter**: Write a script (or prompt) to convert `srn` MD to Tobari YAML.
