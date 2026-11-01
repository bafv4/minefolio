import { Link, useSearchParams } from "react-router";
import { useT } from "@/hooks/use-locale";
import { LOCALE_NAMES, type Locale } from "@/lib/locale";
import { Languages } from "lucide-react";

interface GuideAutoTranslateBannerProps {
  /** 原文のロケール（「原文（日本語）を表示」の表記用） */
  sourceLocale: Locale;
  /** true の間は原文を表示している（「翻訳を表示」で訳文に戻せる） */
  showingOriginal: boolean;
}

// 自動翻訳したガイドの注記と、原文/訳文の切替リンク（docs/translation.md「表示（UX）」）。
// 技術記事は誤訳が意味の反転になりうるため、バナーと原文への切替は必須要素。
// 切替は `?original=1` の有無で行い、ローダーが SSR で出し分ける（共有・再読み込みでも状態が保てる）。
export function GuideAutoTranslateBanner({ sourceLocale, showingOriginal }: GuideAutoTranslateBannerProps) {
  const t = useT();
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  if (showingOriginal) next.delete("original");
  else next.set("original", "1");
  const search = next.toString();
  const language = LOCALE_NAMES[sourceLocale];

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-info/40 bg-info/10 px-3 py-2 text-sm text-foreground">
      <Languages className="h-4 w-4 shrink-0 text-info" aria-hidden />
      <span>
        {showingOriginal
          ? t("guideView.viewingOriginalNotice", { language })
          : t("guideView.autoTranslatedNotice")}
      </span>
      <span aria-hidden className="text-muted-foreground">·</span>
      <Link
        to={{ search: search ? `?${search}` : "" }}
        preventScrollReset
        className="rounded-sm underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {showingOriginal ? t("guideView.showTranslation") : t("guideView.showOriginal", { language })}
      </Link>
    </div>
  );
}
