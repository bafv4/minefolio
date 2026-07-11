// ポップオーバーメニューの共通項目ボタン（block-handle / table-handles で共用）。
// mousedown で発火しエディタのフォーカス・選択を奪わない。
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function MenuItem({
  label,
  icon: Icon,
  danger,
  onClick,
}: {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
        danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted",
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      {label}
    </button>
  );
}
