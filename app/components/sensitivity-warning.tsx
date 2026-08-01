// ゲーム内感度が有効範囲（0〜200%）外であることを、値の横の警告アイコンで示す表示。
// 一覧（/keybindings の表・カード）とプロフィールの双方から使うため components 直下に置く。
//
// 警告文は `keybindings.sensitivityOutOfRange` 固定（振り向き未計算・統計除外・ソート末尾の理由）。
// ホバー/フォーカス/タップのいずれでも読めるよう、表示は HintTip に委ねる。
import { HintTip } from "@/components/hint-tip";
import { useT } from "@/hooks/use-locale";
import { TriangleAlert } from "lucide-react";

export function SensitivityWarning({
  percent,
}: {
  /** 表示する感度（%） */
  percent: number | null;
}) {
  const t = useT();
  return (
    <HintTip
      message={t("keybindings.sensitivityOutOfRange")}
      className="font-mono text-sm"
    >
      <span>
        {percent}
        <span className="text-muted-foreground">%</span>
      </span>
      <TriangleAlert className="h-3.5 w-3.5 text-warning shrink-0" aria-hidden />
    </HintTip>
  );
}
