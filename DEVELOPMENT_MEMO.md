# Tobari 開発引継メモ: MCPサーバー構造化と暗号化方式の統一

## 1. 現在のステータス（完了済み）

### A. MCPサーバーの構造化 (Refactoring)
*   **レジストリ・パターンの導入**: `src/index.ts` の巨大な switch 文を廃止し、`src/mcp-tool.ts` による登録制に移行。
*   **ツール分離**: ツールを `tools/tobari.ts`, `tools/jpki.ts` 等に分割。
*   **スキーマ自動変換**: `zod-to-json-schema` を導入し、Zod定義からMCP用JSON Schemaを自動生成。

### B. 暗号化方式の統一 (Standardization)
*   **HPKEからECIESへ**: 標準HPKE（RFC 9180）ではなく、Swift (CryptoKit) との親和性が高い **Custom ECIES** (P-256 ECDH + HKDF + AES-GCM) に統一。
*   **TS実装**: `packages/crypto/src/tobari-ecies.ts` に実装済み。
*   **名前空間の修正**: mdocの名前空間を `schema.id` に動的に合わせるように修正。

### C. セキュリティ向上
*   **セキュアPIN入力**: PINが引数で渡されない場合、`signer-macos` がネイティブのセキュア入力ダイアログを表示する機能を `UnifiedCLIHandler.swift` に実装。

---

## 2. 現在の課題とブロック事項 (Known Issues)

### 課題1: ECIES復号時の "Data too short" エラー
*   **現象**: TSで暗号化したデータを `signer-macos` に渡すと、復号時に `Data too short` というエラーが返る。
*   **詳細**: `SecureEnclaveEncryption.swift` 内の `AES.GCM.open` またはその手前のデータ構築で失敗している。
*   **推測原因**:
    1.  **Base64URLのパディング**: Swiftの `Data(base64Encoded:)` とTS側の `base64url` で、パディング（`=`）の有無によるデコード失敗。
    2.  **JSONデコード**: `AnyCodable` を経由した際に、入れ子になった構造体のパースに失敗している（`The data couldn’t be read because it is missing.` エラー）。
    3.  **バイナリの一貫性**: `Makefile` の `make release` でビルドした CLI バイナリが、期待した最新のコードを反映していない可能性がある。

### 課題2: テスト環境での対話制限
*   **現象**: `signer_integration.test.ts` が、実際の Secure Enclave へのアクセス（Touch ID）を求めるため、非対話環境で `authenticationFailed (error 3)` になる。
*   **対策案**: テスト時は Software Key (Secure Enclave ではない) を使うフラグを設けるか、プロンプトをスキップするモックが必要。

### 課題3: stdout へのログ漏洩
*   **現象**: `console.log` 等が MCP の JSON-RPC 出力（stdout）に混ざり、クライアントが JSON をパースできなくなる。
*   **対応**: 多くの `console.log` は `console.error` に変えたが、ライブラリ深部からの出力がまだ残っている可能性がある。

---

## 3. 次にやるべきこと (Next Steps)

1.  **Swift側の Base64URL デコーダーの確実な実装**:
    *   `UnifiedCLIHandler.swift` にある `Data(base64URLEncoded:)` 拡張を `SecureEnclaveEncryption.swift` でも確実に使い、パディング処理を修正する。
2.  **暗号化データのキー名の再確認**:
    *   `ciphertext` vs `data` の不一致がないか、TS (`EncryptedMessage`) と Swift (`EncryptedComponents`) の両方の構造体定義を再点検する。
3.  **デバッグログの出力先固定**:
    *   `signer-macos` の全ての `print` を `fputs(..., stderr)` に変え、stdout を完全にクリーンに保つ。
4.  **運転免許証・マイナンバーのインポート機能の完成**:
    *   復号が通るようになったら、`import_driver_license` ツールを使って、実際のカードデータを暗号化 mdoc として保存・閲覧できるか確認する。

---

## 4. 主要ファイル
*   `packages/crypto/src/tobari-ecies.ts`: TS側の暗号化核心
*   `packages/signer-macos/Sources/SecureEnclaveEncryption.swift`: Swift側の復号核心
*   `packages/mcp-server/src/utils.ts`: TS/Swift間の橋渡しロジック
*   `packages/mcp-server/src/mcp-tool.ts`: 新しいツール登録基盤
