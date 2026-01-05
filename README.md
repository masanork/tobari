# Tobari (帳)

Tobari は、既存の「人間向けドキュメント」の体験を維持したまま、強力な真正性と機械可読性を付与するデジタル証明書フレームワークです。

PDF や紙の書類が持つ「完成された様式」への信頼感と、現代のエンジニアリングが必要とする「プログラムによる自動検証・解析」を、単一の自己完結型 HTML ファイルで両立させます。

## Core Philosophy

- **静かな浸透**: 利用者は「綺麗な Web ドキュメント」を受け取る感覚で、裏側にある P-384 署名や高度な暗号技術を意識する必要はありません。
- **データ・ファースト (Schema-driven)**: 特定の帳票レイアウトに縛られず、データの構造そのものに真正性を付与。Web/モバイルに最適化された閲覧ビューを自動生成します。
- **検証者ファースト**: 受取人が特別なソフトウェアなしに、データの真正性を検証でき、かつ生のデータをシステムに直接取り込める「実務上のポータビリティ」を最優先します。

## Key Features

1. **SD-CBOR / Selective Disclosure**: 
   署名の整合性を保ったまま、特定の項目（マイナンバー、生年月日など）を物理的に消去して提出可能。プライバシー保護と真正性の両立。
2. **Universal Viewer (スキーマ駆動)**:
   CDDL/YAML スキーマからレスポンシブなビューを自動構成。特定の帳票フォーマットへの依存を排除し、アクセシビリティと読みやすさを向上。
3. **P-384 / ES384 Signature**:
   最新の推奨アルゴリズムである P-384 (ECDSA) を標準採用し、長期に渡る真正性を担保。
4. **Font Subsetting & IVS Support**:
   住民票などで不可欠な異体字（IVS）に対応。IPA MJ明朝から必要なグリフのみを抽出して埋め込み、数十KBで完璧な描画を実現。

## Project Structure

- `packages/codec`: YAML スキーマからの CDDL 生成、署名済みバイナリ（.tobari）の生成、HTML ビューアのバンドル。
- `packages/crypto`: P-384 対応の COSE 署名・検証コア実装。
- `examples/juminhyo`: 住民票（世帯連記式）をモデルとした実装例。

## Quick Start (Demo Generation)

```bash
# 依存関係のインストール
bun install

# デモ・バリデーターの生成
bun run build

# 生成物の確認
# examples/juminhyo/juminhyo-verifiable.html -> 利用者向けビューア
# examples/verifier.html -> 事業者向け検証ツール
```

## How it Works

1. **Schema (YAML)**: フィールド定義と「どこを秘匿可能にするか（selective: true）」を定義します。
2. **Payload (CBOR)**: データをハッシュ化し、レイアウト定義と共に CBOR 形式でパッキング。
3. **Sign (COSE)**: 発行者の秘密鍵（P-384）で署名。
4. **Bundle (HTML)**: バイナリ、ビューアロジック、サブセットフォントを 1 つの HTML に集約。

---
Produced by the Tobari Project - *Building silent trust in every digital document.*
