# JAOPP 暗号資産アカウント保有証明書 (SCAC) 仕様書案

**Version:** 0.1.1 (Draft)
**Target:** Prototype for JAOPP (Japan Open Privacy Platform)
**Standard:** ISO/IEC 18013-5 (mDoc)
**Document Name:** Self-Hosted Crypto Account Ownership Credential (SCAC)

## 1. 概要 (Overview)

本仕様は、個人の実在性（Identity）と、自己管理型（Self-Hosted / Unhosted）の暗号資産アカウント（Crypto Asset Account）の保有事実を紐付けた、検証可能なデジタル証明書（Verifiable Credential / mDoc）のデータモデルを定義する。

### 1.1 目的
*   **Travel Rule (FATF) 対応:** VASP（暗号資産交換業者）間の送金において、**"Unhosted Wallet" (非ホスト型ウォレット)** への送金時に求められる本人確認情報をセキュアかつプライバシーを保護した状態で伝達する。
*   **DeFi KYC:** 分散型金融プロトコルにおいて、オンチェーン上の **"Account"** が実在する、かつ制裁対象でない個人によって管理されていることを証明する。
*   **P2P 取引の信頼性向上:** 個人間取引において、相手のアドレスが認証済みIDに紐付いていることを確認する。

### 1.2 用語定義
*   **Self-Hosted Wallet (Unhosted Wallet):** VASP等の第三者に管理されず、ユーザー自身が秘密鍵（Private Key）を管理するソフトウェアやハードウェア。
*   **Crypto Account:** ブロックチェーン上で資産を保有・送受信するためのアドレスや公開鍵。CAIP-10における "Account ID" に相当する。

### 1.3 前提となる身分証
本プロトタイプでは、以下の公的個人認証手段を「信頼の起点 (Root of Trust)」とする。
1.  **日本国パスポート (ePassport):** ICAO 9303 準拠。BAC/PACE による認証と DG1 (MRZ) 情報。
2.  **マイナンバーカード (JPKI):** 公的個人認証サービスによる電子署名。

---

## 2. ドキュメント定義 (Document Type)

mDoc におけるドキュメントタイプ識別子は、本プロジェクトの GitHub リポジトリ名前空間を使用する。

*   **DocType:** `io.github.masanork.tobari.crypto_account_cert`

---

## 3. 名前空間とデータ要素 (Data Model)

データは以下の名前空間（NameSpace）に格納される。

### 3.1 名前空間: `io.github.masanork.tobari.crypto_account`

暗号資産アカウント（Crypto Account）固有のデータ要素。

| Data Element Identifier | Type | Mandatory | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `account_address` | tstr | **Yes** | アカウントのアドレス（公開鍵ハッシュ等） | `0x1234...abcd` |
| `chain_namespace` | tstr | **Yes** | チェーン規格 (CAIP-2準拠) | `eip155` (ETH), `bip122` (BTC) |
| `chain_reference` | tstr | **Yes** | チェーンID (CAIP-2準拠) | `1` (Mainnet), `137` (Polygon) |
| `verification_level` | tstr | Yes | 本人確認の強度 (IAL/AAL) | `ial2`, `ial3` |
| `key_binding_method` | tstr | Yes | 秘密鍵の管理・署名検証方法 | `challenge_response_secp256k1` |
| `issuance_date` | tdate | Yes | 発行日時 | `2026-01-09T12:00:00Z` |
| `expiry_date` | tdate | Yes | 有効期限 | `2027-01-09T12:00:00Z` |
| `kyc_provider_id` | tstr | No | KYC実施事業者ID | `did:web:issuer.example.com` |

### 3.2 名前空間: `io.github.masanork.tobari.person`

元となる身分証から抽出・検証された個人情報。
*ユーザーは提示時に Selective Disclosure (選択的開示) により、これらの項目を隠すことができる。*

| Data Element Identifier | Type | Mandatory | Description | Source Mapping |
| :--- | :--- | :--- | :--- | :--- |
| `family_name` | tstr | Yes | 姓 | Passport DG1 / JPKI 4情報 |
| `given_name` | tstr | Yes | 名 | Passport DG1 / JPKI 4情報 |
| `birth_date` | full-date | Yes | 生年月日 | Passport DG1 / JPKI 4情報 |
| `nationality` | tstr | No | 国籍 (ISO 3166-1 alpha-2) | Passport (JP) / JPKI (JP) |
| `document_type` | tstr | Yes | 原自身分証の種類 | `passport`, `jpki` |
| `document_number_hash` | bstr | No | 旅券番号等のハッシュ値 (追跡防止のため生値は持たない) | SHA-256(Passport No + Salt) |

---

## 4. 発行フロー (Issuance Flow)

プロトタイプにおける発行プロセスは以下の通りとする。

1.  **アカウント保有証明 (Proof of Account Ownership):**
    *   ユーザーはモバイルアプリ (Tobari Wallet) で自身の Self-Hosted Wallet を接続する。
    *   サーバーから送られた「チャレンジ (Nonce)」に対し、Crypto Account の秘密鍵で署名する。
    *   署名検証により、ユーザーが該当アカウントの管理者 (Controller) であることを確認する。

2.  **身分証読み取り (Proof of Identity):**
    *   **パスポートの場合:**
        *   カメラで MRZ を撮影 (OCR)。
        *   NFC で ICチップをスキャン。BAC/PACE で認証し、DG1 (基本情報) と DG15/SOD (真正性) を読み取る。
        *   `Passive Authentication` により改ざんがないことを確認する。
    *   **マイナンバーカードの場合:**
        *   NFC で ICチップをスキャン。
        *   券面入力補助AP (4桁PIN) で 4情報を取得。
        *   署名用電子証明書 (6-16桁PIN) で「アカウントアドレスを含むデータ」に対して電子署名を行う (公的個人認証)。

3.  **データ結合と mDoc 発行:**
    *   Issuer (発行サーバー) は「アカウント署名」と「身分証データ(署名)」の両方が正しいことを確認する。
    *   確認できた情報に基づき、CBOR (MSO) を生成し、Issuer の秘密鍵で署名する (COSE_Sign1)。
    *   生成された mDoc をユーザーのアプリに送信する。

---

## 5. CDDL スキーマ定義 (Draft)

実装に使用する CBOR Data Definition Language (CDDL) の定義案。

```cddl
; Document Type
docType = "io.github.masanork.tobari.crypto_account_cert"

; Namespaces
CryptoAccountNamespace = "io.github.masanork.tobari.crypto_account"
PersonNamespace = "io.github.masanork.tobari.person"

; Data Elements within CryptoAccountNamespace
CryptoAccountData = {
  "account_address" : tstr,
  "chain_namespace" : tstr,          ; e.g. "eip155" (CAIP-2)
  "chain_reference" : tstr,          ; e.g. "1" (CAIP-2)
  "verification_level" : tstr,       ; "ial1", "ial2", "ial3"
  "key_binding_method" : tstr,       ; e.g. "challenge_response_secp256k1"
  "issuance_date" : tdate,
  "expiry_date" : tdate,
  ? "kyc_provider_id" : tstr
}

; Data Elements within PersonNamespace
PersonData = {
  "family_name" : tstr,
  "given_name" : tstr,
  "birth_date" : full-date,          ; RFC 3339 full-date string
  ? "nationality" : tstr,            ; ISO 3166-1 alpha-2
  "document_type" : "passport" / "jpki",
  ? "document_number_hash" : bstr
}

; Full mDoc Structure (Simplified ISO 18013-5)
Document = {
  "docType" : docType,
  "issuerSigned" : IssuerSigned,
  "deviceSigned" : DeviceSigned,
}
```

---

## 6. プロトタイプ実装計画

### Phase 1: データ構造の定義と生成 (civ/codec)
*   上記スキーマに基づく CBOR 生成ロジックを `packages/codec` に実装する。
*   ダミーの Issuer 鍵を用いて、署名付き mDoc (MSO) を生成できるようにする。

### Phase 2: 入力ソースの統合 (civ)
*   **Passport:** `PassportController` から取得した `CitizenIdentity` 構造体を、上記の `PersonData` にマッピングする変換アダプタを作成する。
*   **JPKI:** `JpkiController` から取得したデータを同様にマッピングする。

### Phase 3: アカウント署名の検証 (Verifier)
*   Ethereum (secp256k1) 等の署名検証ロジックを組み込み、アカウントの所有確認をシミュレートする。

---

### 補足: IdentityController とのマッピング

`civ` パッケージの `CitizenIdentity` 構造体と本仕様のマッピングは以下の通り。

| mDoc Element | CitizenIdentity Field | 備考 |
| :--- | :--- | :--- |
| `family_name` | `full_name` (Split) | JPKIは氏名が結合されているため分割が必要。PassportはMRZから分割可能。 |
| `given_name` | `full_name` (Split) | 同上 |
| `birth_date` | `birth_date` | フォーマット変換が必要 (YYYYMMDD -> YYYY-MM-DD) |
| `document_type` | `card_type` | 文字列正規化 |