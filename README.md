# Tobari (帳)

Tobari は、既存の「人間向けドキュメント」の体験を維持したまま、強力な真正性と機械可読性を付与するデジタル証明書フレームワークです。

PDF や紙の書類が持つ「完成された様式」への信頼感と、現代のエンジニアリングが必要とする「プログラムによる自動検証・解析」を、単一の自己完結型 HTML ファイルで両立させます。

## Core Philosophy

- **静かな浸透**: 利用者は「綺麗な Web 明細」を受け取る感覚で、裏側にある P-384 ECDSA 署名や高度な暗号技術を意識する必要はありません。
- **検証者ファースト**: 文書を受け取る事業者（銀行、行政、サービスプロバイダ）が、数秒でその真正性を確認でき、かつ生のデータをシステムに取り込める「実務上の使い勝手」を最優先します。
- **自己完結とポータビリティ**: 外部サーバーや特定のプラットフォームに依存せず、1枚の HTML ファイルの中に「フォント」「データ」「デザイン」「ロジック」を凝縮します。

## Key Features

1. **SD-CBOR / Selective Disclosure**: 
   署名の整合性を保ったまま、特定の項目（マイナンバー、生年月日など）を物理的に消去して提出可能。ハッシュ化とソルトを用いた高度な秘匿性を実現。
2. **Embedded Layout (デジタル定礎)**:
   HTML のレイアウト構造そのものも署名対象のバイナリに内包。デザインの改ざんやバッジの偽造を防ぎます。
3. **P-384 / ES384 Signature**:
   最新の推奨アルゴリズムである P-384 (ECDSA) を標準採用し、長期に渡る真正性を担保。
4. **Font Subsetting & IVS Support**:
   住民票などで不可欠な異体字（IVS）に対応。使用されている文字のみを抽出したフォントを内蔵し、環境に依存しない完璧な描画を 70KB 程度のファイルサイズで提供。

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
