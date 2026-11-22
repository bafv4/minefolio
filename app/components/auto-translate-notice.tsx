import { Link, type To } from "react-router";
import { NoticeBanner } from "@/components/notice-banner";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { Languages } from "lucide-react";

interface AutoTranslateNoticeProps {
  /** true の間は原文を表示している（「翻訳を表示」で訳文に戻せる） */
  showOriginal: boolean;
  /** 切替をクライアント状態で行う場合のハンドラ（プロフィール）。`to` とどちらか一方を渡す */
  onToggle?: () => void;
  /** 切替を URL（例: `?original=1`）で行う場合の遷移先（ガイド。ローダーが SSR で出し分ける） */
  to?: To;
  className?: string;
}

// 自動翻訳した利用者コンテンツの注記と、原文/訳文の切替導線（docs/translation.md「表示（UX）」）。
// ガイド・プロフィール共通。自動翻訳を著者の言葉として黙って出さないための必須要素。
// 状態は呼び出し側が持つ（`onToggle` ならボタン、`to` ならリンクで切り替える）。
export function AutoTranslateNotice({ showOriginal, onToggle, to, className }: AutoTranslateNoticeProps) {
  const t = useT();
  const actionClass =
    "rounded-sm underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const actionLabel = showOriginal ? t("playerProfile.showTranslation") : t("playerProfile.showOriginal");
  return (
    <NoticeBanner tone="info" icon={Languages} className={cn("w-fit max-w-full px-3 py-1.5 text-xs", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span>{showOriginal ? t("playerProfile.viewingOriginal") : t("playerProfile.autoTranslated")}</span>
      <span aria-hidden className="text-muted-foreground">·</span>
      {to !== undefined ? (
        <Link to={to} preventScrollReset className={actionClass}>
          {actionLabel}
        </Link>
      ) : (
        <button type="button" onClick={onToggle} className={actionClass}>
          {actionLabel}
        </button>
      )}
      </div>
    </NoticeBanner>
  );
}
