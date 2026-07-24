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
 * サニタイザ（xss/cssfilter）の出力（style="min-width:601px" 形式）と、
 * エディタの生出力（style="min-width: 601px;" 形式）の両方を受け付ける。
 *
 * 走査は線形（indexOf ベース）。以前は
 * `/<table([^>]*)>([\s\S]*?)<\/table>/g` の遅延一致でテーブルを取り出していたが、
 * 閉じていない `<table>` が多数あると各開始位置で末尾まで再走査するため入力長に対して
 * O(n^2) になり、公開ガイド閲覧（毎リクエスト SSR で実行）が DoS の的になっていた。
 * 現在は開始タグ→最初の `</table>` を indexOf で辿り、`</table>` が尽きた時点で
 * 短絡して打ち切るため、未閉じ/不均衡なタグが何個あっても線形で終わる。
 * 整形済みの正常な表に対する出力は従来の正規表現版とバイト単位で同一。
 */

/** 列幅未指定の列に確保する最小幅（px）。0.9em フォントで日本語 約11文字/行 */
const AUTO_COL_MIN_PX = 160;

/** style 文字列から min-width ではない width: Npx を取り出す */
const COL_WIDTH_RE = /(?<![-\w])width\s*:\s*([\d.]+)px/;

const TABLE_OPEN = "<table";
const TABLE_CLOSE = "</table>";

/**
 * `s` 中で最初の `open` に続く最初の `close` までの中身を返す（見つからなければ null）。
 * `/${open}([\s\S]*?)${close}/`（非グローバル・遅延一致）の初回マッチ捕捉と同義だが、
 * indexOf 2 回で完結するため未閉じタグが多数あっても線形。
 * （最初の `open` に続く `close` が無ければ、それ以降の `open` にも `close` は無いので null。）
 */
function firstLazySegment(s: string, open: string, close: string): string | null {
  const start = s.indexOf(open);
  if (start === -1) return null;
  const contentStart = start + open.length;
  const end = s.indexOf(close, contentStart);
  if (end === -1) return null;
  return s.slice(contentStart, end);
}

/**
 * 1 つの表（whole=表全体, attrs=開始タグの属性部, inner=開始/終了タグ間）に対する
 * min-width 正規化。従来の replace コールバックと同じ判定・同じ出力文字列を返す。
 */
function normalizeTable(whole: string, attrs: string, inner: string): string {
  const styleMatch = attrs.match(/style="([^"]*)"/);
  const style = styleMatch ? styleMatch[1] : "";

  // 全列リサイズ済み（table 自体に width 指定）は作者の意図どおりに表示する
  if (COL_WIDTH_RE.test(style)) return whole;

  // colgroup から固定列の合計と未指定列数を求める
  let fixedSum = 0;
  let autoCount = 0;
  const colgroupInner = firstLazySegment(inner, "<colgroup>", "</colgroup>");
  if (colgroupInner !== null) {
    const cols = colgroupInner.match(/<col\b[^>]*>/g) ?? [];
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
    const firstRow = firstLazySegment(inner, "<tr", "</tr>");
    if (firstRow !== null) {
      const firstRowHtml = `<tr${firstRow}</tr>`;
      for (const cell of firstRowHtml.match(/<t[hd]\b[^>]*>/g) ?? []) {
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
}

export function normalizeGuideTables(html: string): string {
  let result = "";
  let cursor = 0; // ここより前は result に反映済み（未処理テキストの先頭）

  while (cursor < html.length) {
    const open = html.indexOf(TABLE_OPEN, cursor);
    if (open === -1) break; // これ以降に <table> は無い

    // 開始タグの終端 '>'。属性部は [^>]* 相当なので「開始位置直後の最初の '>'」で確定する。
    const gt = html.indexOf(">", open + TABLE_OPEN.length);
    if (gt === -1) break; // 開始タグが閉じない → 以降どの位置でもマッチ不能（元の正規表現も同様）

    // 開始タグ以降の最初の </table>（元の遅延一致 [\s\S]*?</table> と同義）。
    const close = html.indexOf(TABLE_CLOSE, gt + 1);
    if (close === -1) break; // 閉じタグが尽きた → 以降の <table> も全てマッチ不能なので短絡して打ち切る

    const attrs = html.slice(open + TABLE_OPEN.length, gt);
    const inner = html.slice(gt + 1, close);
    const whole = html.slice(open, close + TABLE_CLOSE.length);

    result += html.slice(cursor, open);
    result += normalizeTable(whole, attrs, inner);
    cursor = close + TABLE_CLOSE.length;
  }

  result += html.slice(cursor);
  return result;
}
