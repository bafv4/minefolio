// date-fns の locale を表示ロケールに合わせる。
//
// 各所で `{ locale: ja }` を直に渡していたため、英語UIでも「3日前」「約1か月前」と
// 日本語で出ていた。日付の相対表記は目に付きやすいので、ここに集約する。
import { ja, enUS } from "date-fns/locale";
import type { Locale as DateFnsLocale } from "date-fns";
import type { Locale } from "./locale";

const DATE_LOCALES: Record<Locale, DateFnsLocale> = {
  ja,
  en: enUS,
};

/** `format()` に渡す日付パターン（言語ごとの慣習） */
const DATE_PATTERNS: Record<Locale, string> = {
  ja: "yyyy/MM/dd",
  en: "MMM d, yyyy",
};

/** `Intl` / `toLocaleString` に渡す BCP 47 タグ */
const INTL_LOCALES: Record<Locale, string> = {
  ja: "ja-JP",
  en: "en-US",
};

/** 表示ロケールに対応する `Intl` のロケールタグ */
export function intlLocale(locale: Locale): string {
  return INTL_LOCALES[locale];
}

/** 表示ロケールに対応する date-fns の locale */
export function dateFnsLocale(locale: Locale): DateFnsLocale {
  return DATE_LOCALES[locale];
}

/** `format()` に渡す日付パターン（言語ごとの慣習に合わせる） */
export function dateFormatPattern(locale: Locale): string {
  return DATE_PATTERNS[locale];
}
