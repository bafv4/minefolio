// 表示ロケールの単一情報源（React 非依存。サーバー・クライアント双方から使う）。
//
// 決定順:
//   1. Cookie（minefolio_locale）— 利用者が切替UIで明示的に選んだ値
//   2. Accept-Language — 未選択の訪問者向けの自動判定
//   3. 既定（ja）
//
// 旧 app/lib/i18n.ts の検出を置き換えたもの。旧実装には次の不具合があった:
//   - Cookie を `/minefolio_locale=([^;]+)/` で正規表現照合しており、
//     `xxxminefolio_locale=` のような別名 Cookie にも一致していた
//   - Accept-Language を includes("ja") で見ていたため、
//     `en-US,en;q=0.9,ja;q=0.5`（英語優先）でも日本語と判定していた

export const SUPPORTED_LOCALES = ["ja", "en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** 判定できないときの既定 */
export const DEFAULT_LOCALE: Locale = "ja";

/** 切替UIの表示名（その言語自身の表記） */
export const LOCALE_NAMES: Record<Locale, string> = {
  ja: "日本語",
  en: "English",
};

/**
 * Accept-Language のタグ（小文字）→ 対応ロケール。照合は「タグ全体 → 主部分」の順。
 * 地域・文字種つきのタグを別ロケールへ振り分けたいときに足す
 * （例: 将来 "zh-tw" / "zh-hk" → zh-Hant、"zh" / "zh-cn" → zh-Hans）。
 * 言語を足したら、その言語のタグ（Locale 値そのものも含む）をここへ足す。表に無いタグは未対応扱い。
 */
export const ACCEPT_LANGUAGE_MAP: Readonly<Record<string, Locale>> = {
  ja: "ja",
  en: "en",
};

/** Accept-Language の 1 タグ（小文字）を対応ロケールへ。タグ全体 → 主部分の順に表を引く */
export function matchAcceptLanguageTag(tag: string): Locale | null {
  const full = ACCEPT_LANGUAGE_MAP[tag];
  if (full) return full;
  const primary = tag.split("-")[0];
  const mapped = ACCEPT_LANGUAGE_MAP[primary];
  if (mapped) return mapped;
  // 表に足し忘れても、主部分が Locale 値そのもの（ja / en など）なら拾う
  return isLocale(primary) ? primary : null;
}

/**
 * 利用者コンテンツ（bio・ガイド）の自動翻訳の対象ロケール。UI の SUPPORTED_LOCALES とは独立。
 * UI の言語を足しても、ここを変えない限り翻訳回数（API の費用）は増えない。
 * 翻訳先は「ここに含まれるロケールのうち原文以外」（content-translation.server.ts）。
 */
export const CONTENT_TRANSLATION_LOCALES = ["ja", "en"] as const satisfies readonly Locale[];

export const LOCALE_COOKIE = "minefolio_locale";

/** Cookie の有効期間（1年） */
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Cookie ヘッダーから選択済みロケールを取り出す。
 * 名前は完全一致で比較する（部分一致だと別名 Cookie を拾ってしまう）。
 */
export function parseLocaleCookie(cookieHeader: string | null | undefined): Locale | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== LOCALE_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    if (isLocale(value)) return value;
  }
  return null;
}

/**
 * Accept-Language から対応ロケールを選ぶ。
 * q 値の降順で見て、最初に対応している言語を返す。
 * 各タグは ACCEPT_LANGUAGE_MAP で「タグ全体 → 主部分」の順に照合する（`ja-JP` は主部分の `ja` で解決）。同じ q 値なら記述順を優先する。
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const entries = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const quality = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const q = quality === undefined ? 1 : Number.parseFloat(quality);
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.tag !== "" && entry.q > 0)
    // Array.prototype.sort は安定なので、q が同値なら記述順が保たれる
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    if (tag === "*") return DEFAULT_LOCALE;
    const matched = matchAcceptLanguageTag(tag);
    if (matched) return matched;
  }
  return null;
}

/** リクエストから表示ロケールを決める（Cookie → Accept-Language → 既定） */
export function resolveLocale(request: Request): Locale {
  return (
    parseLocaleCookie(request.headers.get("Cookie")) ??
    parseAcceptLanguage(request.headers.get("Accept-Language")) ??
    DEFAULT_LOCALE
  );
}

/** meta の matches 要素。ルートによっては未解決（undefined）が混ざる */
type MetaMatch = { id: string; loaderData?: unknown; data?: unknown } | undefined;

/**
 * meta 関数からロケールを取り出す（root ローダーが返した値）。
 * meta はフックを使えないため、`matches` 経由で受け取る。
 *
 * ローダーデータの位置は型付き meta（`Route.MetaFunction`）が `loaderData`、
 * 素の `MetaFunction` が `data` と異なるため、両方を見る。
 */
export function localeFromMatches(matches: ReadonlyArray<MetaMatch> | undefined): Locale {
  const root = matches?.find((match) => match?.id === "root");
  const data = (root?.loaderData ?? root?.data) as { locale?: unknown } | undefined;
  return isLocale(data?.locale) ? data.locale : DEFAULT_LOCALE;
}

/**
 * 選択したロケールを保存する Set-Cookie の値。
 * この Cookie はサーバー側（resolveLocale）でのみ読むため常に HttpOnly。
 * Secure は https 配信時だけ付ける（ローカル開発の http では Cookie が保存されなくなるため、
 * 書き込み側で判定して渡す。判定は `request.url` のプロトコルではなく `APP_URL`（環境変数）基準で
 * 行う — ランタイムが `request.url` を https で再構成する前提に依存すると、x-forwarded-proto を
 * 反映しない構成で https 配信時でも Secure なし Cookie を無言で発行してしまうため）。
 */
export function localeCookieValue(locale: Locale, { secure = false }: { secure?: boolean } = {}): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly${secure ? "; Secure" : ""}`;
}
