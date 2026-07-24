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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// 見出しの中身から目次テキストを作る。
// インラインタグ除去 → エンティティ復号 → 空白正規化（旧実装と同一の処理列）。
function headingText(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

// 開始タグ名の直後（属性の直前位置）が空白かを判定する 1 文字テスト。
// 正規表現 \s と同一の文字集合。
const WS_RE = /\s/;

/**
 * html 内で from 以降にある最初の閉じ見出しタグ `</hN>` の開始位置を返す（無ければ -1）。
 * `h` は大文字小文字を問わず、数字 digit は完全一致（旧正規表現の後方参照 \1 と同義）。
 * indexOf ベースの前方走査のみで、走査位置は単調増加するため入力長に対して線形。
 */
function findHeadingClose(html: string, from: number, digit: string): number {
  let p = from;
  for (;;) {
    const idx = html.indexOf("</", p);
    if (idx === -1) return -1;
    const letter = html[idx + 2];
    if (
      (letter === "h" || letter === "H") &&
      html[idx + 3] === digit &&
      html[idx + 4] === ">"
    ) {
      return idx;
    }
    p = idx + 2;
  }
}

/**
 * HTML 内の h1〜h3 に id を付与し、目次データを生成する。
 * 空の見出し（テキスト無し）は id 付与・目次登録ともにスキップする。
 *
 * 旧実装は /<(h[1-3])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi の遅延後方参照で閉じタグを探していた。
 * 閉じられていない見出しが多数あると各開始位置から末尾まで再走査するため O(n^2) となり、
 * 攻撃者が保存したガイド本文（例: 閉じタグ無しの `<h1>` を大量に並べる）で、公開閲覧
 * （SSR）ごとに CPU を食い潰して 500 を誘発できた（ReDoS/DoS）。
 *
 * ここでは indexOf ベースの前方走査に置き換え、旧正規表現と同じマッチ集合を線形時間で得る。
 * 整形式HTMLに対する出力（目次・生成される id / アンカー・返す変換後 html）は旧実装とバイト一致する:
 * - マッチの検出順・消費範囲（開始タグ直後の空白/`>` 制約、最初の対応閉じタグまでを遅延取得）を保存
 * - 空見出しは元の文字列のまま素通し、非空見出しは `<tag attrs id="heading-N">inner</tag>` を再構築
 * 閉じタグが見つからない見出しはレベルごとに記憶して再走査を避け、`<h1>` 連打でも線形で完了する。
 */
export function buildTableOfContents(html: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  const len = html.length;

  let out = "";
  let emitted = 0; // out に未反映の html 先頭位置（[emitted, ...) はまだ未コピー）
  let i = 0; // 次に開始タグを探し始める位置
  let index = 0;

  // 閉じタグが存在しないと確定した見出しレベルを記憶し、以降の再走査を省く（線形性の担保）。
  const noClose: Record<string, boolean> = { "1": false, "2": false, "3": false };

  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;

    // `<hN` の形か（N は 1〜3、h は大文字小文字問わず）。
    const letter = html[lt + 1];
    const digit = html[lt + 2];
    if (
      (letter !== "h" && letter !== "H") ||
      (digit !== "1" && digit !== "2" && digit !== "3")
    ) {
      i = lt + 1;
      continue;
    }

    // タグ名の直後は `>`（属性なし）か空白（属性あり）に限る。<h11> 等の誤マッチを防ぐ。
    const after = html[lt + 3];
    let openEnd: number; // 開始タグの `>` の位置
    let attrs: string; // 旧実装の (\s[^>]*)? 相当（属性なしは空文字）
    if (after === ">") {
      openEnd = lt + 3;
      attrs = "";
    } else if (after !== undefined && WS_RE.test(after)) {
      const gt = html.indexOf(">", lt + 4);
      // `>` が以降に一切無い＝これ以降に完結する開始/終了タグは存在しない。残りは素通し。
      if (gt === -1) break;
      openEnd = gt;
      attrs = html.slice(lt + 3, gt);
    } else {
      i = lt + 1;
      continue;
    }

    // 対応する閉じタグ </hN> を前方に探す。
    const innerStart = openEnd + 1;
    let close: number;
    if (noClose[digit]) {
      close = -1;
    } else {
      close = findHeadingClose(html, innerStart, digit);
      if (close === -1) noClose[digit] = true;
    }
    if (close === -1) {
      // この開始タグは閉じないため旧正規表現でもマッチ不成立。次の `<` から探し直す。
      i = lt + 1;
      continue;
    }

    const tag = html.slice(lt + 1, lt + 3); // "hN"（元の大文字小文字を保持）
    const inner = html.slice(innerStart, close);
    const matchEnd = close + 5; // "</hN>".length === 5
    const text = headingText(inner);

    if (!text) {
      // 空見出しはそのまま（マッチは消費するが出力は変えない = 元の文字列を素通し）。
      i = matchEnd;
      continue;
    }

    index += 1;
    const id = `heading-${index}`;
    toc.push({ id, text, level: Number(tag[1]) });

    out += html.slice(emitted, lt);
    out += `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
    emitted = matchEnd;
    i = matchEnd;
  }

  out += html.slice(emitted);
  return { html: out, toc };
}
