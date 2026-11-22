import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  warning: "border-warning/40 bg-warning/10",
  success: "border-success/30 bg-success/10",
  error: "border-destructive/30 bg-destructive/10",
  info: "border-info/30 bg-info/10",
} as const;

const ICON_CLASS = {
  warning: "text-warning",
  success: "text-success",
  error: "text-destructive",
  info: "text-info",
} as const;

export type NoticeTone = keyof typeof TONE_CLASS;

/**
 * 通知帯（警告・成功・失敗・情報）。`rounded-xl`・`text-sm`・意味色の面 /10 と枠。
 * 文字は前景色のまま、意味はアイコン（任意）の色と枠で伝える。
 * - `error` と `warning` は割り込みの通知なので既定の role を `alert` / `status` にする。上書きは `role`
 * - 余白を詰めたいときは `className`（例: `px-3 py-2`）
 */
export function NoticeBanner({
  tone,
  icon: Icon,
  role,
  id,
  tabIndex,
  className,
  children,
}: {
  tone: NoticeTone;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  role?: "status" | "alert";
  /** フォーカスの移動先にするときの id（`tabIndex={-1}` と組で使う） */
  id?: string;
  tabIndex?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      tabIndex={tabIndex}
      role={role ?? (tone === "error" ? "alert" : "status")}
      className={cn("flex items-start gap-2 rounded-xl border px-4 py-3 text-sm", TONE_CLASS[tone], className)}
    >
      {Icon && <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ICON_CLASS[tone])} aria-hidden />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
