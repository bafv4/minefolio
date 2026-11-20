import { PAGES_JA } from "./pages-ja";
import { DEFAULT_LOCALE, type Locale } from "../locale";

type MessageSchema = typeof PAGES_JA;

/**
 * 日本語スキーマの部分集合。英語は段階的に足していくため、
 * 未翻訳のキーがあっても型エラーにしない（キー名の打ち間違いは検出する）。
 */
export type PartialMessages<T> = {
  [K in keyof T]?: T[K] extends string ? string : PartialMessages<T[K]>;
};

// ja は全キーを持つ「基準」であり、同時に未翻訳キーのフォールバック先でもある。
// ja 以外は遅延読み込み（クライアントの共有チャンクに英語カタログを載せないため）。
// 読み込み済みのロケールだけがここに入る。
export const MESSAGES: Partial<Record<Locale, PartialMessages<MessageSchema>>> = {
  ja: PAGES_JA,
};

// Record<Locale, …> なので、SUPPORTED_LOCALES に言語を足すとここで型エラーになる
const LOADERS: Record<Locale, () => Promise<PartialMessages<MessageSchema>>> = {
  ja: async () => PAGES_JA,
  en: async () => (await import("./pages-en")).PAGES_EN,
};

/**
 * 指定ロケールの文言を読み込んで登録する（読み込み済みなら即時に解決する）。
 *
 * クライアントは、ハイドレーションの前（app/entry.client.tsx）と言語切替の前
 * （useSetLocale）にこれを待つ。未読み込みのまま `t()` を呼ぶと日本語になる。
 */
export async function loadLocaleMessages(locale: Locale): Promise<void> {
  if (MESSAGES[locale]) return;
  MESSAGES[locale] = await LOADERS[locale]();
}

// サーバー（SSR・Vitest）は同期的に全ロケールを引くので、モジュール評価時に読み切る。
// クライアントのビルドでは `import.meta.env.SSR` が false に畳まれ、この分岐ごと消える。
if (typeof import.meta.env === "undefined" || import.meta.env.SSR) {
  await Promise.all((Object.keys(LOADERS) as Locale[]).map(loadLocaleMessages));
}

type NestedMessageKey<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? K
        : `${K}.${NestedMessageKey<T[K]>}`;
    }[keyof T & string];

export type MessageKey = NestedMessageKey<MessageSchema>;

function getNestedValue(obj: unknown, path: string): string | undefined {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);

  return typeof value === "string" ? value : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value == null ? `{${key}}` : String(value);
  });
}

/**
 * 文言を取り出す。
 *
 * **未翻訳のキーは日本語にフォールバックする**（英語化を段階的に進めるため）。
 * 途中の状態でもキー名がそのまま画面に出ることはない。
 *
 * React コンポーネントからは `useT()`（app/hooks/use-locale.tsx）を使うこと。
 * この関数を locale なしで呼ぶと常に日本語になる。ローダーや meta など
 * フックを使えない場所では第3引数にロケールを明示的に渡す。
 */
export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
  locale: Locale = DEFAULT_LOCALE
): string {
  const template =
    (locale === DEFAULT_LOCALE ? undefined : getNestedValue(MESSAGES[locale], key)) ??
    getNestedValue(PAGES_JA, key);
  // undefined 判定にするのは、空文字を「意図的な訳」として扱うため
  // （日本語の助数詞「人」のように、英語では付けないものがある）。
  // falsy 判定にするとキー名が画面に出てしまう。
  if (template === undefined) return key;
  return interpolate(template, params);
}

export function createTranslator(locale: Locale = DEFAULT_LOCALE) {
  return (key: MessageKey, params?: Record<string, string | number>) =>
    t(key, params, locale);
}

/** `createTranslator()` の戻り値。`useT()` もこの型を返す */
export type Translator = ReturnType<typeof createTranslator>;

export { PAGES_JA } from "./pages-ja";
