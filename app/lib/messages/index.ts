import { PAGES_JA } from "./pages-ja";
import { PAGES_EN } from "./pages-en";
import { DEFAULT_LOCALE, type Locale } from "../locale";

type MessageSchema = typeof PAGES_JA;

/**
 * 日本語スキーマの部分集合。英語は段階的に足していくため、
 * 未翻訳のキーがあっても型エラーにしない（キー名の打ち間違いは検出する）。
 */
export type PartialMessages<T> = {
  [K in keyof T]?: T[K] extends string ? string : PartialMessages<T[K]>;
};

// ja は全キーを持つ「基準」であり、同時に未翻訳キーのフォールバック先でもある
const MESSAGES: Record<Locale, PartialMessages<MessageSchema>> = {
  ja: PAGES_JA,
  en: PAGES_EN,
};

export type AppLocale = Locale;

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
export { PAGES_EN } from "./pages-en";
