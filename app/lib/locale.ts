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
 * q 値の降順で見て、最初に対応している言語を返す（`ja-JP` のような
 * 地域つきタグは主部分だけで判定する）。同じ q 値なら記述順を優先する。
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
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
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

/** 選択したロケールを保存する Set-Cookie の値 */
export function localeCookieValue(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
