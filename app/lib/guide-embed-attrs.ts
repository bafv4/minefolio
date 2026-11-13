// サニタイズ済み本文（js-xss）の HTML 属性値を正規表現で抜いたあとにデコードする。
// js-xss は属性値を HTML エスケープしたまま残す（`A & "B"` → `A &amp; &quot;B&quot;`）ため、
// 生の属性値を DB のプリセット名と比べると一致しない。クライアント／サーバー双方から使うため非 .server。

const NAMED: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
};

/** HTML 属性値の文字参照（名前付き6種・数値参照）を1パスでデコードする（二重デコードしない） */
export function decodeHtmlAttr(value: string): string {
  return value.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, dec, hex, name) => {
    if (name) return NAMED[name] ?? whole;
    const code = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
    try {
      return String.fromCodePoint(code);
    } catch {
      return whole;
    }
  });
}

/** 本文中の `data-preset-name="…"` 属性値をデコードして集める（空は除く） */
export function collectPresetNames(html: string): Set<string> {
  const names = new Set<string>();
  for (const m of html.matchAll(/data-preset-name="([^"]*)"/g)) {
    const name = decodeHtmlAttr(m[1]);
    if (name) names.add(name);
  }
  return names;
}
