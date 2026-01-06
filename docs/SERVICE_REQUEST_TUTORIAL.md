# 行政サービス案内 (service_request) チュートリアル

このチュートリアルでは、制度案内（Administrative Request / service_request）の作り方を一通り説明します。
対象は `examples/service-request/` の構成で、手元の制度案内を Tobari 形式にするための最小手順です。

## 1. スキーマを用意する

制度案内は `service-request.yaml` のようなスキーマで定義します。
重要なのは `presentation_definition` を `type: object` で持たせる点です。

例: `examples/service-request/service-request.yaml`

```yaml
- id: "presentation_definition"
  label: "必要書類（機械可読）"
  type: "object"
```

## 2. データ（制度案内本文）を用意する

`presentation_definition` は JSON 構造で、必要な書類・項目を機械可読で定義します。
以下は最小構成のサンプルです。

```yaml
presentation_definition:
  input_descriptors:
    - id: "residence_info"
      name: "世帯構成情報"
      format:
        mso_mdoc:
          alg: ["ES384"]
      constraints:
        fields:
          - path: ["$['io.github.masanork.tobari.juminhyo.v1']['世帯主氏名']"]
            intent_to_retain: true
```

実例は `examples/service-request/child-allowance-data.yaml` を参照してください。

## 3. COSE を生成する

サンプルの生成スクリプトを使う場合は、以下のコマンドで `service-request.cose` を生成できます。

```bash
bun run examples/service-request/gen-request.ts
```

生成されたファイルは `examples/service-request/service-request.cose` になります。

## 4. HTML ビューアを生成する

制度案内をそのまま配布可能な HTML にする場合は、ビューア生成スクリプトを使います。

```bash
bun run packages/codec/src/bundle-viewer.ts examples/service-request/service-request.cose
```

`examples/service-request/service-request.html` が作成され、`presentation_definition` も整形された JSON として表示されます。

## 5. MCP で解析する

MCP サーバを使う場合は `analyze_service_request` で必要書類の抽出ができます。

```json
{
  "name": "analyze_service_request",
  "arguments": {
    "path": "/absolute/path/to/service-request.cose"
  }
}
```

解析結果は必要書類（mdoc）とユーザー入力の区別を含めて返されます。
