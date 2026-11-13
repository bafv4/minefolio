// ガイド本文（サニタイズ済みHTML文字列）の見出しを表示時に1段下げる純粋関数。
// ページタイトルが h1 を占有するため、本文の h1〜h5 を h2〜h6 にする（h6 は据え置き）。
// 保存データ・エディタの見出しレベルは変えない。属性（id 等）と大文字小文字は保持する。
// 目次の抽出（guide-toc.ts）は元のレベルで行うため、目次 → 本関数の順で適用すること。

const HEADING_TAG_RE = /<(\/?)([hH])([1-6])(?=[\s>/])/g;

export function demoteGuideHeadings(html: string): string {
  return html.replace(HEADING_TAG_RE, (_m, slash: string, h: string, n: string) => {
    const level = Math.min(Number(n) + 1, 6);
    return `<${slash}${h}${level}`;
  });
}
