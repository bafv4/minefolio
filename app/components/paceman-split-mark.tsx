import { cn } from "@/lib/utils";

// アイテム名辞書を含む item-icon チャンクをホーム・/paces に引き込まないよう、ItemIcon を使わず
// 静的な <img> で描く（区間アイコンは下の8個に固定）。配信元は item-icon.tsx の TEXTURE_BASE_URL と
// 同じ /mcitems（値を import すると item-icon チャンクごと読み込まれるため、ここに複製している）
const TEXTURE_BASE_URL = "/mcitems";
const TEXTURE_PATH = "1.16.1/items";

function splitMarkTextureUrl(itemId: string): string {
  return `${TEXTURE_BASE_URL}/${TEXTURE_PATH}/${itemId.replace("minecraft:", "minecraft_")}.png`;
}

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
      <img
        src={splitMarkTextureUrl(itemId)}
        alt={itemId}
        width={size}
        height={size}
        loading="lazy"
        className="pixelated shrink-0"
        style={{ width: size, height: size, imageRendering: "pixelated" }}
      />
      {withLabel && (
        <span className={cn("leading-none", labelClassName)}>{timeline}</span>
      )}
    </span>
  );
}
