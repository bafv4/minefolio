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
// 本文先頭のタイトルの見出しの判定（guide-view-html.ts の stripLeadingTitleHeading）も同じ正規化で比べる。
export function headingText(inner: string): string {
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

/** 先頭の最上位項目より前にある下位見出しの塊の節キー（見出しが無いので開閉ボタンは持たない） */
export const TOC_LEAD_SECTION = "";

/**
 * 各項目が属する節のキーを items と同じ順で返す。
 * 節は最上位（items の最小 level）の項目ごとに始まり、キーはその項目の id。
 * 先頭の最上位項目より前の下位見出しは `TOC_LEAD_SECTION`。
 */
export function tocSectionKeys(items: TocItem[]): string[] {
  if (items.length === 0) return [];
  const topLevel = Math.min(...items.map((i) => i.level));
  let key = TOC_LEAD_SECTION;
  return items.map((item) => {
    if (item.level === topLevel) key = item.id;
    return key;
  });
}

/**
 * 配下を持つ節すべてを `open` に揃える overrides を作る（「すべて開く／閉じる」用）。
 * 配下を持たない節と先頭の孤立した下位見出しの塊（`TOC_LEAD_SECTION`）は含めない。
 * 空オブジェクトなら、開閉できる節が無い（ボタンを出さない）。
 */
export function tocAllSectionOverrides(
  items: TocItem[],
  open: boolean,
): Record<string, boolean> {
  const topLevel = items.length === 0 ? 0 : Math.min(...items.map((i) => i.level));
  const keys = tocSectionKeys(items);
  const result: Record<string, boolean> = {};
  items.forEach((item, idx) => {
    if (item.level !== topLevel && keys[idx] !== TOC_LEAD_SECTION) result[keys[idx]] = open;
  });
  return result;
}

/**
 * 目次に表示する項目を返す（折りたたみ）。
 * - 最上位（items の最小 level）は常に表示する。
 * - それより下の階層は、節（最上位項目から次の最上位項目の手前まで）が開いているときだけ表示する。
 *   既定では、アクティブな見出しを含む節だけが開く。
 *   ただし最上位の項目が1つだけの目次（本文全体を1つの見出しの下にまとめた形。タイトルと同じ文の先頭の見出しは表示時に取り除く）は、
 *   その節を既定で開く（畳むと目次が1行だけになり、目次の役に立たないため）。
 * - `overrides`（節キー → 開閉）は既定より優先する。利用者が手で開閉した節の分
 *   （先頭の孤立した下位見出しの塊 `TOC_LEAD_SECTION` はボタンが無いので対象外）。
 * - アクティブ項目そのものは、上の規則で畳まれていなければ見える。
 * 順序は items のまま。activeId が null / 未知なら最上位のみ（overrides で開いた節と、最上位が1つだけの節を除く）。
 */
export function visibleTocItems(
  items: TocItem[],
  activeId: string | null,
  overrides: Readonly<Record<string, boolean>> = {},
): TocItem[] {
  if (items.length === 0) return [];
  const topLevel = Math.min(...items.map((i) => i.level));
  const keys = tocSectionKeys(items);
  const activeIndex = activeId === null ? -1 : items.findIndex((i) => i.id === activeId);
  const activeKey = activeIndex === -1 ? null : keys[activeIndex];
  const topItems = items.filter((i) => i.level === topLevel);
  // 最上位が1つだけなら、その節は既定で開く（先頭の孤立した下位見出しの塊は従来どおり）
  const defaultOpenKey = topItems.length === 1 ? topItems[0].id : null;

  return items.filter((item, idx) => {
    if (item.level === topLevel) return true;
    const key = keys[idx];
    if (key !== TOC_LEAD_SECTION && key in overrides) return overrides[key];
    return key === activeKey || key === defaultOpenKey;
  });
}

/**
 * 目次で現在地として強調する項目の id。
 * アクティブ項目が畳まれた節の中にあるとき（見えていないとき）は、その節の最上位項目を返す。
 */
export function tocDisplayedActiveId(
  items: TocItem[],
  visible: TocItem[],
  activeId: string | null,
): string | null {
  if (activeId === null) return null;
  if (visible.some((i) => i.id === activeId)) return activeId;
  const index = items.findIndex((i) => i.id === activeId);
  if (index === -1) return null;
  return tocSectionKeys(items)[index] || null;
}
