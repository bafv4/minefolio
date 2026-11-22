/**
 * URL の日付パラメータ（YYYY-MM-DD）を、実在する日付だけに絞る。
 * `new Date("2026-02-31...")` は V8 では通り Firefox では Invalid Date になるため、
 * SSR とハイドレーションで判定が割れないよう、年月日を分解して Date.UTC で往復して一致を見る。
 * サーバー（parseDateParam）と画面（/paces・/videos の絞り込み）で共有する。
 */
export function normalizeDateParam(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC は 0〜99 年を 1900 年代に読み替えるので、年も往復で確かめる
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return value;
}

/** 開始日が終了日より後（逆順）か。YYYY-MM-DD なので文字列の比較で前後が分かる。どちらかが空なら false */
export function isReversedPeriod(from: string | null | undefined, to: string | null | undefined): boolean {
  return Boolean(from && to) && (from ?? "") > (to ?? "");
}
