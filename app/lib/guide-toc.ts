// ガイド本文（サニタイズ済みHTML文字列）から目次を生成するユーティリティ。
// h1〜h3 を抽出して安定した id（heading-N）を付与し、目次データを返す。
// サーバ側で実行し、id 付与済みHTMLと目次を SSR に載せる（アンカーと目次が常に一致する）。

export interface TocItem {
  /** 見出しに付与する id（アンカー先） */
  id: string;
  /** 目次に表示するテキスト（インライン装飾は除去済み） */
  text: string;
  /** 見出しレベル（1〜3） */
  level: number;
}

// <h1>〜<h3>（属性有無どちらも）とその中身を捕捉する。
// タグ直後は空白か '>' に限定して <h11> のような誤マッチを防ぐ。
const HEADING_RE = /<(h[1-3])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * HTML 内の h1〜h3 に id を付与し、目次データを生成する。
 * 空の見出し（テキスト無し）は id 付与・目次登録ともにスキップする。
 */
export function buildTableOfContents(html: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  let index = 0;

  const out = html.replace(HEADING_RE, (match, tag: string, attrs: string | undefined, inner: string) => {
    const text = decodeEntities(inner.replace(/<[^>]*>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return match; // 空見出しはそのまま

    index += 1;
    const id = `heading-${index}`;
    toc.push({ id, text, level: Number(tag[1]) });
    return `<${tag}${attrs ?? ""} id="${id}">${inner}</${tag}>`;
  });

  return { html: out, toc };
}
