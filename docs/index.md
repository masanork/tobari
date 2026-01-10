---
layout: home

hero:
  name: "Tobari (帳)"
  text: "Trust Infrastructure Toolkit"
  tagline: Designing trust in the agentic era. Connecting people, data, and silos.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/masanork/tobari

features:
  - title: 📄 Hybrid Document
    details: Combines the trust of static documents (PDF/Paper) with machine-readable verifyability (P-384 Signatures).
  - title: 🛡️ Selective Disclosure
    details: Share only what allows, keeping sensitive data private using SD-CBOR and BBS+ signatures.
  - title: 🤖 AI Agent Ready
    details: Native MCP Server support allowing AI agents to understand and verify documents autonomously.
---

## Documentation

### 📚 Core Concepts
- [Architecture Overview](ARCHITECTURE.md)
- [Schema Specification](SCHEMA_SPEC.md)
- [Holder Binding Design](HOLDER_BINDING.md)
- [Encryption & User Consent Policy](ENCRYPTION_STRATEGY.md)
- [Long-Term Validation (LTV)](LONG_TERM_VALIDATION.md)

### 🛠 Tools & Integrations
- [CLI Tools](CLI_TOOLS.md)
- [MCP Server (AI Integration)](MCP_SERVER.md)
- [Service Request Tutorial](SERVICE_REQUEST_TUTORIAL.md)

### 🪪 Civ (Identity Verification Library)
- [Identity Scheme Analysis](civ/IDENTITY_SCHEME_ANALYSIS.md)
- [JPKI (Japanese My Number Card)](civ/jpki.md)
- [ePassport (ICAO 9303)](civ/icao9303.md)
- [MyKad (Malaysian ID)](civ/mykad.md)
- [Thai ID Card](civ/thai.md)