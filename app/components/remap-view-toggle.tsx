import type { RemapContext } from "@/lib/remap-utils";
import { cn } from "@/lib/utils";
import { t } from "@/lib/messages";

/**
 * 仮想キーボードの Trigger/Chat 表示切替セグメント。
 * プロフィールページと /keybindings カードビューで共用する。
 */
export function RemapViewToggle({
  value,
  onChange,
  className,
}: {
  value: RemapContext;
  onChange: (value: RemapContext) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={t("playerProfile.remapViewLabel")}
      className={cn("flex rounded-lg border bg-card p-0.5 gap-0.5", className)}
    >
      {(["trigger", "chat"] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={value === view}
          onClick={() => onChange(view)}
          className={cn(
            "flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === view
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(`remapType.${view}`)}
        </button>
      ))}
    </div>
  );
}
