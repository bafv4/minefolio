import { cn } from "@/lib/utils";
import { ItemIcon } from "@/components/item-icon";

const SPLIT_MARK_ITEM: Record<string, string> = {
  "Enter Nether": "minecraft:crying_obsidian",
  "Bastion": "minecraft:gold_block",
  "Fortress": "minecraft:nether_bricks",
  "First Portal": "minecraft:ender_eye",
  "Obtain Blaze Rods": "minecraft:blaze_rod",
  "Enter Stronghold": "minecraft:mossy_stone_bricks",
  "Enter End": "minecraft:end_stone",
  "Finish": "minecraft:white_bed",
};

export function PaceManSplitMark({
  timeline,
  size = 16,
  withLabel = true,
  className,
  labelClassName,
}: {
  timeline: string;
  size?: number;
  withLabel?: boolean;
  className?: string;
  labelClassName?: string;
}) {
  const itemId = SPLIT_MARK_ITEM[timeline];

  if (!itemId) {
    return withLabel ? (
      <span className={cn("inline-flex items-center", className)}>
        <span className={cn("leading-none", labelClassName)}>{timeline}</span>
      </span>
    ) : null;
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <ItemIcon itemId={itemId} size={size} className="shrink-0" />
      {withLabel && (
        <span className={cn("leading-none", labelClassName)}>{timeline}</span>
      )}
    </span>
  );
}
