// ゲーム内感度が有効範囲（0〜200%）外であることを、値の横の警告アイコンで示す表示。
// 一覧（/keybindings の表・カード）とプロフィールの双方から使うため components 直下に置く。
//
// 警告文は `keybindings.sensitivityOutOfRange` 固定（振り向き未計算・統計除外・ソート末尾の理由）。
// ホバー/フォーカス/タップのいずれでも読めるよう、表示は HintTip に委ねる。
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HintTip } from "@/components/hint-tip";
import { useT } from "@/hooks/use-locale";
import { TriangleAlert } from "lucide-react";

export function SensitivityWarning({
  percent,
  children,
  className,
}: {
  /** 表示する感度（%）。表示を差し替えたい場合は children を使う */
  percent?: number | null;
  /** 値の表示を差し替える（percent より優先） */
  children?: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <HintTip
      message={t("keybindings.sensitivityOutOfRange")}
      className={cn("font-mono text-sm", className)}
    >
      {children ?? (
        <span>
          {percent}
          <span className="text-muted-foreground">%</span>
        </span>
      )}
      <TriangleAlert className="h-3.5 w-3.5 text-warning shrink-0" aria-hidden />
    </HintTip>
  );
}
