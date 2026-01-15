# Tobari Data Storage Specification

This document defines the standard directory structure and storage locations for identity documents, user data, and history in the Tobari ecosystem. Adhering to this specification ensures seamless interoperability between the native Signers (macOS/Tauri), the MCP Server, and CLI tools.

## 1. Base Directory (`TOBARI_HOME`)

The root directory for all Tobari-related data is determined by the `TOBARI_HOME` environment variable. If not set, the following platform-specific defaults are used:

- **macOS**: `~/Documents/Tobari`
- **Linux**: `~/.tobari`
- **Windows**: `%USERPROFILE%\Documents\Tobari`

## 2. Directory Structure

Inside `TOBARI_HOME`, data is organized into the following sub-directories:

```text
$TOBARI_HOME/
├── credentials/          # Issued identity documents (Encrypted mdocs)
│   └── *.cose, *.html
├── requests/             # Service requests and form templates
│   └── *.html, *.json
├── data/                 # User input data and profile drafts
│   └── profiles/         # Auto-fill profile information
├── history/              # Presentation history and interaction logs
│   └── *.json
└── config/               # Application settings and trust anchors
    └── settings.json
```

## 3. Directory Roles and Logic

### 3.1 `credentials/`
- **Purpose**: Primary "Wallet" storage for digital identities.
- **Usage**: Tools like `issue_identity_document` and `issue_local_credential` save generated `.cose` files here by default.
- **Behavior**: Native Signers scan this directory to populate the "My Cards" or "Wallet" view.

### 3.2 `requests/`
- **Purpose**: Storage for administrative service requests (Form definitions).
- **Usage**: When a user downloads or receives a request for a service (e.g., Child Allowance application), it is placed here for analysis by the MCP server.

### 3.3 `data/`
- **Purpose**: Persistent storage for user-provided information.
- **Sub-directory `profiles/`**: Contains common attributes (Name, Address, etc.) used to auto-fill service requests. This data is local-only and managed by the Signer.

### 3.4 `history/`
- **Purpose**: Audit log of identity presentations.
- **Format**: JSON logs containing timestamp, Verifier ID, disclosed fields, and the document used.
- **Privacy**: No sensitive identity values are stored here; only metadata and references to which fields were disclosed.

### 3.5 `config/`
- **Purpose**: Application-level configuration.
- **Content**: Trust lists (CSCA certificates), preferred hardware key settings, and UI preferences.

## 4. Implementation Guidelines

1. **Auto-creation**: Native applications and MCP servers should attempt to create this structure (`mkdir -p`) upon first run if it does not exist.
2. **Environment Variable**: All tools MUST respect the `TOBARI_HOME` environment variable if present.
3. **Path Resolution**: Tools should provide a way to resolve paths relative to `TOBARI_HOME` (e.g., `@credentials/my-passport.cose`).
