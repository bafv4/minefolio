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

// ========================================
// サーチクラフトテンプレート埋め込み（data-sctemplate-embed / data-template-id）
// ========================================
// サニタイザ（.server）・挿入ダイアログ・公開表示の3箇所が使うため、非 .server のここに置く。

/** テンプレート ID の形式（cuid2。既定長 24、最大 32。先頭は英小文字） */
const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9]{19,31}$/;

export function isValidTemplateId(value: unknown): boolean {
  return typeof value === "string" && TEMPLATE_ID_PATTERN.test(value);
}

/**
 * 貼り付けられた文字列（テンプレート ID そのもの、または詳細ページの URL / パス
 * `/guides/templates/:id`）からテンプレート ID を取り出す。取り出せなければ null。
 */
export function parseTemplateIdInput(input: string): string | null {
  const text = input.trim();
  if (isValidTemplateId(text)) return text;
  const match = text.match(/\/guides\/templates\/([a-z0-9]+)(?:[/?#]|$)/);
  return match && isValidTemplateId(match[1]) ? match[1] : null;
}
