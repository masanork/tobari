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

## Tools Reference

The server exposes two categories of tools: **Core Tools** for handling credentials, and **Demo Tools** for development and simulation.

### Core Tools (Business Logic)
| Tool Name | Description |
| :--- | :--- |
| `read_tobari_file` | Reads and parses a Tobari file (.cose/.html). Verifies issuer signatures if a key is provided. |
| `create_presentation` | Creates a selective disclosure VP (Verifiable Presentation) from a document. |
| `preview_presentation` | Decodes and summarizes a VP. Optional signature verification. |
| `verify_presentation` | Verifies a VP, checking both Issuer and Device (Holder) signatures. Supports PQC. |
| `analyze_service_request` | Analyzes a Service Request file to understand what credentials are required. |
| `sign_with_jpki` | Signs data using a physical My Number Card (macOS/Windows/Linux). |
| `read_mynumber` | Reads My Number from a physical card. |
| `read_photo` | Reads the face photo from a physical card. |

### Development & Demo Tools
These tools are prefixed with `demo_` and are intended for testing, prototyping, and simulating ecosystem actors.

| Tool Name | Description |
| :--- | :--- |
| `demo_list_examples` | Lists sample documents and keys available in the project's `examples/` directory. |
| `demo_generate_example` | Runs generation scripts (e.g., `gen-tobari.ts`) to create fresh sample data. Supports `--pqc` and `--encrypt`. |
| `demo_start_server` | Starts a local web server (port 22081) to simulate an administrative submission portal. |

### Encrypted Documents
For encrypted Tobari files (including hybrid HPKE + PQC), pass a `decrypt` object to the relevant tools (`read_tobari_file`, `create_presentation`, `prepare_presentation`, `analyze_service_request`, `demo_list_examples`, `generate_passport_zkp_input`).

```json
{
  "name": "read_tobari_file",
  "arguments": {
    "path": "/absolute/path/to/encrypted.cose",
    "decrypt": {
      "hpkeSecret": "tobari-demo-secret-key-32-bytes-long!!",
      "hpkeInfo": "tobari-storage-v1",
      "pqcPrivateKeyPath": "/absolute/path/to/recipient-pqc-private-key.json"
    }
  }
}
```

Defaults fall back to `TOBARI_HPKE_SECRET`, `TOBARI_HPKE_INFO`, and `TOBARI_PQC_PRIVATE_KEY_PATH` (or demo values if unset).

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
You can ask the Agent to do this using `demo_generate_example`:
```json
{
  "name": "demo_generate_example",
  "arguments": {
    "exampleName": "juminhyo",
    "pqc": true
  }
}
```
(Or manually run: `bun examples/juminhyo/gen-tobari.ts --pqc`)

This creates:
- `examples/juminhyo/juminhyo.cose`
- `examples/juminhyo/issuer-pqc-public-key.json`

### 2) Create a presentation (VP)
Use `create_presentation` or your normal flow to generate a VP from `juminhyo.cose`.

Note: `create_presentation` supports `signerPath` (override signer binary path) and `fallbackToEphemeral` (use a temporary key if signer is unavailable).

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

## Quick VP Preview

Use `preview_presentation` to inspect the VP without running a demo server:
```json
{
  "name": "preview_presentation",
  "arguments": {
    "vpBase64": "<base64-vp>"
  }
}
```

If you want to verify signatures at the same time, pass `issuerPublicKeys` (and optional `issuerPqcPublicKeys`).
