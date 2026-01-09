# **スイスAOPP（Address Ownership Proof Protocol）の包括的分析と日本版次世代Unhosted Wallet本人確認プロトコルの戦略的提言**

## **1\. 序論：規制の荒波と自己主権型アイデンティティの交錯点**

暗号資産（仮想通貨）のエコシステムにおいて、規制当局による監視の目と、分散型テクノロジーが志向するプライバシー保護の理念は、長らく対立関係にあると捉えられてきた。特に2019年、金融活動作業部会（FATF）が勧告16「トラベルルール」の適用範囲を暗号資産サービスプロバイダー（VASP）に拡大し、送金元・送金先の情報を共有することを義務付けた決定は、業界に大きな衝撃を与えた1。さらに、スイス金融市場監督機構（FINMA）をはじめとする一部の先進的な規制当局は、VASPと自己管理型ウォレット（Unhosted Wallet / Self-hosted Wallet）間の取引においても、そのウォレットの所有者が顧客本人であることを技術的に証明することを求めた3。

この規制要件に対する技術的回答としてスイスで開発されたのが、\*\*Address Ownership Proof Protocol（AOPP）\*\*である。AOPPは、ユーザー体験（UX）を損なうことなく、暗号学的署名を用いてウォレットの所有権を証明する革新的なプロトコルとして登場した。しかし、その実装過程で浮き彫りになったのは、プライバシー保護に対するコミュニティの根強い懸念と、技術仕様が内包するトレードオフの難しさであった5。

本レポートでは、スイスAOPPの技術的構造、実装状況、およびそれが直面した社会的課題を徹底的に分析する。その上で、日本の強力なデジタルインフラである「マイナンバーカード（JPKI）」および「ICパスポート」を活用し、AOPPの教訓を活かした次世代のUnhosted Wallet本人確認プロトコルを提言する。特に、Verifiable Credentials（VC）や分散型ID（DID）、ゼロ知識証明（ZK-Proof）といった最新のWeb3技術標準を統合することで、欧州のEUDI Wallet規則（eIDAS 2.0）など国際的な高水準に適合しつつ、ユーザーフレンドリーでプライバシーを侵害しない日本発の標準モデルの可能性を論じる。

## ---

**2\. スイスAOPP（Address Ownership Proof Protocol）の深層分析**

AOPPは、スイスのコンプライアンス企業21 Analytics、ハードウェアウォレットメーカーのShift Crypto（BitBox）、およびソフトウェアウォレットのBlueWalletなどが共同で策定したオープンソースのプロトコルである1。その目的は、FINMAガイダンス02/2019が求める「Unhosted Walletの所有権確認」を自動化することにあった3。

### **2.1 開発の背景：FINMAによる「スイス・フィニッシュ」**

スイスは「クリプトバレー」として知られる一方、マネーロンダリング対策（AML）においては国際基準よりも厳しい独自の解釈、いわゆる「スイス・フィニッシュ」を適用することで知られる。2019年のFINMAガイダンスは、VASPに対し、顧客が外部のUnhosted Walletへ送金（または受取）を行う際、そのウォレットが「顧客自身の管理下にあること」を確認する義務を課した2。

この要件を満たすための初期の手法は、極めて原始的かつユーザービリティの低いものであった。

* **スクリーンショット方式**: ユーザーがウォレットアプリの画面をキャプチャし、VASPにアップロードする。画像の偽造が容易であり、UXも劣悪である5。  
* **Satoshi Test（マイクロトランザクション）**: 顧客に特定の少額（Satoshi）を送金させ、その着金を確認する。オンチェーン手数料が発生し、時間もかかる上、プライバシー上のリンクがブロックチェーンに永続的に残る問題があった9。  
* **手動署名（Sign Message）**: ビットコインの機能である「メッセージ署名」を利用する。ユーザーはVASPから提示されたテキストをコピーし、ウォレットアプリの署名機能にペーストして署名し、その署名データをVASPに戻す。セキュリティ（クリップボードハイジャックのリスク）やUXの観点から課題が多かった1。

AOPPは、この「手動署名」のプロセスを、URIスキームを用いて自動化・標準化するために設計された。

### **2.2 AOPPの技術仕様とメカニズム**

AOPPの核心は、VASPとウォレットアプリ間の情報の受け渡しを定義したURIスキームと、コールバックによる署名提出フローにある。このプロトコルは、ユーザーが複雑な文字列を操作することなく、数回のクリックまたはタップで証明を完了させることを可能にした。

#### **2.2.1 AOPP URIスキームの構造**

AOPPは aopp: という独自のURIスキームを使用する。VASPは以下のようなパラメータを含むURI（またはQRコード）を生成し、ユーザーに提示する11。

URIフォーマット例:  
aopp:?v=0\&msg=SGVsbG8gV29ybGQ...\&asset=btc\&format=p2wpkh\&callback=https://vasp.com/api/callback

| パラメータ | 必須 | 説明 |
| :---- | :---- | :---- |
| v | Yes | プロトコルのバージョン番号。現在は 0 で固定。 |
| msg | Yes | 署名対象となるメッセージ。VASPが生成するチャレンジコードであり、リプレイ攻撃を防ぐためのNonceや、ユーザーを一意に識別するセッションIDが含まれることが推奨される。Base64等でエンコードされる場合が多い。 |
| asset | Yes | 対象となる暗号資産の識別子。SLIP-0044規格に準拠する（例：btc, eth）。 |
| format | Yes | VASPが期待するアドレス形式。ビットコインの場合、p2wpkh (Bech32), p2sh, p2pkh などを指定し、ウォレット側での誤った形式のアドレス選択を防ぐ。 |
| callback | Yes | ウォレットが署名データを送信（POST）するVASPのエンドポイントURL。 |

#### **2.2.2 プロトコル実行フロー**

1. **イニシエーション**: ユーザーがVASP（取引所）の出金画面で「外部ウォレットへの出金」を選択し、検証方法としてAOPPを選ぶ。  
2. **ハンドシェイク**: VASPは上記のパラメータを含むQRコードを表示するか、ディープリンクボタンを提示する。  
3. **ウォレット起動**: ユーザーがQRをスキャンまたはリンクをクリックすると、AOPP対応ウォレット（BitBoxApp, BlueWallet等）が起動する。  
4. **ユーザー確認**: ウォレットは、URIからデコードされたmsg（署名対象メッセージ）と、署名に使用するアドレスをユーザーに提示する。  
   * *重要*: ここでウォレットは、ユーザーに対し「このメッセージに署名することで、アドレスの所有権を証明しますか？」と明示的に確認を求める。ハードウェアウォレット（BitBox02等）の場合、デバイス上のディスプレイで物理的な確認が行われる1。  
5. **暗号学的署名**: ユーザーが承認すると、ウォレットは該当アドレスの秘密鍵を用いてメッセージに署名を行う。  
6. **コールバック送信**: ウォレットは、署名データ、アドレス、および（要求された場合）その他のメタデータを、callback URLに対してJSON形式でPOSTする。

**コールバックのペイロード例:**

JSON

{  
  "version": 0,  
  "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",  
  "signature": "Hzx/3... (Base64 encoded ECDSA signature)",  
  "xpub": "xpub6C..." // オプション（後述の論争点）  
}

7. **検証と完了**: VASPのサーバーは受け取った署名を検証し、公開鍵（アドレスから導出または別途提供）と照合する。検証が成功すれば、該当アドレスは「所有者確認済み」としてホワイトリストに登録され、出金処理が続行される2。

### **2.3 達成された成果：UXとコンプライアンスの両立**

AOPPの実装により、以下の点が達成された。

1. **UXの劇的な改善**: 従来、PC画面のテキストをコピーし、ハードウェアウォレットを接続して署名ツールを開き、ペーストして署名し、結果を再びコピーしてブラウザに戻すという煩雑な手順が、QRコードスキャン一発で完結するようになった14。  
2. **セキュリティリスクの低減**: アドレスや署名データのコピー＆ペーストを排除したことで、マルウェアによるクリップボードの書き換え（Clipboard Hijacking）や、誤ったアドレスへの送金リスクが低減した13。  
3. **規制対応のコスト削減**: VASPにとっては、スクリーンショットの目視確認やSatoshi Testの入金確認といった手動プロセスが自動化され、コンプライアンスコストが大幅に圧縮された2。

### **2.4 実現できなかったこと：プライバシー論争とコミュニティの拒絶**

技術的には成功したかに見えたAOPPだが、その普及は「イデオロギー」の壁に阻まれた。

#### **2.4.1 「xPub」共有機能と監視への懸念**

AOPPの仕様には、オプションとして拡張公開鍵（xPub）をVASPに送信する機能が含まれていた1。xPubを共有するということは、そのウォレット（HDウォレット）から生成される過去および将来のすべてのアドレスと取引履歴をVASP（ひいては規制当局）に開示することを意味する。

ビットコインのプライバシーモデルは「アドレスの使い捨て」を前提としており、xPubの共有はこのモデルを根本から破壊する行為である。AOPP推進側は「xPub共有は必須ではなくオプションであり、単一アドレス証明（Single Address Verification）が基本である」と説明したが、コミュニティの不信感は拭えなかった。「一度プロトコルに機能が組み込まれれば、規制当局は必ずそれを強制するようになる」という滑り坂論法（Slippery Slope）への懸念が爆発したのである5。

#### **2.4.2 Trezorの撤退とエコシステムの分断**

2022年1月、大手ハードウェアウォレットメーカーのTrezorはAOPPのサポートを発表したが、直後にTwitter（現X）やRedditで激しい非難を浴びた。「Trezorは政府の監視に加担するのか」「サイファーパンクの精神に反する」といった批判を受け、Trezorはわずか数日後に「次のアップデートでAOPP関連コードを削除する」と発表し、撤回に追い込まれた6。

この事件は、\*\*「技術的に優れたソリューションであっても、分散化とプライバシーというコア・バリューと相反する場合、コミュニティには受け入れられない」\*\*という強力な教訓を残した。現在、AOPPはBitBoxやEdgeなど一部のウォレットでサポートが継続されているものの、デファクトスタンダードとしての地位確立には至っていない。

## ---

**3\. 日本におけるUnhosted Wallet本人確認の現状と課題**

### **3.1 日本の規制環境：JVCEAトラベルルールの現状**

日本では、金融庁（JFSA）の監督下、一般社団法人日本暗号資産取引業協会（JVCEA）が自主規制規則としてトラベルルールを運用している。2023年6月の改正犯収法施行以降、VASP間の通知義務は法制化されたが、Unhosted Walletへの送金については、スイスのような厳格な「技術的な所有証明」までは一律には求められていない17。

現状のJVCEA規則では、Unhosted Walletへの送金時に、顧客から「受取人の氏名・住所」等の申告を受けることが義務付けられているが、その情報の真偽をブロックチェーン上で技術的に検証することまでは必須とされていない20。しかし、FATFの第5次対日相互審査や、2025年に予定される勧告16の改訂（トラベルルールの強化）を見据えれば、日本においても「申告ベース」から「実証ベース」への移行は時間の問題である21。特に、北朝鮮ハッカー集団等による不正流出資金の洗浄対策として、Unhosted Wallet管理の厳格化は避けて通れない論点である19。

### **3.2 既存手法の限界**

日本で仮にAOPPと同様の仕組みを導入しようとした場合、以下の課題がある。

1. **VASPごとのサイロ化**: 各取引所が独自のアプリやフローで本人確認を行っており、相互運用性がない。  
2. **アドレスと本人の紐付けの脆弱性**: ユーザーが「自分のウォレットだ」と主張して署名しても、その署名者が「本人確認書類（免許証等）上の人物」と同一である保証は、VASP側のKYCに依存している。ウォレット自体には本人属性（Identity）が埋め込まれていないため、第三者のウォレットを「自分のもの」として登録する「名義貸し」のようなリスクを技術的に排除しきれない。

## ---

**4\. 提言：日本版次世代Unhosted Wallet本人確認プロトコル**

スイスの教訓（プライバシーへの配慮）と、日本の強み（世界最高水準の普及率と機能を持つマイナンバーカード）を融合させ、\*\*「JPKI-Native Privacy-Preserving Wallet Protocol（JPKIネイティブ・プライバシー保護ウォレットプロトコル）」\*\*を提言する。

### **4.1 プロトコルの設計思想：Verify, Don't Reveal（検証すれど開示せず）**

本プロトコルは、以下の3つの原則に基づく。

1. **Zero-Knowledge（ゼロ知識）**: ウォレットの所有権と、その所有者の本人性（JPKI署名）を証明する際、氏名・住所・マイナンバー等の個人情報（PII）をVASPに平文で渡さない。  
2. **Binding（紐付け）**: 「暗号資産アドレスの秘密鍵」と「JPKIの電子証明書」を、暗号学的に強固に紐付ける。これにより、VASPは「このアドレスの操作者は、間違いなく実在する本人である」ことを確信できる。  
3. **Standard-Compliant（標準準拠）**: 独自のURIスキーム（aopp:）ではなく、W3C Verifiable Credentials (VC) および OpenID4VP (OpenID for Verifiable Presentations) を採用し、EUDI Wallet等の国際標準との相互運用性を確保する。

### **4.2 アーキテクチャとプロトコルフロー**

このアーキテクチャでは、**User Wallet（Holder）**、**VASP（Verifier）**、そして信頼の起点となる\*\*JPKI（Trust Anchor）\*\*が登場する。

#### **フェーズ1: トラストのブートストラップ（Identity Binding）**

ユーザーは自身のスマートフォン（MynaWallet等のアプリ）を用いて、暗号資産アドレスとJPKIを紐付ける「Identity Commitment」を生成する。

1. **JPKI署名の生成**: ユーザーはマイナンバーカードをNFCでスキャンし、署名用電子証明書を用いて、自身の暗号資産ウォレットの公開鍵（またはそのハッシュ）に対して署名を行う。  
   * *署名対象*: Hash(Wallet\_PublicKey \+ Nonce)  
2. **ZK証明の生成**: アプリ内でローカルに以下の事実を証明するZero-Knowledge Proof（ZKP）を生成する。  
   * *Public Input*: 暗号資産ウォレットの公開鍵、信頼されたルートCA（日本の政府認証局）の公開鍵。  
   * *Private Input*: JPKI署名、JPKI電子証明書、マイナンバーカードのPIN。  
   * *Circuit Logic (回路論理)*: 「私は有効なJPKI証明書を持っており、その証明書でこのウォレット公開鍵に署名した。かつ、その証明書は政府のルートCAから正当に発行されたものである」。**重要なのは、ここで氏名やシリアル番号を出力せず、証明の正当性のみを出力することである。**

#### **フェーズ2: トラベルルール対応の証明提示（Verification Flow）**

VASPからの出金時、ユーザーはこの「紐付け」をOpenID4VP経由で提示する。

1. **Authorization Request**: VASPは openid4vp: スキーム（または openid-credential-offer:）を用いて、ユーザーに証明要求を送る。  
   * *Request*: 「あなたがこの出金先アドレスの所有者であり、かつ有効なJPKI本人確認済みであることを証明せよ（詳細はZKで）」  
2. **Proof Presentation**: ユーザーのウォレットは、フェーズ1で生成したZK証明と、今回のアドレス所有署名（Ethereumのpersonal\_sign等）をパッケージ化し、Verifiable Presentation (VP) として提出する。  
3. **Verification**: VASPはVPを受け取り、ZK証明を検証する。検証が通れば、「このアドレスは、確かに日本政府が認証した実在の個人によって管理されている」ことが、**個人情報を一切見ることなく**保証される。

### **4.3 比較分析：AOPP vs 提案プロトコル（J-AOPP）**

| 特徴 | スイス AOPP | 提案プロトコル (J-AOPP) |
| :---- | :---- | :---- |
| **信頼の起点** | VASPの顧客DB（KYC済） | 日本政府 (JPKI) |
| **証明内容** | 「VASP顧客が鍵を持っている」 | 「実在する個人が鍵を持っている」 |
| **プライバシー** | アドレス共有（xPubリスク有） | ZKによる完全秘匿（属性の選択的開示） |
| **通信規格** | 独自 (aopp:) | OpenID4VP (ISO/IEC, OIDF標準) |
| **データ形式** | JSON \+ ECDSA署名 | W3C VC / SD-JWT / ZK-Proof |
| **UX** | QRスキャン → 署名 | QR/NFCスキャン → 生体認証 → 完了 |

## ---

**5\. Verifiable Credentials活用における標準化未済事項と解決策**

このプロトコルを実現する上で、現在の標準化状況にはいくつかのギャップ（未済事項）が存在する。これらを解決するための具体的な技術仕様を提案する。

### **5.1 未済事項1: JPKIシリアル番号のDID Method化問題**

JPKIの電子証明書には一意のシリアル番号が含まれているが、これをそのままDID（Decentralized Identifier）の識別子（did:jpki:12345...）として使うことはプライバシー上極めて危険である。シリアル番号は変更されない限り永続的な追跡子（Tracker）となり、Web上の行動履歴と名寄せされるリスクがある23。

**現状**: did:jpki という公式メソッドは存在しない。MynaWallet等のプロジェクトは独自の実装を行っている段階である25。

**解決策の提言**: **did:jpki:zk メソッドの標準化**

* **Pairwise DID（ペアワイズDID）**: VASPごとに異なるDIDを生成する仕様とする。  
* **Nullifierの活用**: ZK回路の出力として、JPKIシリアル番号とVASPのドメイン名（またはContext ID）をハッシュ化した Nullifier を生成する。これにより、同じVASPに対しては同一性を証明できるが、異なるVASP間では名寄せが不可能なIDを生成できる。  
  * Nullifier \= Hash(JPKI\_Serial \+ Salt \+ Verifier\_ID)  
* この仕様を、W3C DID Core仕様に準拠した did:jpki メソッドとして、デジタル庁またはコンソーシアム（DVCC等）が策定・公開すべきである26。

### **5.2 未済事項2: オフチェーン検証とオンチェーン検証のブリッジ**

AOPPはオフチェーン（VASPサーバー）での検証を前提としていたが、Web3の世界ではスマートコントラクト（オンチェーン）で直接検証したいニーズがある（例：DeFiのパーミッションドプール）。しかし、JPKIのRSA署名をEVM上で検証するのはガス代が高い27。

**解決策の提言**: **Groth16/PlonKによるRSA検証回路の標準化**

* MynaWalletやA42x社が進めているように、RSA署名の検証をオフチェーンでZK証明（SNARKs）に圧縮し、オンチェーンでは軽量なVerifierコントラクトで証明のみを検証する方式を標準化する27。  
* これにより、「JPKIで認証されたアドレスのみが参加できるDeFi」などが現実的なコストで実現可能となる。

### **5.3 未済事項3: ICパスポートの活用と国際互換性**

マイナンバーカードを持たない外国人居住者や、海外からのアクセスに対しては、ICパスポート（ICAO Doc 9303）が信頼の起点となる。

**現状**: パスポートのNFCチップ内の署名を検証する「OpenPassport」や「ZKPassport」といったプロジェクトが存在するが、これらはまだ実験段階であり、VASPが法的に依拠できるレベルの標準化には至っていない30。

**解決策の提言**:

* **ICAO PKD（公開鍵ディレクトリ）オラクル**: 世界各国のパスポート発行局の公開鍵を、信頼できるオラクルとしてブロックチェーン上またはVASP共有DBに維持する仕組みを構築する。  
* **did:icao の検討**: パスポート番号や国籍情報をZKで隠蔽しつつ、「有効なパスポート保持者である」ことだけを証明するクレデンシャル定義を、OpenID4VPのプロファイルとして策定する。

## ---

**6\. 効果的かつユーザーフレンドリーな実装へのロードマップ**

「国際的にも高い水準と胸を張れる」システムを構築するためには、単なる技術実装だけでなく、UXとエコシステムのデザインが不可欠である。

### **6.1 ユーザー体験（UX）の最適化：App ClipsとNFC**

AOPPの敗因の一つは、ユーザーに「新しい操作」を強いたことにある。日本版では、以下のUXを目指すべきである。

* **App Clips / Instant Appsの活用**: 専用のウォレットアプリをインストールしていなくても、VASPの画面からQRコードを読み込むだけで、OSネイティブの軽量アプリ（App Clip）が立ち上がり、マイナンバーカードの読み取りと署名生成を一瞬で完了させる32。  
* **生体認証との融合**: 一度JPKIで紐付けを行えば、二回目以降はスマホの生体認証（FaceID/TouchID）だけで「JPKI紐付け済みDID」からの署名を生成できる（FIDO2/PasskeysとDIDの統合）33。

### **6.2 国際標準との整合性：EUDI Walletとの相互運用**

欧州では2026年にEUDI Wallet（欧州デジタルIDウォレット）が義務化される34。日本のシステムがガラパゴス化しないためには、EUDI Walletのアーキテクチャ参照枠組み（ARF）との互換性が必須である。

* **OpenID4VP (High Assurance Interoperability Profile)の採用**: EUDI Walletが採用するプロトコルであるOpenID4VPに完全準拠することで、将来的に「日本のVASPが、来日した欧州人のEUDI Walletを使って本人確認を行う」ことや、その逆が可能になる36。  
* **mDL（ISO/IEC 18013-5）フォーマットのサポート**: デジタル庁が既にiPhoneへの搭載を進めているmDLフォーマットを、暗号資産のコンプライアンスにも流用する。

### **6.3 結論：日本が取るべき戦略**

スイスのAOPPは「アドレス所有確認の自動化」という概念を実証したが、プライバシーという壁に突き当たった。日本は、この教訓を糧に、\*\*「JPKIという国家インフラ」**と**「ZK-Proofという先端暗号技術」\*\*を組み合わせることで、世界で最も安全かつプライバシーに配慮したクリプト・コンプライアンス基盤を構築できる。

**具体的なアクションプラン**:

1. **did:jpki 仕様の策定**: プライバシー保護（Pairwise/ZK）を前提としたDIDメソッドの標準化を、デジタル庁・金融庁・民間コンソーシアム主導で進める。  
2. **OpenID4VPプロファイルの整備**: VASPとウォレット間の通信仕様として、AOPPのような独自規格ではなく、OID4VPの日本版プロファイル（JPKI対応版）を策定する。  
3. **リファレンス実装の公開**: MynaWallet等の先行事例を参考に、オープンソースでZK回路と検証用SDKを公開し、VASPが容易に組み込める環境を作る。

これにより、日本は「規制とイノベーションの対立」を解消し、Web3時代の信頼あるデータ流通基盤（Trusted Web）のモデルケースを世界に示すことができるだろう。

### ---

**付録：主要技術規格比較**

| 項目 | AOPP (Swiss) | 提案プロトコル (Japan) | 備考 |
| :---- | :---- | :---- | :---- |
| **通信プロトコル** | aopp: (Custom URI) | openid4vp: (OpenID for Verifiable Presentations) | OID4VPはEUDI Wallet採用の国際標準 |
| **メッセージ形式** | Plain Text / JSON | Verifiable Presentation (W3C VC / SD-JWT) | VCはメタデータの検証が可能 |
| **署名アルゴリズム** | ECDSA (secp256k1) | JPKI (RSA) \+ ECDSA (Wallet) \+ ZK-Proof | JPKIは法的効力が高い |
| **プライバシー制御** | なし (xPub共有リスク) | あり (Zero-Knowledge, Selective Disclosure) | 最小開示原則に準拠 |
| **導入ハードル** | 低 (ウォレット側の対応のみ) | 中 (NFC読取、ZK回路の実装が必要) | SDK提供で緩和可能 |

#### **引用文献**

1. What is AOPP? The Simple Way to Prove Crypto Ownership \- BitBox Support Hub, 1月 8, 2026にアクセス、 [https://support.bitbox.swiss/1-other/what-is-aopp-crypto-ownership-proof](https://support.bitbox.swiss/1-other/what-is-aopp-crypto-ownership-proof)  
2. Self-hosted Wallet Verification Made Easy \- 21 Analytics, 1月 8, 2026にアクセス、 [https://www.21analytics.ch/docs/self-hosted-wallet-verification-made-easy-aopp-portal.pdf](https://www.21analytics.ch/docs/self-hosted-wallet-verification-made-easy-aopp-portal.pdf)  
3. FINMA Guidance 02/2019, 1月 8, 2026にアクセス、 [https://www.finma.ch/en/\~/media/finma/dokumente/dokumentencenter/myfinma/4dokumentation/finma-aufsichtsmitteilungen/20190826-finma-aufsichtsmitteilung-02-2019.pdf?sc\_lang=en\&hash=969666F37D318BA81D9A54C10DF94A33](https://www.finma.ch/en/~/media/finma/dokumente/dokumentencenter/myfinma/4dokumentation/finma-aufsichtsmitteilungen/20190826-finma-aufsichtsmitteilung-02-2019.pdf?sc_lang=en&hash=969666F37D318BA81D9A54C10DF94A33)  
4. Travel Rule: the latest FATF Guidance for VASPS and the Swiss legal framework \- Monetum, 1月 8, 2026にアクセス、 [https://monetum.com/travel-rule-the-latest-fatf-guidance-vasps-and-the-swiss-legal-framework/](https://monetum.com/travel-rule-the-latest-fatf-guidance-vasps-and-the-swiss-legal-framework/)  
5. Why Implementing AOPP Could Pose A Risk To Bitcoin Long Term, 1月 8, 2026にアクセス、 [https://bitcoinmagazine.com/technical/bitcoin-aopp-and-the-swiss-travel-rule](https://bitcoinmagazine.com/technical/bitcoin-aopp-and-the-swiss-travel-rule)  
6. Trezor removes Address Ownership Proof Protocol after community backlash \- Cryptonary, 1月 8, 2026にアクセス、 [https://cryptonary.com/trezor-removes-address-ownership-proof-protocol-after-community-backlash/](https://cryptonary.com/trezor-removes-address-ownership-proof-protocol-after-community-backlash/)  
7. Global Ledger and 21 Analytics to Make Travel Rule Compliance Easier \- Content Hub, 1月 8, 2026にアクセス、 [https://blog.globalledger.io/blog/global-ledger-and-21-analytics-to-make-travel-rule-compliance-easier](https://blog.globalledger.io/blog/global-ledger-and-21-analytics-to-make-travel-rule-compliance-easier)  
8. Self-Hosted Wallets and the Travel Rule: Navigating Regulatory Challenges \- MarketGuard, 1月 8, 2026にアクセス、 [https://marketguard.io/blog/self-hosted-wallets-and-the-travel-rule-navigating-regulatory-challenges](https://marketguard.io/blog/self-hosted-wallets-and-the-travel-rule-navigating-regulatory-challenges)  
9. An Overview of the 4 Self-hosted Wallet Verification Methods \- 21 Analytics, 1月 8, 2026にアクセス、 [https://www.21analytics.ch/blog/unhosted-wallet-verification-methods-an-overview/](https://www.21analytics.ch/blog/unhosted-wallet-verification-methods-an-overview/)  
10. How to transact compliantly with Self-hosted Wallets as a VASP in Switzerland \- MME Legal, 1月 8, 2026にアクセス、 [https://www.mme.ch/en/magazine/articles/how-to-transact-compliantly-with-self-hosted-wallets-as-a-vasp-in-switzerland](https://www.mme.ch/en/magazine/articles/how-to-transact-compliantly-with-self-hosted-wallets-as-a-vasp-in-switzerland)  
11. Address Ownership Proof Protocol (AOPP) \- GitLab, 1月 8, 2026にアクセス、 [https://gitlab.com/aopp/address-ownership-proof-protocol](https://gitlab.com/aopp/address-ownership-proof-protocol)  
12. Satoshi Tests hinder self custody, but AOPP can fix it\! \- BitBox Blog, 1月 8, 2026にアクセス、 [https://blog.bitbox.swiss/en/satoshi-tests-hinder-self-custody-but-aopp-can-fix-it/](https://blog.bitbox.swiss/en/satoshi-tests-hinder-self-custody-but-aopp-can-fix-it/)  
13. What Is the Address Ownership Proof Protocol (AOPP)? \- 21 Analytics, 1月 8, 2026にアクセス、 [https://www.21analytics.ch/what-is-aopp/](https://www.21analytics.ch/what-is-aopp/)  
14. AOPP: Address Ownership Proof Protocol \- 21 Analytics, 1月 8, 2026にアクセス、 [https://www.21analytics.ch/glossary/address-ownership-proof-protocol-aopp/](https://www.21analytics.ch/glossary/address-ownership-proof-protocol-aopp/)  
15. How to Transact with Self Hosted Wallets as a Swiss VASP \- 21 Analytics, 1月 8, 2026にアクセス、 [https://www.21analytics.ch/blog/transacting-with-self-hosted-wallets/](https://www.21analytics.ch/blog/transacting-with-self-hosted-wallets/)  
16. A decision on AOPP \- Trezor Blog, 1月 8, 2026にアクセス、 [https://blog.trezor.io/a-decision-on-aopp-789540c2930b](https://blog.trezor.io/a-decision-on-aopp-789540c2930b)  
17. Crypto Travel Rule: Global VASP Requirements in 2025 \- Hacken.io, 1月 8, 2026にアクセス、 [https://hacken.io/discover/crypto-travel-rule/](https://hacken.io/discover/crypto-travel-rule/)  
18. Blockchain & Cryptocurrency Regulation \- 2024, 1月 8, 2026にアクセス、 [https://www.amt-law.com/asset/res/news\_2023\_pdf/publication\_0027426\_ja\_001.pdf](https://www.amt-law.com/asset/res/news_2023_pdf/publication_0027426_ja_001.pdf)  
19. Japanese Crypto Exchanges to Enforce the Travel Rule from April 1 \- Merkle Science, 1月 8, 2026にアクセス、 [https://www.merklescience.com/blog/japanese-crypto-exchanges-to-enforce-the-travel-rule-from-april-1](https://www.merklescience.com/blog/japanese-crypto-exchanges-to-enforce-the-travel-rule-from-april-1)  
20. Blockchain & Cryptocurrency Laws & Regulations 2026 | Japan \- Global Legal Insights, 1月 8, 2026にアクセス、 [https://www.globallegalinsights.com/practice-areas/blockchain-cryptocurrency-laws-and-regulations/japan/](https://www.globallegalinsights.com/practice-areas/blockchain-cryptocurrency-laws-and-regulations/japan/)  
21. FATF updates Standards on Recommendation 16 on Payment Transparency, 1月 8, 2026にアクセス、 [https://www.fatf-gafi.org/en/publications/Fatfrecommendations/update-Recommendation-16-payment-transparency-june-2025.html](https://www.fatf-gafi.org/en/publications/Fatfrecommendations/update-Recommendation-16-payment-transparency-june-2025.html)  
22. Best Practices on Travel Rule Supervision \- FATF, 1月 8, 2026にアクセス、 [https://www.fatf-gafi.org/content/dam/fatf-gafi/recommendations/Best-Practices-Travel-Rule-Supervision.pdf](https://www.fatf-gafi.org/content/dam/fatf-gafi/recommendations/Best-Practices-Travel-Rule-Supervision.pdf)  
23. Japanese Public Key Infrastructure (JPKI)｜Digital Agency, 1月 8, 2026にアクセス、 [https://www.digital.go.jp/en/policies/mynumber/private-business/jpki-introduction](https://www.digital.go.jp/en/policies/mynumber/private-business/jpki-introduction)  
24. Toward the Realization of Electronic Certificates for Smartphones, 1月 8, 2026にアクセス、 [https://www.soumu.go.jp/main\_sosiki/joho\_tsusin/eng/presentation/pdf/First\_Summary\_Toward\_the\_Realization\_of\_Electronic\_Certificates\_for\_Smartphones.pdf](https://www.soumu.go.jp/main_sosiki/joho_tsusin/eng/presentation/pdf/First_Summary_Toward_the_Realization_of_Electronic_Certificates_for_Smartphones.pdf)  
25. Myna \- ETHGlobal, 1月 8, 2026にアクセス、 [https://ethglobal.com/showcase/myna-uxzdd](https://ethglobal.com/showcase/myna-uxzdd)  
26. Consortium for Decentralized ID & Verifiable Credentials established | by Norbert Gehrke | Tokyo FinTech | Medium, 1月 8, 2026にアクセス、 [https://medium.com/tokyo-fintech/consortium-for-decentralized-id-verifiable-credentials-established-113854651cfc](https://medium.com/tokyo-fintech/consortium-for-decentralized-id-verifiable-credentials-established-113854651cfc)  
27. MynaWallet AA Grant Progress Update \#3 \- a42x, 1月 8, 2026にアクセス、 [https://a42x.co.jp/news/2023/10/02/mynawallet-aa-ef-grant-update-03-en/](https://a42x.co.jp/news/2023/10/02/mynawallet-aa-ef-grant-update-03-en/)  
28. \[2511.09134\] One Signature, Multiple Payments: Demystifying and Detecting Signature Replay Vulnerabilities in Smart Contracts \- arXiv, 1月 8, 2026にアクセス、 [https://arxiv.org/abs/2511.09134](https://arxiv.org/abs/2511.09134)  
29. MynaWallet AA Grant Progress Update \#4 | Notion, 1月 8, 2026にアクセス、 [https://www.mynawallet.co.jp/MynaWallet-AA-Grant-Progress-Update-4-1651b33caf298037acc7cb5c028b5dcc](https://www.mynawallet.co.jp/MynaWallet-AA-Grant-Progress-Update-4-1651b33caf298037acc7cb5c028b5dcc)  
30. Frequently Asked Questions \- ZKPassport Docs, 1月 8, 2026にアクセス、 [https://docs.zkpassport.id/faq](https://docs.zkpassport.id/faq)  
31. Zero-knowledge proofs of identity using electronic passports \- Ethereum Research, 1月 8, 2026にアクセス、 [https://ethresear.ch/t/zero-knowledge-proofs-of-identity-using-electronic-passports/19263](https://ethresear.ch/t/zero-knowledge-proofs-of-identity-using-electronic-passports/19263)  
32. Use your My Number Card in Apple Wallet, 1月 8, 2026にアクセス、 [https://support.apple.com/en-us/122113](https://support.apple.com/en-us/122113)  
33. White Paper: Passkeys and Verifiable Digital Credentials: A Harmonized Path to Secure Digital Identity | FIDO Alliance, 1月 8, 2026にアクセス、 [https://fidoalliance.org/passkeys-and-verifiable-digital-credentials-a-harmonized-path-to-secure-digital-identity/](https://fidoalliance.org/passkeys-and-verifiable-digital-credentials-a-harmonized-path-to-secure-digital-identity/)  
34. European Digital Identity, 1月 8, 2026にアクセス、 [https://commission.europa.eu/topics/digital-economy-and-society/european-digital-identity\_en](https://commission.europa.eu/topics/digital-economy-and-society/european-digital-identity_en)  
35. 9 facts about the EU Digital Identity Wallet \- IDEMIA, 1月 8, 2026にアクセス、 [https://www.idemia.com/pdf-export.php?post\_id=11692\&utm](https://www.idemia.com/pdf-export.php?post_id=11692&utm)  
36. OpenID4VC High Assurance Interoperability Profile 1.0 \- draft 05, 1月 8, 2026にアクセス、 [https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1\_0-05.html](https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0-05.html)  
37. OpenID4VC High Assurance Interoperability Profile \- draft 03, 1月 8, 2026にアクセス、 [https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1\_0-ID1.html](https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0-ID1.html)