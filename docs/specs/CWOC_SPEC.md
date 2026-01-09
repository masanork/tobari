# JAOPP 暗号資産アカウント保有証明書 (SCAC) 仕様書案

**Version:** 0.4.0 (Draft)
**Target:** Prototype for JAOPP (Japan Open Privacy Platform)
**Standard:** ISO/IEC 18013-5 (mDoc)
**Document Name:** Self-Hosted Crypto Account Ownership Credential (SCAC)

## 1. 概要 (Overview)

本仕様は、個人の実在性（Identity）と、自己管理型（Self-Hosted / Unhosted）の暗号資産アカウント（Crypto Asset Accounts）の保有事実を紐付けた、検証可能なデジタル証明書（Verifiable Credential / mDoc）のデータモデルを定義する。

### 1.1 目的 & プライバシー設計
*   **Travel Rule / DeFi KYC:** アカウント所有者が実在する人間であることを証明する。
*   **プライバシー保護:** パスポート番号やマイナンバー等の「永続的な識別子」は**含めない**。
*   **暗号的立証 (Cryptographic Proof):** 識別子を含めずに真正性を担保するため、**ゼロ知識証明 (ZKP)** を用いて「政府署名付きデータ (SOD) の保有」と「属性の一致」のみを証明するアプローチを採用する。

### 1.2 用語定義
*   **Account Portfolio:** 同一の主体によって管理される、異なるブロックチェーン上のアカウント群。
*   **ZKP (Zero-Knowledge Proof):** 秘密情報（パスポート番号等）を明かさずに、その正当性だけを証明する技術。

---

## 2. ドキュメント定義 (Document Type)

*   **DocType:** `io.github.masanork.tobari.crypto_account_cert`

---

## 3. 名前空間とデータ要素 (Data Model)

### 3.1 名前空間: `io.github.masanork.tobari.crypto_account`

アカウントポートフォリオ情報。

| Data Element Identifier | Type | Mandatory | Description |
| :--- | :--- | :--- | :--- |
| `accounts` | array | **Yes** | 保有アカウントのリスト |
| `verification_level` | tstr | Yes | 本人確認の強度 (IAL) |
| `issuance_date` | tdate | Yes | 発行日時 |
| `expiry_date` | tdate | Yes | 有効期限 |
| `kyc_provider_id` | tstr | No | KYC実施事業者ID |

### 3.2 名前空間: `io.github.masanork.tobari.person`

本人確認情報および真正性証明。

| Data Element Identifier | Type | Mandatory | Description | Source Mapping |
| :--- | :--- | :--- | :--- | :--- |
| `family_name` | tstr | Yes | 姓 | Passport / JPKI |
| `given_name` | tstr | Yes | 名 | Passport / JPKI |
| `birth_date` | full-date | Yes | 生年月日 | Passport / JPKI |
| `nationality` | tstr | No | 国籍 | Passport / JPKI |
| `document_type` | tstr | Yes | 原自身分証の種類 | `passport`, `jpki` |
| `identity_proof_type` | tstr | **Yes** | 真正性証明の方式 | `zkp_sod_verification_v1` |
| `identity_proof` | bstr | **Yes** | 真正性証明データ (ZKP Proof) | zk-SNARK Proof bytes |

**Identity Proof の役割:**
このフィールドは、Issuerが「適当な情報を入力した」のではなく、「実際に有効な政府署名データ（SOD）を確認した」ことを、パスポート番号を明かすことなく検証者に保証するために用いる。
*   **Public Input:** `Hash(family_name + given_name + birth_date)`
*   **Private Input:** パスポートの `EF.SOD` (政府署名), `EF.DG1` (MRZ)
*   **Circuit Logic:** `Verify(SOD) == True` AND `DG1.Name == family_name...`

---

## 4. 発行フロー (Issuance Flow)

1.  **ポートフォリオ接続:** Wallet Connect 等で署名検証。
2.  **身分証読み取り & ZKP生成:**
    *   パスポートの `EF.SOD` と `EF.DG1` を読み取る。
    *   クライアント（またはセキュアなIssuer環境）で ZKP Proof を生成する。
3.  **発行:**
    *   Issuer は生成された `identity_proof` を検証し、mDoc に格納して署名する。

---

## 5. CDDL スキーマ

```cddl
crypto_account_cert = {
    "io.github.masanork.tobari.crypto_account" => { ... },
    "io.github.masanork.tobari.person" => {
        "family_name" => tstr,
        "given_name" => tstr,
        "birth_date" => full-date,
        ? "nationality" => tstr,
        "document_type" => "passport" / "jpki",
        "identity_proof_type" => tstr,
        "identity_proof" => bstr
    }
}
```
