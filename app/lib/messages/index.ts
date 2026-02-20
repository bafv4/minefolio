import { PAGES_JA } from "./pages-ja";

const MESSAGES = {
  ja: PAGES_JA,
} as const;

export type AppLocale = keyof typeof MESSAGES;
type MessageSchema = typeof PAGES_JA;

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

export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
  locale: AppLocale = "ja"
): string {
  const template = getNestedValue(MESSAGES[locale], key);
  if (!template) return key;
  return interpolate(template, params);
}

export function createTranslator(locale: AppLocale = "ja") {
  return (key: MessageKey, params?: Record<string, string | number>) =>
    t(key, params, locale);
}

export { PAGES_JA } from "./pages-ja";
