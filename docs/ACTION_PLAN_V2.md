# Tobari Project: Action Plan v2.0

**Last Updated:** 2026-01-09
**Status:** Alpha / Proof of Concept

## 1. Current Achievements (v1.0 Milestones)

### ✅ Unified Identity Model (CIV)
*   **JPKI, JPDL, Passport** の読み取りを単一の `IdentityController` インターフェースで統一。
*   **Secure Messaging**: BAC (Passport), JPKI/JPDL の暗号通信を実装。
*   **Passive Authentication**: JPDL (Driver's License) の署名/ハッシュ検証を実装。

### ✅ SCAC (Self-Hosted Crypto Account Ownership Credential)
*   **Multi-Chain Support**: Ethereum, Solana 等のアカウントを一括証明するデータモデルを策定。
*   **Privacy-First Design**: パスポート番号等を削除し、ZKP (Zero-Knowledge Proof) による検証を前提とした設計に変更。
*   **mDoc Generation**: `cbor` / `cose` を用いた ISO 18013-5 準拠のモバイル証明書生成プロトタイプ。

### ✅ ZKP Foundation
*   **Passport Circuit**: Circom による MRZ ハッシュ検証回路の設計。
*   **BBS+ Signatures**: `crypto-wasm` を用いた署名生成・検証の実装（基本機能）。

---

## 2. Identified Issues & Technical Debt

### ✅ ZKP / WASM Integration (BBS+)
*   **Status**: Resolved. Found that `@mattrglobal/bbs-signatures` provides a stable WASM-based implementation. Also verified that `@docknetwork/crypto-wasm` works correctly when using the proper API arguments (handling `Set` and `Map` correctly).
*   **Recommendation**: Use `@mattrglobal/bbs-signatures` for new implementations due to its simpler API.

### ✅ Passport PACE Stability
*   **Status**: Resolved. Fixed PACE key exchange logic in `pace.rs` and mutual authentication token handling in `mock.rs` and `passport.rs`. Corrected Secure Messaging to include `SSC` in MAC calculation as per ICAO 9303. Verified with integrated mock tests.

### ⚠️ Performance
*   **Issue**: RSA署名検証（Passport/JPKI）や ZKP 生成は計算コストが高い。
*   **Action**: WebAssembly (WASM) ビルドの最適化、マルチスレッド化。

---

## 3. Roadmap & Next Steps

### Phase 3: Production Readiness (Q1 2026)

#### 3.1 ZKP Implementation Hardening
1.  **Resolve WASM Interface**: BBS+ 証明生成のエラーを解消し、完全に動作する Unlinkable Credential を実装する。
2.  **Circuit Optimization**: `passport.circom` に署名検証（RSA/ECDSA）回路を組み込み、実際の `snarkjs` で証明書を生成・検証するパイプラインを確立する。

#### 3.2 Trusted Issuer Infrastructure
1.  **Key Management**: デモ用のローカル鍵ではなく、KMS (AWS/GCP) や HSM と連携した鍵管理システムを設計。
2.  **Revocation Registry**: mDoc の失効状態（Status List）を管理するサーバーの実装。

#### 3.3 Wallet App Integration
1.  **Mobile App (Flutter/Kotlin)**: NFC読み取りからSCAC受け取りまでを行うモバイルアプリのプロトタイプ。
2.  **Wallet Connect**: 既存の Crypto Wallet と連携し、署名プロセスを統合。

### Phase 4: Compliance & Standardization (Q2 2026)

1.  **OpenID4VC Support**: OID4VCI (Issuance) / OID4VP (Presentation) プロトコルの実装。
2.  **J-LIS / Myna Integration**: 公的個人認証サービス（JPKI）の商用利用に向けたAPI適合性確認。

---

## 4. Immediate Tasks (Priority: High)

1.  **Fix ZKP Binding**: BBS+署名の証明生成エラーの修正（ライブラリ調査）。
2.  **Verify on Real Device**: 実機パスポートでの BAC 動作確認。
3.  **Refactor Mock**: `demo_mode` の完全排除と、Mock内での暗号処理の厳密化。
