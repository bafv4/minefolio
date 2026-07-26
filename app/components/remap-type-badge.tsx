import { normalizeKeyRemapType, type KeyRemapType } from "@/lib/remap-utils";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
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
  const t = useT();
  const type = normalizeKeyRemapType(remapType);
  if (type === "unset") return null;
  return (
    <Badge
      variant="outline"
      // 種別ラベル(All/Trigger/Chat)は幅がまちまちなので min-w で統一し中央寄せ。
      // 3rem(48px) は最大ラベル "Trigger"(≈46.3px @ text-[10px]) を収める最小値。
      className={cn(
        "min-w-[3rem] justify-center text-[10px] px-1.5 py-0",
        TYPE_STYLES[type],
        className,
      )}
    >
      {t(`remapType.${type}`)}
    </Badge>
  );
}
