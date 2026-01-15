# Tobari Architecture

## 1. Vision
Tobari provides a modular, "Headless" foundation for schema-driven forms.
Its primary goal is **Decoupling**: separating the form logic (data entry, validation) from the business logic (encryption, signing, identity).

## 2. Boundaries & Responsibility

### Included in Tobari (Form Logic)
These components handle "Data Entry" and "Structure".
*   **Schema Definition**: JSON-based definition of fields, types, and constraints.
*   **Validation**: Pure logic to check input against the schema.
*   **State Management**: Handling user input, errors, dirty states.
*   **Runtime Rendering**: Mapping schema to DOM elements (Input, Select, etc.).

### Excluded from Tobari Core (External Concerns)
These features are critical for the final product (Web/A) but **must not** be tightly coupled with the form logic. They should be implemented as separate tools or post-build steps.
*   **Encryption (L2E)**: Transforming the output JSON into an encrypted blob.
*   **Signing**: Generating digital signatures for the data.
*   **Font Embedding**: Optimization for offline usage.

## 3. Package Structure (Draft)

We avoid a generic `core` package. Instead, we name packages by their specific domain.

### `packages/schema`
*   **Responsibility**: Defines the "Tobari Schema" specification.
*   **Contents**: TS Types, Zod schemas (or similar) for the definition file itself.
*   **Dependency**: None.

### `packages/engine` (or `runtime`)
*   **Responsibility**: The brain of the form running in the browser.
*   **Contents**: State machine, Event handlers, Validation runner.
*   **Dependency**: `packages/schema`.

### `packages/dom-adapter`
*   **Responsibility**: Renders the UI based on the Engine's state.
*   **Contents**: Web Components or Vanilla JS renderers.
*   **Dependency**: `packages/engine`.

### `packages/compiler` (CLI)
*   **Responsibility**: Bundles the Schema + Engine + Adapter into a single HTML file.
*   **Dependency**: All of the above.

## 4. Data & Storage
Tobari defines a standardized storage structure for identity documents, user profiles, and logs. This ensures that different components (Signers, MCP Server, CLI) can share a common "Wallet" context.
*   See [Data Storage Specification](./DATA_STORAGE.md) for details on `$TOBARI_HOME` and directory roles.

## 5. Technical Standards
*   **Monorepo**: Managed via Bun Workspaces.
*   **Language**: TypeScript (Strict mode).
*   **Testing**: Unit tests mandatory.
*   **Build**: `tsup` for libraries, `Vite` for apps.
