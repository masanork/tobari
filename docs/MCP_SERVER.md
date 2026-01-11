# Tobari MCP Server

The Tobari MCP (Model Context Protocol) Server is an interface that allows AI agents to directly read and verify digital credentials (Tobari documents), and create privacy-preserving Verifiable Presentations.

By introducing this server, AI agents gain the autonomous capability to perform high-level tasks, such as "Extracting only the name and address from a user's residence certificate to generate signed submission data."

## Why AI needs Tobari?

Large Language Models (LLMs) are excellent at processing text, but they cannot inherently "trust" or "verify" the authenticity of data they receive from a user.
- **Authenticity**: Agents can verify that a document was actually signed by a specific authority.
- **Privacy**: Agents can minimize data leakage by only sharing specific fields required for a task (Selective Disclosure).
- **Structure**: Documents are machine-readable (CBOR/JSON), removing the ambiguity of free-text parsing.

## Features

- **Document Inspection**: Allow AI to view the structure and content of a signed Tobari document.
- **Signature Verification**: Tools for the AI to check if the document integrity is maintained.
- **Presentation Creation**: Instruct the AI to generate a sub-credential (Verifiable Presentation) containing only necessary fields.

## Getting Started

### Installation
```bash
npm install -g @tobari/mcp-server
```

### Configuration (Claude Desktop)
Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tobari": {
      "command": "tobari-mcp",
      "args": ["--key-dir", "/path/to/keys"]
    }
  }
}
```

## Security

The MCP server never shares the user's private keys or full raw documents with the AI unless explicitly allowed. It operates based on the "Minimality Principle," ensuring that AI agents act only within the scope of delegated trust.

## PQC Countersign Demo (verify_presentation)

This demo shows how to attach an ML-DSA-65 countersignature on the issuer side and verify it via `verify_presentation`.

### 1) Generate a PQC-signed credential
```bash
bun examples/juminhyo/gen-tobari.ts --pqc
```

This creates:
- `examples/juminhyo/juminhyo.cose`
- `examples/juminhyo/issuer-pqc-public-key.json`

### 2) Create a presentation (VP)
Use `create_presentation` or your normal flow to generate a VP from `juminhyo.cose`.

### 3) Verify with PQC public key
Pass `issuerPqcPublicKeys` alongside classic issuer keys:
```json
{
  "vpBase64": "<base64-vp>",
  "issuerPublicKeys": {
    "jp.v0.juminhyo": "/absolute/path/to/examples/juminhyo/issuer-key.json"
  },
  "issuerPqcPublicKeys": {
    "jp.v0.juminhyo": "/absolute/path/to/examples/juminhyo/issuer-pqc-public-key.json"
  }
}
```

The response includes `issuerPqcPresent` and `issuerPqcValid` for each document.
