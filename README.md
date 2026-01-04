# Tobari (帳)

Tobari is a modular, schema-driven infrastructure for secure data entry and management.
Born from the need to decouple the "Web/A Form" logic from the monolithic SRN codebase, Tobari focuses on modularity, strict boundaries, and a "Headless" runtime architecture.

## Core Philosophy

*   **Modular by Default**: Every component is designed as an independent package.
*   **Schema Driven**: Forms are defined by pure JSON/YAML schemas, not hardcoded UI logic.
*   **Secure & Private**: Designed with future Layer 2 Encryption (L2E) integration in mind ("Tobari" implies privacy/curtain).

## Project Structure (Planned)

The project is organized as a monorepo.

*   `packages/core`: Pure logic for schema validation and state management.
*   `packages/runtime`: Headless runtime engine for the browser.
*   `packages/cli`: Tools for generating static forms.
*   `apps/maker`: GUI application for authoring forms.

## License

MIT
