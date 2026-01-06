# Tobari MCP Server

Tobari MCP (Model Context Protocol) Server は、AI エージェントがデジタル証明書（Tobari ドキュメント）を直接読み取り、検証し、さらにはプライバシーを保護した形での提示（Verifiable Presentation）を作成できるようにするためのインターフェースです。

このサーバーを導入することで、AI は「ユーザーの住民票から氏名と住所だけを抜き出して、署名付きの提出データを生成する」といった高度なタスクを自律的に実行できるようになります。

## インストールと設定

### Claude Desktop での使用例

`~/Library/Application Support/Claude/claude_desktop_config.json` に以下の設定を追加します。

```json
{
  "mcpServers": {
    "tobari": {
      "command": "bun",
      "args": [
        "run",
        "/path/to/tobari/packages/mcp-server/src/index.ts"
      ]
    }
  }
}
```

## 利用可能なツール

### 1. `read_tobari_file`
Tobari ファイル（.cose または .html）を読み込み、中身を JSON 形式で返します。公開鍵が指定された場合は Issuer（発行者）の署名検証も行います。

- **引数**:
  - `path`: Tobari ファイルへの絶対パス
  - `issuerPublicKeyPath` (任意): 発行者の公開鍵 (JWK) へのパス

### 2. `create_presentation`
複数の Tobari ドキュメントから特定のフィールドのみを抽出し、ホルダーのデバイス鍵で署名した Verifiable Presentation (VP) を作成します。

- **引数**:
  - `requests`: `[{ path, fields: ["field1", "field2"] }]` の配列
  - `devicePrivateKeyPath`: ホルダーの秘密鍵 (JWK) へのパス
  - `verifierNonce` (任意): 検証者から指定されたワンタイムトークン

### 3. `prepare_presentation` (外部署名 / Passkey 用)
署名プロセスを 2 ステップに分けるための最初のステップです。署名対象のバイナリ（Sig_structure）を生成します。

- **引数**: `requests`, `verifierNonce`

### 4. `assemble_presentation` (外部署名 / Passkey 用)
外部（ブラウザの Passkey など）で生成された署名を受け取り、最終的な VP を組み立てます。

- **引数**:
  - `preparedData`: `prepare_presentation` の戻り値
  - `signatures`: Base64 エンコードされた署名の配列

### 5. `verify_presentation`
受け取った VP の真正性を検証します。Issuer 署名と Device 署名（Holder Binding）の両方をチェックします。

- **引数**:
  - `vpBase64`: Base64 エンコードされた VP データ
  - `issuerPublicKeys`: `{"docType": "/path/to/pubkey.json"}` 形式のマップ

### 6. `analyze_service_request`
行政サービス案内ドキュメント（Administrative Request）を解析し、申請に必要な証明書やユーザー入力をリストアップします。これにより、AI はユーザーに対して「何が足りないか」を具体的に提示できるようになります。

- **引数**:
  - `path`: サービス案内ドキュメント（.cose または .html）への絶対パス

## ユースケース例

AI との対話で以下のような活用が可能です：

1. **内容の確認**: 「この住民票の内容を要約して」
2. **情報の抽出**: 「委任状の中から『委任事項』の部分だけを教えて」
3. **提出用データの作成**: 「この 2 つの書類から、審査に必要な項目だけを抜き出して、私の署名を付けて提出用データを作って」
