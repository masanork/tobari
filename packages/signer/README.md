# Tobari Signer

Tobari Signer は、PCの内蔵認証器（Touch ID, Windows Hello など）やセキュリティキー（YubiKey）を利用して、Tobari ドキュメントに対する署名（Holder Binding）を行うためのデスクトップコンパニオンアプリです。

主に Tobari MCP Server から呼び出されて使用されますが、単独で起動してテストすることも可能です。

## 技術スタック

- **Frontend**: React + TypeScript + Vite
- **Backend**: Rust (Tauri v2)
- **WebAuthn**: `authenticator` crate

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

## 開発モード

ホットリロード対応の開発モードで起動するには：

```bash
bun run tauri dev
```

## CLI インターフェース

このアプリは引数として署名リクエストを受け付けます。

```bash
./tobari-signer --request '{"challenge":"...","rp_id":"tobari-mcp","message":"Sign this"}'
```

署名に成功すると、標準出力に以下の JSON を出力して終了します：

```json
{
  "credential_id": "...",
  "authenticator_data": "...",
  "signature": "...",
  "user_handle": "..."
}
```

拒否された場合やエラー時は非ゼロの終了コードで終了します。