/**
 * changelog.md のパースユーティリティ（純関数）
 *
 * changelog.md のバージョン見出しは「## vX.Y.Z（YYYY/MM/DD）」（全角括弧）で
 * 統一されている前提。フォーマットに一致しない入力からは空配列を返し、
 * 呼び出し側（What's New アイコン等）は「通知なし」に安全側でフォールバックする。
 */

export interface ChangelogEntry {
  /** 例: "v1.6.0" */
  version: string;
  /** 例: "2026/07/04" */
  date: string;
  /** セクション内の "### 見出し" 一覧（カテゴリバッジ表示用） */
  categories: string[];
  /** 見出し行を除いた、次のバージョン見出しまでの markdown 本文 */
  body: string;
}

const VERSION_HEADING = /^## (v\d+\.\d+\.\d+)（(\d{4}\/\d{2}\/\d{2})）\s*$/;
const CATEGORY_HEADING = /^### (.+)$/;

/** changelog.md 全文をバージョンごとのエントリに分解する（新しい順） */
export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (current) {
      current.body = bodyLines.join("\n").trim();
      entries.push(current);
    }
    bodyLines = [];
  };

  for (const line of md.split(/\r?\n/)) {
    const heading = line.match(VERSION_HEADING);
    if (heading) {
      flush();
      current = { version: heading[1], date: heading[2], categories: [], body: "" };
      continue;
    }
    // 先頭のバージョン見出しより前の行は無視
    if (!current) continue;
    const category = line.match(CATEGORY_HEADING);
    if (category) {
      current.categories.push(category[1].trim());
    }
    bodyLines.push(line);
  }
  flush();

  return entries;
}

/**
 * 既読バージョンより新しい未読エントリを返す（新しい順のまま）
 *
 * - seenVersion が null（localStorage にキーなし）: 過去の閲覧状況が不明なため、
 *   最新の1件のみを未読として返す（導入時に全履歴を積まないため）
 * - seenVersion がエントリ中に見つかる: それより新しいものを返す
 * - seenVersion が見つからない（古すぎる・changelog整理済み等）: 全件を未読として返す
 *   （表示側で件数を制限する）
 */
export function unreadEntries(
  entries: ChangelogEntry[],
  seenVersion: string | null,
): ChangelogEntry[] {
  if (entries.length === 0) return [];
  if (seenVersion === null) return entries.slice(0, 1);
  const seenIndex = entries.findIndex((entry) => entry.version === seenVersion);
  if (seenIndex === -1) return entries;
  return entries.slice(0, seenIndex);
}
