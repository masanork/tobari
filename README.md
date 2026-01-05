# Tobari (帳)

Tobari is a compact, machine-readable format for secure and verifiable documents, based on CBOR and COSE.

Born from the need to provide a digital alternative to PDFs, Tobari focuses on data integrity, authenticity, and extreme compactness while maintaining human readability through standard tools.

## Core Philosophy

*   **Compact & Efficient**: Built on CBOR for minimal binary size, suitable for QR codes or limited bandwidth.
*   **Verifiable by Default**: Built-in support for digital signatures (COSE) to ensure authenticity and integrity.
*   **Machine & Human Readable**: Structured data for automated processing, with a clear path to self-rendering/visual representation.
*   **Modular Architecture**: Independent packages for schema validation, binary encoding, and cryptographic operations.

## Project Structure

*   `packages/schema`: Data schema definitions and validation logic (Zod-based).
*   `packages/crypto`: CBOR/COSE implementation for signing and basic integrity.
*   `packages/codec`: (Planned) High-level generator/parser for Tobari files.

## Roadmap

1.  **Phase 1: Foundation**: Establish standardized CBOR/COSE signing formats.
2.  **Phase 2: Generator**: Build tools to convert structured input (JSON/YAML) into signed `.tobari` files.
3.  **Phase 3: Human-Readable Layer**: Implement lightweight viewers or self-contained HTML rendering for the binary data.

## License

MIT
