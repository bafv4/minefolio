// マウス設定の値表示のうち、/keybindings の一覧セルとプロフィールの
// デバイス欄が同じ見た目・同じ方針で出すべき部分の共有部品。
// 理由の導出は @/lib/mouse-settings-reasons、警告の見せ方は HintTip に委ねる。
import { cn } from "@/lib/utils";
import { WINDOWS_POINTER_MULTIPLIERS } from "@/lib/mouse-settings";
import { joinMouseReasons } from "@/lib/mouse-settings-reasons";
import { HintTip } from "@/components/hint-tip";
import { useT } from "@/hooks/use-locale";
import { TriangleAlert } from "lucide-react";

/**
 * 値が出せないときの「-」。理由があればヒントで示し、無ければ素の「-」を出す。
 * 理由が無い＝そもそもマウス設定が未登録のケース（説明することが無い）。
 */
export function MissingMouseValue({
  reasons,
  className,
}: {
  reasons: string[];
  className?: string;
}) {
  if (reasons.length === 0) {
    return <span className="text-muted-foreground/40">-</span>;
  }
  return (
    <HintTip
      message={joinMouseReasons(reasons)}
      className={cn("text-muted-foreground/60", className)}
    >
      <span className="underline decoration-dotted underline-offset-4">-</span>
    </HintTip>
  );
}

/**
 * Win Sens の値。係数テーブル（1〜20）内なら乗数を併記し、
 * テーブル外は x1.000 と断定せず警告を出す（振り向き・Cursor Speed も計算されない理由）。
 */
export function WinSensValue({
  windowsSpeed,
  className,
  multiplierClassName = "text-muted-foreground",
}: {
  windowsSpeed: number;
  className?: string;
  multiplierClassName?: string;
}) {
  const t = useT();
  const multiplier = WINDOWS_POINTER_MULTIPLIERS[windowsSpeed];
  if (multiplier == null) {
    return (
      <HintTip
        message={t("keybindings.windowsSpeedUnknown", { value: windowsSpeed })}
        className={className}
      >
        <span>{windowsSpeed}</span>
        <TriangleAlert className="h-3.5 w-3.5 text-warning shrink-0" aria-hidden />
      </HintTip>
    );
  }
  return (
    <span className={className}>
      {windowsSpeed}
      <span className={multiplierClassName}>(x{multiplier.toFixed(3)})</span>
    </span>
  );
}
