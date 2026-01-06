# Tobari MCP Server

Tobari MCP (Model Context Protocol) Server は、AI エージェントがデジタル証明書（Tobari ドキュメント）を直接読み取り、検証し、さらにはプライバシーを保護した形での提示（Verifiable Presentation）を作成できるようにするためのインターフェースです。

このサーバーを導入することで、AI は「ユーザーの住民票から氏名と住所だけを抜き出して、署名付きの提出データを生成する」といった高度なタスクを自律的に実行できるようになります。

## インストールと設定

### 1. Claude Desktop の設定

Claude Desktop で Tobari MCP Server を使用するには、設定ファイル（`claude_desktop_config.json`）を編集します。設定ファイルの場所は OS によって異なります。

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

ファイルを開き（存在しない場合は作成し）、以下の設定を追加します。**注意: `bun` のパスおよび `/path/to/tobari` は、あなたの環境の実際の絶対パスに置き換えてください。**

`bun` の絶対パスはターミナルで `which bun` を実行することで確認できます。

```json
{
  "mcpServers": {
    "tobari": {
      "command": "/Users/YOUR_USERNAME/.bun/bin/bun",
      "args": [
        "run",
        "/path/to/tobari/packages/mcp-server/src/index.ts"
      ],
      "env": {
        "TOBARI_SIGNER_PATH": "/path/to/tobari/packages/signer/src-tauri/target/release/tobari-signer"
      }
    }
  }
}
```

> **Note:** `TOBARI_SIGNER_PATH` は、外部 WebAuthn Signer アプリの場所を指定する環境変数です。指定しない場合、MCP サーバーはデフォルトのビルド出力パス（`packages/signer/src-tauri/target/release/tobari-signer`）を自動的に探索します。

### 2. 接続の確認

1. Claude Desktop を完全に終了し、再起動します。
2. チャット入力欄の右下に **ハンマーのアイコン（Tools）** が表示されていることを確認します。
3. アイコンをクリックし、`read_tobari_file` や `analyze_service_request` などのツールがリストに含まれていれば成功です。

## 利用可能なツール

### 1. `read_tobari_file`
Tobari ファイル（.cose または .html）を読み込み、中身を JSON 形式で返します。公開鍵が指定された場合は Issuer（発行者）の署名検証も行います。

- **引数**:
  - `path`: Tobari ファイルへの絶対パス
  - `issuerPublicKeyPath` (任意): 発行者の公開鍵 (JWK) へのパス

### 2. `create_presentation`
複数の Tobari ドキュメントから特定のフィールドのみを抽出し、ホルダーのデバイス鍵で署名した Verifiable Presentation (VP) を作成します。

**WebAuthn / FIDO 連携**:
`devicePrivateKeyPath` が省略された場合、MCP サーバーは自動的に GUI コンパニオンアプリ（Tobari Signer）を起動します。デスクトップ画面上にダイアログが表示され、ユーザーは Touch ID や YubiKey などの FIDO 認証器を使って署名を行うことができます。

- **引数**:
  - `requests`: `[{ path, fields: ["field1", "field2"] }]` の配列
  - `devicePrivateKeyPath` (任意): ホルダーの秘密鍵 (JWK) へのパス。**省略時は Tobari Signer アプリが起動します。**
  - `verifierNonce` (任意): 検証者から指定されたワンタイムトークン

### 3. `prepare_presentation` (外部署名 / Passkey 用)
署名プロセスを 2 ステップに分けるための最初のステップです。署名対象のバイナリ（Sig_structure）を生成します。

- **引数**: `requests`, `verifierNonce`
- **任意**: `webauthn`
  - `rpId`: WebAuthn の Relying Party ID
  - `userVerification`: `required | preferred | discouraged`
  - `allowCredentials`: `[{ idBase64Url, type: "public-key" }]`

### 4. `assemble_presentation` (外部署名 / Passkey 用)
外部（ブラウザの Passkey など）で生成された署名を受け取り、最終的な VP を組み立てます。

- **引数**:
  - `preparedData`: `prepare_presentation` の戻り値
  - `signatures`: Base64 エンコードされた署名の配列
  - `signatureFormat` (任意): `der` (default) / `raw-ecdsa`
  - `signatureEncoding` (任意): `base64` (default) / `base64url`

### 5. `verify_presentation`
受け取った VP の真正性を検証します。Issuer 署名と Device 署名（Holder Binding）の両方をチェックします。

- **引数**:
  - `vpBase64`: Base64 エンコードされた VP データ
  - `issuerPublicKeys`: `{"docType": "/path/to/pubkey.json"}` 形式のマップ

### 6. `analyze_service_request`
行政サービス案内ドキュメント（Administrative Request）を解析し、申請に必要な証明書やユーザー入力をリストアップします。これにより、AI はユーザーに対して「何が足りないか」を具体的に提示できるようになります。

- **引数**:
  - `path`: サービス案内ドキュメント（.cose または .html）への絶対パス

### 7. `list_available_documents`
プロジェクト内の `examples/` ディレクトリや指定されたディレクトリをスキャンし、利用可能な Tobari ドキュメントや行政サービス案内をリストアップします。AI はこのツールを使って、ユーザーにファイルパスを尋ねることなく自らドキュメントを発見できます。

- **引数**:
  - `rootPath` (任意): スキャンを開始するディレクトリ。デフォルトはプロジェクトの examples ディレクトリ。

## デモファイルの試しかた

Tobari リポジトリには、すぐに試せるデモファイルが含まれています。AI に対して、まずドキュメントのリストアップを依頼してください。

1. **ドキュメントの発見**:
   > 「手元にある書類や案内をリストアップして」
   AI は `list_available_documents` を使い、発見したファイル（住民票やサービス案内）を提示します。

2. **自律的な解析**:
   > 「それらの中から、私に役立ちそうな手続きを探して」
   AI は発見した「行政サービス案内」を `analyze_service_request` で解析し、必要な書類が揃っているかを判断します。