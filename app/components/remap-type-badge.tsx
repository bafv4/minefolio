import { normalizeKeyRemapType, type KeyRemapType } from "@/lib/remap-utils";
import { cn } from "@/lib/utils";
import { t } from "@/lib/messages";
import { Badge } from "@/components/ui/badge";

const TYPE_STYLES: Record<Exclude<KeyRemapType, "unset">, string> = {
  trigger: "border-primary/40 bg-primary/10 text-primary",
  chat: "border-info/40 bg-info/10 text-info",
  all: "border-border bg-secondary text-secondary-foreground",
};

/**
 * リマップ種別（Trigger/Chat/All）の表示バッジ。
 * unset（未設定）は何も表示しない。
 */
export function RemapTypeBadge({
  remapType,
  className,
}: {
  remapType: string | null | undefined;
  className?: string;
}) {
  const type = normalizeKeyRemapType(remapType);
  if (type === "unset") return null;
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", TYPE_STYLES[type], className)}>
      {t(`remapType.${type}`)}
    </Badge>
  );
}
