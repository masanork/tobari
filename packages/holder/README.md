# Tobari Signer

Tobari Signer は、PCの内蔵認証器（Touch ID, Windows Hello など）やセキュリティキー（YubiKey）を利用して、Tobari ドキュメントに対する署名（Holder Binding）を行うためのデスクトップコンパニオンアプリです。

主に Tobari MCP Server から呼び出されて使用されますが、単独で起動してテストすることも可能です。

## 機能

- **WebAuthn (Passkey)**: PCの内蔵認証器（Touch ID, Windows Hello など）や YubiKey を利用した署名・登録。
- **JPKI (マイナンバーカード)**: マイナンバーカードの読み取り（氏名、住所、個人番号、顔写真）および JPKI による電子署名。
- **GUI & CLI**: GUI による直感的な操作に加え、MCP Server から呼び出し可能な CLI インターフェースを提供。

## 開発環境のセットアップ

```bash
cd packages/signer
bun install
```

## ビルド

リリースビルド（最適化済みバイナリ）を作成するには：

```bash
bun run tauri build
```

バイナリは `src-tauri/target/release/` に生成されます。
- macOS: `src-tauri/target/release/tobari-signer` (.app バンドル内)
- Windows: `src-tauri/target/release/tobari-signer.exe`

## CLI インターフェース

このアプリは引数として署名リクエストを受け付けます。成功すると結果を JSON で標準出力し、自動的に終了します。

```bash
./tobari-signer --request '{"challenge":"...","rp_id":"tobari-mcp","message":"Sign this"}'
```

### JPKI 署名の実行（CLI）

```bash
./tobari-signer --sign-jpki --pin 123456 --request '{"challenge":"..."}'
```

署名に成功すると、以下の統一された JSON 形式を出力します：

```json
{
  "signature": "...",
  "authData": "...",
  "clientDataJSON": "...",
  "publicKey": "..."
}
```
(注: `authData`, `clientDataJSON` は WebAuthn 時のみ、`publicKey` は JPKI 時などに含まれます)

拒否された場合やエラー時は非ゼロの終了コードで終了し、標準エラー出力に詳細を出力します。