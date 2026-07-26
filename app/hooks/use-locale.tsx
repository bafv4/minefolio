// 表示ロケールを React ツリーへ配る。
//
// `t()`（app/lib/messages）はモジュールレベルの純粋関数で、locale を渡さないと
// 常に日本語になる。コンポーネントからは必ずこの `useT()` を使うこと。
//
// ロケールは root ローダーが決めて（app/lib/locale.ts の resolveLocale）
// Provider へ渡す。SSR とクライアントで同じ値になるため、ハイドレーション
// 不一致は起きない。
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { createTranslator, type Translator } from "@/lib/messages";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** 現在の表示ロケール */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * 現在のロケールに束縛された `t`。
 *
 * ```tsx
 * const t = useT();
 * return <h1>{t("guides.pageTitle")}</h1>;
 * ```
 *
 * 未翻訳のキーは日本語へフォールバックする（messages/index.ts）。
 */
export function useT(): Translator {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}

/**
 * 表示ロケールを切り替える。
 *
 * 文言はサーバー（root ローダー）で決まるため、クライアント state を書き換えるだけでは
 * 切り替わらない。Cookie を保存して再検証させることで、全ローダーが新しい
 * ロケールで再実行される。
 */
export function useSetLocale(): (locale: Locale) => void {
  const fetcher = useFetcher();
  const current = useLocale();

  return useCallback(
    (locale: Locale) => {
      if (locale === current) return;
      fetcher.submit({ locale }, { method: "post", action: "/api/set-locale" });
    },
    [fetcher, current],
  );
}
