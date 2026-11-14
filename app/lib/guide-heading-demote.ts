// ガイド本文（サニタイズ済みHTML文字列）の見出しを表示時に降格する純粋関数。
// ページタイトルが h1 を占有するため、本文中の最小見出しレベルが h2 になるようにシフトする
// （h1 始まり → +1、h2 始まり → 0、h3 始まり → -1）。本文内の相対的な階層は保ち、h6 を超えない。
// 見出しが無い本文は何もしない。
// 降格後も見た目は変えないため、開きタグに元のレベルを data-guide-level として付与する
// （app.css の .guide-content-demoted はこの属性で見出しサイズを当てる）。
// 保存データ・エディタの見出しレベルは変えない。属性（id 等）と大文字小文字は保持する。
// 目次の抽出（guide-toc.ts）は元のレベルで行うため、目次 → 本関数の順で適用すること。

const HEADING_TAG_RE = /<(\/?)([hH])([1-6])(?=[\s>/])/g;

export function demoteGuideHeadings(html: string): string {
  let minLevel = 7;
  for (const m of html.matchAll(HEADING_TAG_RE)) {
    if (m[1] === "") minLevel = Math.min(minLevel, Number(m[3]));
  }
  if (minLevel === 7) return html;

  const shift = 2 - minLevel;
  return html.replace(HEADING_TAG_RE, (_m, slash: string, h: string, n: string) => {
    const original = Number(n);
    const level = Math.min(Math.max(original + shift, 2), 6);
    return slash
      ? `</${h}${level}`
      : `<${h}${level} data-guide-level="${original}"`;
  });
}
