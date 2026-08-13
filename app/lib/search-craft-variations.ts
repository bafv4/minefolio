/**
 * サーチクラフト「1エントリ複数サーチ文字列（バリエーション）」の共有ロジック。
 *
 * エンダーアイが `en` でも `er` でもクラフトできるように、1つのサーチクラフトエントリ
 * （アイテム）へ複数のサーチ文字列（バリエーション）を登録できる。純関数のみで構成する
 * 葉モジュール（`.server` にしない。app/lib/search-craft-loops.ts と同じ位置付け）。
 *
 * 重要: このモジュール内では str の trim・正規化は一切行わない（空判定にのみ trim を使う）。
 * 先頭・末尾のスペースはスペースキー入力として意味を持つ既存仕様のため、
 * 呼び出し側から渡された文字列をそのまま保持する（docs/items-searchcraft.md 参照）。
 *
 * DB（search_crafts）: search_variations 列（JSON オブジェクト配列）を持つ。
 * 既存の search_str / with_shift は第1バリエーションのミラーとして書き込みを継続する
 * （旧リーダー・ロールバック互換）。全 insert 箇所は variationMirror() 経由でこのミラーを書くこと。
 * 旧データ（search_variations が null）からのフォールバックは、必ず resolveVariations() を通す
 * （各所に手書きで searchStr/withShift から合成するロジックを書かない）。
 */

/** 1件のサーチ文字列バリエーション。withShift はバリエーションごとに設定できる */
export type SearchCraftVariation = { str: string; withShift: boolean };

/** 1エントリあたりのバリエーション上限（並べ替えUIなし・最低1件） */
export const MAX_SEARCH_VARIATIONS = 5;

/** 値がプレーンオブジェクト（配列でない object）かどうか。search-craft-loops.ts と共有する */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * SearchCraftVariation[] としての構造検証（action の受け口用）。
 * 1〜MAX_SEARCH_VARIATIONS件、各要素が { str: string; withShift: boolean } であることを検証する。
 * str の非空判定はここでは行わない（trim による空判定は呼び出し側の業務検証が担う。
 * このモジュールでは trim した値を保存しない＝原文保持の方針を貫くため、
 * 構造検証自体は型のみを見る）。
 */
export function isValidVariationsShape(value: unknown): value is SearchCraftVariation[] {
  if (!Array.isArray(value)) return false;
  if (value.length < 1 || value.length > MAX_SEARCH_VARIATIONS) return false;
  return value.every(
    (v) => isPlainObject(v) && typeof v.str === "string" && typeof v.withShift === "boolean",
  );
}

/**
 * search_variations 列（JSON文字列）の耐性パース。不正な JSON・不正な形状は null を返す
 * （呼び出し側は resolveVariations() でフォールバックすること）。
 */
export function parseVariationsJson(json: string | null | undefined): SearchCraftVariation[] | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return isValidVariationsShape(raw) ? raw : null;
}

/**
 * バリエーションの正準読み取り。
 * variations（既にパース済みの値。isValidVariationsShape を満たす場合のみ採用）があればそれを使い、
 * 無ければ searchStr/withShift から1件だけ合成する。どちらも無ければ空配列（未入力状態）。
 *
 * 旧データ（search_variations 列が null のDB行・variations フィールドを持たない
 * 古いプリセット/テンプレートスナップショット）を読むときは、必ずこの関数を経由すること。
 */
export function resolveVariations(src: {
  variations?: unknown;
  searchStr: string | null;
  withShift?: boolean | null;
}): SearchCraftVariation[] {
  if (isValidVariationsShape(src.variations)) return src.variations;
  if (src.searchStr) {
    return [{ str: src.searchStr, withShift: src.withShift === true }];
  }
  return [];
}

/**
 * 書き込みミラー: search_str / with_shift 列（およびスナップショット上の同名フィールド）に
 * 書き込む値を、正準の variations から導出する（第1バリエーションのミラー）。
 * 第1バリエーションの str が空文字列の場合は、従来の「未入力=null」の慣習に合わせ
 * searchStr は null を返す（str をそのまま "" として書き込まない）。
 */
export function variationMirror(
  variations: SearchCraftVariation[],
): { searchStr: string | null; withShift: boolean } {
  const first = variations[0];
  return {
    searchStr: first && first.str ? first.str : null,
    withShift: first ? first.withShift === true : false,
  };
}

/**
 * DB行・スナップショット行からバリエーションを読み取る定型パターン。
 * `variations` が既に妥当な配列（isValidVariationsShape を満たす。プリセットデコード等、
 * 呼び出し側で既にパース済みの経路）で渡された場合はそれを優先し、無ければ
 * `searchVariations`（JSON文字列列）を parseVariationsJson() でパースし、それも無ければ
 * searchStr/withShift から1件合成する（resolveVariations() の定型呼び出し。手書きしない）。
 */
export function resolveRowVariations(row: {
  searchVariations?: string | null;
  searchStr: string | null;
  withShift?: boolean | null;
  variations?: unknown;
}): SearchCraftVariation[] {
  const variations = isValidVariationsShape(row.variations)
    ? row.variations
    : (parseVariationsJson(row.searchVariations) ?? undefined);
  return resolveVariations({ variations, searchStr: row.searchStr, withShift: row.withShift });
}

/**
 * insert 用の3列（searchStr・withShift・searchVariations）を、正準の variations から
 * まとめて構築する（variationMirror() のミラー計算 + searchVariations の JSON 化の定型。
 * 空配列（未入力状態）は searchVariations に null を書く）。
 */
export function searchCraftColumnValues(
  variations: SearchCraftVariation[],
): { searchStr: string | null; withShift: boolean; searchVariations: string | null } {
  const mirror = variationMirror(variations);
  return {
    searchStr: mirror.searchStr,
    withShift: mirror.withShift,
    searchVariations: variations.length > 0 ? JSON.stringify(variations) : null,
  };
}
