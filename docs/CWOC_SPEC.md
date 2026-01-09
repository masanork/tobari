# JAOPP 暗号資産アカウント保有証明書 (SCAC) 仕様書

**Version:** 0.5.0 (Draft)
**Target:** Prototype for JAOPP (Japan Open Privacy Platform)
**Standard:** ISO/IEC 18013-5 (mDoc)
**Document Name:** Self-Hosted Crypto Account Ownership Credential (SCAC)

---

## 1. 概要 (Overview)

本仕様は、個人の実在性（Identity）と、自己管理型（Self-Hosted / Unhosted）の暗号資産アカウントの保有事実を紐付けた、プライバシー保護型のデジタル証明書（Verifiable Credential）のモデルを定義します。

### 1.1 背景と目的
暗号資産の規制（Travel Rule等）やDeFi（分散型金融）のコンプライアンス要件により、「ウォレットの持ち主が実在する人間であること」の証明が求められています。しかし、パスポート番号やマイナンバーなどの個人識別子を提出することは、トラッキング（追跡）や情報漏洩のリスクを伴います。

本仕様では **ゼロ知識証明 (ZKP)** 技術を採用することで、**「パスポート番号などの重要情報は一切明かさずに、本人確認済みである事実と必要な属性（氏名・年齢等）だけを証明する」** ことを可能にします。

---

## 2. プライバシー保護とゼロ知識証明 (Privacy & ZKP)

本証明書の核心は、パスポートデータを直接証明書に載せるのではなく、**「ZKP回路 (Circuit) によって生成された検証データ (Proof)」** を載せる点にあります。

### 2.1 従来の証明 vs ZKPによる証明

| 特徴 | 従来の本人確認 (Raw Data) | 本仕様のアプローチ (ZKP) |
| :--- | :--- | :--- |
| **提出データ** | パスポートのMRZ（番号含む）、顔画像、政府署名データ | **計算結果の証明書 (Proof) のみ** |
| **検証者の視点** | 「パスポート番号 AB12345... のデータを検証しました」 | 「**番号は知らないが**、有効なパスポートを持っていることは数学的に確認しました」 |
| **リスク** | データ流出時にパスポート番号が漏れる | **証明書から元のパスポート番号を復元することは不可能** |

### 2.2 ZKP回路のロジック (Circuit Logic)

今回試作した回路 (`passport.circom`) は、以下のロジックで動作します。

#### 入力データ (Inputs)
*   **🔒 Private Input (秘密):** パスポートの **MRZ (機械読取領域) 全データ**
    *   ここにはパスポート番号、氏名、生年月日、有効期限などが含まれています。
    *   **このデータは回路の外部には絶対に出力されません。**
*   **📢 Public Input (公開):** 
    *   **MRZハッシュ値**: パスポートデータの指紋（改ざんされていないことの確認用）。
    *   **クレーム（主張する属性）**: 「私は1980年1月1日生まれです」などの属性値。

#### 回路内部の処理 (Constraints)
回路はブラックボックスの中で以下の照合を行います：

1.  **ハッシュ検証**: 秘密入力されたMRZから SHA-256 ハッシュを計算し、公開されているハッシュ値と一致するか確認します。（これにより、入力されたデータがデタラメでないことを保証します）
2.  **データ抽出と照合**: 秘密入力されたMRZの特定の位置（例えば2行目の14文字目から6文字）を切り出し、それが公開入力された「生年月日」と完全に一致するか確認します。

#### 出力 (Output)
*   すべてが一致した場合のみ、**「Proof (証明)」** が生成されます。
*   不一致があれば、Proofは生成されません（または検証に失敗するProofになります）。

---

## 3. ドキュメント定義 (Document Type)

*   **DocType:** `io.github.masanork.tobari.crypto_account_cert`

---

## 4. 名前空間とデータ要素 (Data Model)

### 4.1 アカウント情報 (`...crypto_account`)

| Identifier | Type | Description |
| :--- | :--- | :--- |
| `accounts` | array | 保有アカウントのリスト（Ethereum, Solana等） |
| `verification_level` | tstr | 本人確認強度 (例: "ial3") |
| `issuance_date` | tdate | 発行日時 |
| `expiry_date` | tdate | 有効期限 |

### 4.2 本人情報と証明 (`...person`)

| Identifier | Type | Mandatory | Description |
| :--- | :--- | :--- | :--- |
| `family_name` | tstr | Yes | 姓 (Public Inputとして使用) |
| `given_name` | tstr | Yes | 名 (Public Inputとして使用) |
| `birth_date` | full-date | Yes | 生年月日 (Public Inputとして使用) |
| `nationality` | tstr | No | 国籍 |
| `document_type` | tstr | Yes | `passport` / `jpki` |
| `identity_proof_type` | tstr | **Yes** | 証明方式 (例: `zkp_passport_integrity_v1`) |
| `identity_proof` | bstr | **Yes** | **ZKP Proof データ** (snarkjs等で生成されたバイナリ) |

※ `passport_number` などのフィールドは存在しません。代わりに `identity_proof` がその正当性を裏付けます。

---

## 5. 発行・検証フロー (Technical Flow)

1.  **ID読み取り (Client Side)**
    *   ユーザーのスマホでパスポートのICチップを読み取る。
    *   MRZデータ（秘密）を取得する。

2.  **Proof生成 (Client Side / Secure Enclave)**
    *   MRZデータと、公開したい属性（生年月日など）を ZKP回路 (`passport.circom`) に入力する。
    *   回路が計算を行い、`identity_proof` を生成する。
    *   MRZデータ自体はこの時点で破棄してよい（Proofさえあればよい）。

3.  **証明書発行 (Issuer Side)**
    *   Issuerは送られてきた `identity_proof` を検証する。
    *   検証に成功すれば、「このユーザーは有効なパスポートを持っており、申告した生年月日は正しい」と認定し、自身の署名をつけて mDoc を発行する。

4.  **提示・検証 (Verifier Side)**
    *   Verifier（Dappや取引所）は mDoc を受け取る。
    *   Issuerの署名を確認し、さらに念を入れる場合は `identity_proof` を再検証する。
    *   パスポート番号を知ることなく、ユーザーが本人確認済みであることを確認できる。

---

## 6. 付録: CDDLスキーマ

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
        "identity_proof_type" => tstr,
        "identity_proof" => bstr, ; The ZKP Proof
        ...
    }
}

AccountEntry = {
    "chain" => tstr,
    "chain_id" => tstr,
    "address" => tstr,
    "binding" => tstr
}
```