import { MinecraftItemIcon, type MinecraftItemIconProps } from "@bafv4/mcitems/1.16/react";
import { cn } from "@/lib/utils";

/** アイテムテクスチャ・言語ファイルの配信元（public/mcitems）。loadLang にも同じ値を渡す */
export const TEXTURE_BASE_URL = "/mcitems";

/**
 * テクスチャ読み込み中に表示する円形プログレス。
 * 外枠は size そのままにして、画像に差し替わったときのレイアウトのずれを防ぐ。
 * リング径・線幅はアイコンサイズ（16〜36px 程度）に追従させる
 */
function ItemIconSpinner({ size }: { size: number }) {
  const ringSize = Math.max(10, Math.round(size * 0.6));
  const borderWidth = size >= 28 ? 2.5 : size >= 20 ? 2 : 1.5;

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center align-middle"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span
        className="block animate-spin rounded-full border-muted-foreground/20 border-t-muted-foreground/70"
        style={{ width: ringSize, height: ringSize, borderWidth, borderStyle: "solid" }}
      />
    </span>
  );
}

export type ItemIconProps = Omit<MinecraftItemIconProps, "textureBaseUrl">;

/**
 * Minecraft アイテムアイコン。テクスチャ配信元・ピクセル描画・読み込み中の
 * 円形プログレス表示を既定にしたアプリ共通ラッパー。
 * アイコンを出す箇所はすべてこれを使う（素の MinecraftItemIcon は直接使わない）
 */
export function ItemIcon({
  size = 24,
  className,
  loadingPlaceholder,
  ...props
}: ItemIconProps) {
  return (
    <MinecraftItemIcon
      size={size}
      textureBaseUrl={TEXTURE_BASE_URL}
      loadingPlaceholder={loadingPlaceholder ?? <ItemIconSpinner size={size} />}
      className={cn("pixelated", className)}
      {...props}
    />
  );
}
