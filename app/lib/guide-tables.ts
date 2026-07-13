/**
 * ガイド公開ページ用のテーブル正規化（純関数）
 *
 * エディタ（TipTap）は列幅をドラッグ指定していない列を 25px 換算で表の
 * min-width に算入する（例: 固定 3 列 576px + 未指定 1 列 = min-width: 601px）。
 * このため幅の狭い画面では、未指定列に実質 25px しか割り当てられず
 * 1〜2 文字ずつの縦積みに潰れる（col 要素の min-width はブラウザが無視するため
 * 救済されない）。
 *
 * ここでは表の min-width を「固定列の合計 + 未指定列 × AUTO_COL_MIN_PX」に
 * 引き上げる。未指定列が常に読める幅を持ち、収まらない分は
 * .table-scroll-wrapper の横スクロールに逃げる。
 * 全列をドラッグ指定した表（style="width: ..."）は作者の指定を尊重して触らない。
 *
 * sanitize-html の出力（style="min-width:601px" 形式）と、エディタの生出力
 * （style="min-width: 601px;" 形式）の両方を受け付ける。
 */

/** 列幅未指定の列に確保する最小幅（px）。0.9em フォントで日本語 約11文字/行 */
const AUTO_COL_MIN_PX = 160;

/** style 文字列から min-width ではない width: Npx を取り出す */
const COL_WIDTH_RE = /(?<![-\w])width\s*:\s*([\d.]+)px/;

export function normalizeGuideTables(html: string): string {
  return html.replace(
    /<table([^>]*)>([\s\S]*?)<\/table>/g,
    (whole, attrs: string, inner: string) => {
      const styleMatch = attrs.match(/style="([^"]*)"/);
      const style = styleMatch ? styleMatch[1] : "";

      // 全列リサイズ済み（table 自体に width 指定）は作者の意図どおりに表示する
      if (COL_WIDTH_RE.test(style)) return whole;

      // colgroup から固定列の合計と未指定列数を求める
      let fixedSum = 0;
      let autoCount = 0;
      const colgroup = inner.match(/<colgroup>([\s\S]*?)<\/colgroup>/);
      if (colgroup) {
        const cols = colgroup[1].match(/<col\b[^>]*>/g) ?? [];
        for (const col of cols) {
          const w = col.match(COL_WIDTH_RE);
          if (w) {
            fixedSum += parseFloat(w[1]);
          } else {
            autoCount++;
          }
        }
      } else {
        // colgroup なしの旧形式: 先頭行のセル数（colspan 込み）を列数とみなす
        const firstRow = inner.match(/<tr[\s\S]*?<\/tr>/);
        if (firstRow) {
          for (const cell of firstRow[0].match(/<t[hd]\b[^>]*>/g) ?? []) {
            const span = cell.match(/colspan="(\d+)"/);
            autoCount += span ? parseInt(span[1], 10) : 1;
          }
        }
      }

      const total = Math.round(fixedSum + autoCount * AUTO_COL_MIN_PX);
      if (total <= 0) return whole;

      let newStyle: string;
      if (/min-width\s*:\s*[^;"]+/.test(style)) {
        newStyle = style.replace(/min-width\s*:\s*[^;"]+/, `min-width:${total}px`);
      } else {
        newStyle = style ? `${style.replace(/;?\s*$/, "")};min-width:${total}px` : `min-width:${total}px`;
      }
      const newAttrs = styleMatch
        ? attrs.replace(styleMatch[0], `style="${newStyle}"`)
        : `${attrs} style="min-width:${total}px"`;
      return `<table${newAttrs}>${inner}</table>`;
    },
  );
}
