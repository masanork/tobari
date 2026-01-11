# Tobari Action Board

**Last Updated:** 2026-01-10  
**Scope:** Tobari全体（MCP/Signer/SCAC/Compliance/civ）

## Now (今月)
- [ ] **MCP ↔ Tobari Signer（Tauri/FIDO）結合の完了**
  - [ ] `packages/mcp-server/src/tools/tobari.ts` の外部署名フローを実機で動作確認
  - [ ] `packages/signer` のCLI引数/出力JSONの仕様を明文化
  - [ ] macOS/Windowsでのビルド導線と`TOBARI_SIGNER_PATH`導入手順を整備
- [ ] **WASM/パフォーマンス最適化の調査計画**
  - [ ] RSA署名検証（Passport/JPKI）とZKP生成のボトルネック測定
  - [ ] マルチスレッド/ハードウェア支援の利用可否を整理
- [ ] **FATF/SCAC運用マッピングの整理**
  - [ ] VASP向けの識別/検証/リスク評価とVP構成要素の対応表を作成
  - [ ] Travel Rule連携の最小インタフェース草案
- [ ] **署名方式の確定（実装に反映）**
  - [ ] Issuer署名はP-384、Device bindingはP-256を標準とする
  - [ ] Experimental: PQCハイブリッド署名（選択式）はIssuerから開始
  - [ ] Device bindingのPQC拡充はPQC対応FIDOデバイスが出てから検討
  - [ ] PQCはCOSE Countersignで添付（ECDSA P-384はそのまま）
- [ ] PQCアルゴリズムはML-DSA-65でPoC（COSE alg -49 / cryptosuite ml-dsa-65-jcs-2025）
  - [ ] PoC実装タスク化（Issuer Countersign）
  - [ ] `tobari-gen`でIssuerAuthにCountersignを付与
  - [ ] `validator`でCountersign検証を行い結果を分離表示
  - [ ] `verify_presentation`の結果にPQC検証ステータスを追加

## Next (1-2ヶ月)
- [ ] **BBS+ unlinkable credentialのproof生成パイプライン**
  - [ ] WASMインタフェース課題の洗い出しと修正方針
  - [ ] サンプルVPを生成し、プレゼンテーション検証まで通す
- [ ] **snarkjs本番パイプライン**
  - [ ] `passport.circom`へRSA/ECDSA検証回路を統合
  - [ ] 実パスポートデータで検証テストを確立
- [ ] **civ: card-specific errorの明示化**
  - [ ] `IncorrectPin` / `CardLocked` / `NotAuthenticated` などを`CivError`に追加
- [ ] **civ: Rustdoc標準化**
  - [ ] 公開APIのドキュメント整備と例の追加

## Later (2026)
- [ ] **KMS/HSM連携の鍵管理設計**
  - [ ] クラウドKMS/オンプレHSMの両対応設計
- [ ] **mDoc失効レジストリ（Status List 2021）**
- [ ] **Mobile SDK（Flutter/Kotlin）**
- [ ] **OID4VCI/OID4VP実装**
- [ ] **civ: FFI/クロスランゲージ**
  - [ ] `uniffi-rs`によるKotlin/Swiftバインディング検討
- [ ] **civ: SM(AES/3DES)の共通化**
- [ ] **PQC/Extended Length APDUの検証**
