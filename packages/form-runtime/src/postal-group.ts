/**
 * 郵便番号フィールドの階層的グループ化ユーティリティ
 *
 * フィールド名からグループプレフィックスを抽出し、
 * 同じグループ内のフィールドのみを紐付けるための共通ロジックを提供します。
 */

export interface ParsedField {
  group: string | null;      // グループプレフィックス（例: "sender", "recipient"）
  separator: string | null;  // セパレータ（".", "_", "-"）
  fieldType: string | null;  // フィールドタイプ（"zip", "pref", "city", など）
  raw: string;               // 元のキー名
}

/**
 * フィールド名からグループ情報を抽出
 *
 * 対応するセパレータ:
 * - ドット（.）: sender.zip, sender.building
 * - アンダースコア（_）: sender_zip, sender_phone
 * - ハイフン（-）: sender-zip, sender-email
 *
 * 複数階層にも対応:
 * - company.sender.zip → グループ: "company.sender", フィールド: "zip"
 *
 * セパレータが含まれていれば、既知のフィールドタイプでなくてもグループを抽出します。
 * これにより、グループに住所以外の属性（建物名、電話番号など）も含めることができます。
 */
export function parseFieldName(input: HTMLInputElement): ParsedField {
  const key = (input.dataset.jsonPath || input.dataset.baseKey || input.name || input.id || '').toLowerCase();

  // セパレータごとに分割を試みる
  const separators = ['.', '_', '-'];

  for (const sep of separators) {
    if (!key.includes(sep)) continue;

    const parts = key.split(sep);
    if (parts.length < 2) continue;

    // 最後のパートがフィールドタイプ
    const fieldType = parts[parts.length - 1];

    // グループプレフィックスは最後を除くすべての部分を結合
    const group = parts.slice(0, -1).join(sep);

    return {
      group,
      separator: sep,
      fieldType,
      raw: key
    };
  }

  // セパレータが含まれていない場合はグループなし
  return {
    group: null,
    separator: null,
    fieldType: key,
    raw: key
  };
}

/**
 * 2つのフィールドが同じグループに属するかチェック
 *
 * 同じグループと判定される条件:
 * - 両方ともグループプレフィックスを持つ
 * - グループプレフィックスが一致する
 * - セパレータが一致する
 *
 * 例:
 * - sender.zip と sender.pref → true
 * - sender.zip と recipient.pref → false
 * - sender.zip と sender_pref → false（セパレータが異なる）
 */
export function isSameGroup(field1: ParsedField, field2: ParsedField): boolean {
  // 両方ともグループを持つ必要がある
  if (!field1.group || !field2.group) {
    return false;
  }

  // グループプレフィックスとセパレータが一致する必要がある
  return field1.group === field2.group && field1.separator === field2.separator;
}

/**
 * フィールドタイプを判定（郵便番号、都道府県、市区町村など）
 *
 * @param fieldType フィールドタイプ文字列（parseFieldNameで抽出したもの）
 * @returns フィールドタイプ、または null（未知のタイプの場合）
 */
export function detectFieldType(fieldType: string): 'zip' | 'pref' | 'city' | 'town' | 'address' | null {
  if (!fieldType) return null;

  if (fieldType.match(/zip|postal|postcode|郵便/)) return 'zip';
  if (fieldType.match(/pref|都道府県/)) return 'pref';
  if (fieldType.match(/city|市区町村|市町村/)) return 'city';
  if (fieldType.match(/town|町名|町字|字/)) return 'town';
  if (fieldType.match(/address|住所/) && !fieldType.match(/detail|sub|番地|building|room|mansion|house/)) return 'address';

  return null;
}
