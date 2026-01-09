# JAOPP 暗号資産アカウント保有証明書 (SCAC) 仕様書案

**Version:** 0.3.0 (Draft)
**Target:** Prototype for JAOPP (Japan Open Privacy Platform)
**Standard:** ISO/IEC 18013-5 (mDoc)
**Document Name:** Self-Hosted Crypto Account Ownership Credential (SCAC)

## 1. 概要 (Overview)

本仕様は、個人の実在性（Identity）と、自己管理型（Self-Hosted / Unhosted）の暗号資産アカウント（Crypto Asset Accounts）の保有事実を紐付けた、検証可能なデジタル証明書（Verifiable Credential / mDoc）のデータモデルを定義する。

**特徴:**
単一のアカウントだけでなく、Ethereum, Solana, Bitcoin など異なるチェーン上の複数のアカウントを「ポートフォリオ」として一つの証明書に含めることができる。

### 1.1 目的
*   **Multi-Chain DeFi:** ユーザーは一度のKYCで、複数のチェーン上のプロトコルに対して「人間であること」を証明できる。
*   **Travel Rule (FATF):** VASPに対して、自身が保有する複数の送金元/送金先アドレスを一括して登録・証明する。

### 1.2 用語定義
*   **Self-Hosted Wallet (Unhosted Wallet):** VASP等の第三者に管理されず、ユーザー自身が秘密鍵を管理するウォレット。
*   **Account Portfolio:** 同一の主体（Identity）によって管理される、異なるブロックチェーン上のアカウントの集合。

---

## 2. ドキュメント定義 (Document Type)

*   **DocType:** `io.github.masanork.tobari.crypto_account_cert`

---

## 3. 名前空間とデータ要素 (Data Model)

### 3.1 名前空間: `io.github.masanork.tobari.crypto_account`

アカウントポートフォリオ情報。

| Data Element Identifier | Type | Mandatory | Description |
| :--- | :--- | :--- | :--- |
| `accounts` | array | **Yes** | 保有アカウントのリスト (下記 `AccountEntry` 参照) |
| `verification_level` | tstr | Yes | 本人確認の強度 (IAL) |
| `issuance_date` | tdate | Yes | 発行日時 |
| `expiry_date` | tdate | Yes | 有効期限 |
| `kyc_provider_id` | tstr | No | KYC実施事業者ID |

**AccountEntry Structure (Map/JSON Object):**

| Key | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `chain` | tstr | チェーンの通称 | "Ethereum", "Solana" |
| `chain_id` | tstr | CAIP-2 準拠のチェーンID | `eip155:1`, `solana:5eykt...` |
| `address` | tstr | アドレス | `0x1234...`, `HN7c...` |
| `binding` | tstr | 署名検証方式 | `secp256k1_signature` |

### 3.2 名前空間: `io.github.masanork.tobari.person`

元となる身分証から抽出・検証された個人情報。
*注: パスポート番号やマイナンバーなどの識別子は、プライバシー保護およびトラッキング防止の観点から本証明書には含めない。*

| Data Element Identifier | Type | Mandatory | Description | Source Mapping |
| :--- | :--- | :--- | :--- | :--- |
| `family_name` | tstr | Yes | 姓 | Passport DG1 / JPKI 4情報 |
| `given_name` | tstr | Yes | 名 | Passport DG1 / JPKI 4情報 |
| `birth_date` | full-date | Yes | 生年月日 | Passport DG1 / JPKI 4情報 |
| `nationality` | tstr | No | 国籍 (ISO 3166-1 alpha-2) | Passport (JP) / JPKI (JP) |
| `document_type` | tstr | Yes | 原自身分証の種類 | `passport`, `jpki` |

---

## 4. 発行フロー (Issuance Flow)

1.  **ポートフォリオ接続:**
    *   ユーザーは Wallet Connect 等を利用して、所有するすべてのアカウント（Eth, Sol等）で順次署名を行う。
    *   Issuer は各署名を検証し、リストを作成する。

2.  **身分証読み取り:**
    *   パスポート/JPKI 等で本人確認を行う。

3.  **発行:**
    *   確認されたアカウントリスト (`accounts` 配列) と本人情報を結合し、mDoc を発行する。

---

## 5. CDDL スキーマ

```cddl
crypto_account_cert = {
    "io.github.masanork.tobari.crypto_account" => {
        "accounts" => [+ AccountEntry],
        "verification_level" => tstr,
        ...
    },
    "io.github.masanork.tobari.person" => {
        "family_name" => tstr,
        "given_name" => tstr,
        "birth_date" => full-date,
        ? "nationality" => tstr,
        "document_type" => "passport" / "jpki"
    }
}

AccountEntry = {
    "chain" => tstr,
    "chain_id" => tstr,
    "address" => tstr,
    "binding" => tstr
}
```