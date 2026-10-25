import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { Languages } from "lucide-react";

interface AutoTranslateNoticeProps {
  /** true の間は原文を表示している（「翻訳を表示」で訳文に戻せる） */
  showOriginal: boolean;
  onToggle: () => void;
  className?: string;
}

// 自動翻訳した利用者コンテンツの注記と、原文/訳文の切替リンク（docs/translation.md「表示（UX）」）。
// 自動翻訳を著者の言葉として黙って出さないための必須要素。状態は呼び出し側が持つ。
export function AutoTranslateNotice({ showOriginal, onToggle, className }: AutoTranslateNoticeProps) {
  const t = useT();
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground", className)}>
      <Languages className="h-3 w-3 shrink-0" aria-hidden />
      <span>{showOriginal ? t("playerProfile.viewingOriginal") : t("playerProfile.autoTranslated")}</span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onToggle}
        className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        {showOriginal ? t("playerProfile.showTranslation") : t("playerProfile.showOriginal")}
      </button>
    </p>
  );
}
