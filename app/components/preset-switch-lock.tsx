import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

/**
 * プリセット切替（apply-preset の送信〜loader 再検証）中に、その下のコンテンツ
 * （キーボードビュー・各入力欄）を操作不可にするラッパー。
 * 切替が終わると再検証で新プリセットの内容に置き換わるため、
 * それまでの間の誤操作（古い内容の編集・切替との競合）を防ぐ。
 */
export function PresetSwitchLock({
  locked,
  children,
  className,
}: {
  locked: boolean;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cn("relative", className)} aria-busy={locked}>
      <div
        className={cn(
          "transition-opacity",
          locked && "pointer-events-none select-none opacity-50",
        )}
      >
        {children}
      </div>
      {locked && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
          <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("mePresets.switching")}
          </div>
        </div>
      )}
    </div>
  );
}
