# CLI Tools

Tobari は、開発や運用のための強力なコマンドラインツールを提供しています。

## 概要

| コマンド | パッケージ | 説明 |
| :--- | :--- | :--- |
| `present:cli` | `codec` | 選択的開示(SD)と署名(Device Auth)を行い VP を作成 |
| `verify:cli` | `codec` | Tobari ドキュメントまたは VP の検証 |
| `tobari-gen` | `codec` | スキーマとデータから Tobari ファイルを生成 |

## 使い方詳細

### 1. 提示データの作成 (`present:cli`)

原本（Issuer Signed）から、必要な項目だけを抽出して署名します。

```bash
bun run present:cli <source.cose> <output.cose> [options]
```

**主なオプション:**
- `--fields`: 開示するフィールド ID（カンマ区切り）。指定しない場合は全開示。
- `--device-key`: ホルダーの秘密鍵 (JWK)。指定しない場合は一時的な鍵を生成。
- `--nonce`: リプレイ攻撃防止用の値。
- `--audience`: 検証者の識別子。

### 2. 検証 (`verify:cli`)

原本または提示データの真正性を検証します。

```bash
bun run verify:cli <target.cose> [issuer_pubkey.json]
```

- 公開鍵が指定された場合、Issuer の署名を検証します。
- ドキュメントに Device 署名が含まれる場合、Holder Binding の検証も自動的に行われます。

### 3. ビューアの生成 (`bundle-viewer`)

.cose ファイルを内包した、自己検証機能付きの HTML ファイルを生成します。

```bash
bun run packages/codec/src/bundle-viewer.ts <source.cose>
```

---

## 開発用スクリプト

`scripts/build_examples.ts` を実行することで、`examples/` 以下のすべてのデモデータを一括生成し、それぞれに対応する HTML ビューアをビルドできます。

```bash
bun run scripts/build_examples.ts
```
