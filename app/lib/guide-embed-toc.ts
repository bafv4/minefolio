// ガイド記事の目次に、サーチクラフト埋め込み（ユーザー参照・テンプレート）のグループ見出し（OW・Bastion 等）を
// 差し込む純粋関数。本文の目次（guide-toc.ts の buildTableOfContents）は保存 HTML の h1〜h3 から作るが、
// 埋め込みの中身（グループ見出し）は HTML に無く、loader が引いたデータから React が描くので、
// 埋め込みを解決した後（loader の末尾）にここで合流させる。
// 描画側（SearchCraftGroupedList の groupHeadingId）と同じ id を使うので、目次とアンカーが常に一致する。

import type { TocItem } from "@/lib/guide-toc";

/** 目次に載せる最大の段（guide-toc.ts は元のレベル 1〜3 を目次にする。ここもそれを超えない） */
export const TOC_MAX_LEVEL = 3;

/**
 * 埋め込みのグループ見出しの id。embedIndex は本文中の埋め込み（リマップ・サーチクラフト・テンプレート。
 * 本文の出現順・0 始まり）の通し番号で、同じ走者・同じテンプレートを複数回埋め込んでも記事の中で一意になる。
 * timing は表示用に解決済みのタイミング（null＝指定なし）。`heading-N`（本文の見出し）とは接頭辞が別
 */
export function embedGroupHeadingId(embedIndex: number, timing: string | null): string {
  return `embed-${embedIndex}-${timing ?? "none"}`;
}

/** loader が目次の合流に渡す、本文を埋め込みの境界で分けた断片 */
export type TocSegment =
  | { kind: "html"; content: string }
  | {
      kind: "embed";
      /** embedGroupHeadingId に渡す通し番号 */
      index: number;
      /** 見出しつきで描かれるグループ（描画順）。見出しが出ない埋め込み（走者なし・0 件・タイミングなし）は空 */
      groups: { timing: string | null; title: string }[];
      /** 同じ節に見出しつきの埋め込みが複数あるとき、項目を区別するための名前（テンプレート名・走者名） */
      name: string;
    }
  | { kind: "other" };

// 見出しの開始タグ（h1〜h6）。level（data-guide-level）と id（heading-N）は同じタグの属性から取る
const HEADING_TAG_RE = /<h[1-6]\b[^>]*>/g;
const GUIDE_LEVEL_ATTR_RE = /\sdata-guide-level="([1-6])"/;
const HEADING_ID_ATTR_RE = /\sid="(heading-\d+)"/;

/** 文書順の見出し。level は元のレベル（data-guide-level が無い見出しは null）、id は本文の目次の id（無ければ null） */
type HeadingMark = { level: number | null; id: string | null };

function scanHeadings(html: string): HeadingMark[] {
  const marks: HeadingMark[] = [];
  for (const m of html.matchAll(HEADING_TAG_RE)) {
    marks.push({
      level: Number(GUIDE_LEVEL_ATTR_RE.exec(m[0])?.[1]) || null,
      id: HEADING_ID_ATTR_RE.exec(m[0])?.[1] ?? null,
    });
  }
  return marks;
}

/**
 * 本文の目次に、埋め込みのグループ見出しを文書順で差し込んだ目次を返す。
 *
 * - 段（level）は元のレベルの空間で決める: 直前の本文の見出しの元のレベル（`data-guide-level`。降格後の段ではない）＋1。
 *   これは描画側の見出しの段（embedGroupHeadingLevels = 直前の見出しの1つ下）と同じ相対位置。
 *   前に見出しが無ければ、本文の最小の元のレベル＋1（見出しが全く無ければ 2）。目次は TOC_MAX_LEVEL（3）までなので、
 *   それを超える段（元のレベル 3 の見出しの下など）の項目は載せない（見出し自体は本文に出る）
 * - 同じ節（本文の同じ2つの見出しの間）に見出しつきの埋め込みが2つ以上あるときは、同名の「OW」を区別できるよう
 *   項目の文を「OW — 名前」にする
 * - 本文の目次の項目と html 断片の見出し id が合わない（想定外）ときは、本文の目次をそのまま返す
 */
export function mergeEmbedGroupsIntoToc(segments: TocSegment[], toc: TocItem[]): TocItem[] {
  if (!segments.some((s) => s.kind === "embed" && s.groups.length > 0)) return toc;

  const tocById = new Map(toc.map((item) => [item.id, item]));

  // html 断片ごとの見出しを1回だけ走査する
  const marksBySegment = new Map<TocSegment, HeadingMark[]>();
  // 本文の最小の元のレベル（前に見出しが無い埋め込みの基準）
  let minOriginal = 7;
  for (const seg of segments) {
    if (seg.kind !== "html") continue;
    const marks = scanHeadings(seg.content);
    marksBySegment.set(seg, marks);
    for (const mark of marks) if (mark.level !== null) minOriginal = Math.min(minOriginal, mark.level);
  }
  const defaultPrecedingLevel = minOriginal === 7 ? 1 : minOriginal;

  // 節（本文の見出しの個数で区切る）ごとの、見出しつきの埋め込みの数
  const embedsPerSection = new Map<number, number>();
  {
    let section = 0;
    for (const seg of segments) {
      if (seg.kind === "html") section += marksBySegment.get(seg)?.length ?? 0;
      else if (seg.kind === "embed" && seg.groups.length > 0) {
        embedsPerSection.set(section, (embedsPerSection.get(section) ?? 0) + 1);
      }
    }
  }

  const merged: TocItem[] = [];
  let bodyCount = 0;
  let section = 0;
  let precedingLevel = defaultPrecedingLevel;
  for (const seg of segments) {
    if (seg.kind === "html") {
      // 見出しを文書順にたどる（目次に載る id は本文の項目、載らない見出し〔空・h4 以下〕は段だけ持ち越す）
      const marks = marksBySegment.get(seg) ?? [];
      section += marks.length;
      for (const mark of marks) {
        if (mark.level === null) continue;
        precedingLevel = mark.level;
        const item = mark.id ? tocById.get(mark.id) : undefined;
        if (item) {
          merged.push(item);
          bodyCount += 1;
        }
      }
      continue;
    }
    if (seg.kind !== "embed" || seg.groups.length === 0) continue;
    const level = precedingLevel + 1;
    if (level > TOC_MAX_LEVEL) continue;
    const disambiguate = (embedsPerSection.get(section) ?? 0) > 1;
    for (const g of seg.groups) {
      merged.push({
        id: embedGroupHeadingId(seg.index, g.timing),
        text: disambiguate && seg.name ? `${g.title} — ${seg.name}` : g.title,
        level,
      });
    }
  }

  return bodyCount === toc.length ? merged : toc;
}
