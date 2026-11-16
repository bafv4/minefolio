import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 状態の印の丸ピル（ui.md 6 章「丸ピル」）。件数・公開状態などの短い印に使う。
 * - `icon`: 先頭のアイコン（飾りなので aria-hidden、大きさは h-3 w-3）
 * - `tone="warning"`: 注意が要る状態（例: 未保存の変更あり）。枠と文字を warning 色にする
 */
export function StatusPill({
  icon: Icon,
  tone = "default",
  className,
  children,
}: {
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: "default" | "warning";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-background/75 px-2.5 py-1 text-xs",
        tone === "warning" ? "border-warning/40 text-warning" : "border-border/70 text-muted-foreground",
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  );
}
