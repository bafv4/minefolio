import { MinecraftItemIcon, formatItemName, getItemNameJa, type MinecraftItemIconProps } from "@bafv4/mcitems/1.16/react";
import type { Locale } from "@/lib/locale";
import { cn } from "@/lib/utils";

/** アイテムテクスチャ・言語ファイルの配信元（public/mcitems）。loadLang にも同じ値を渡す */
export const TEXTURE_BASE_URL = "/mcitems";

/**
 * テクスチャ読み込み中に表示する円形プログレス。
 * 外枠は size そのままにして、画像に差し替わったときのレイアウトのずれを防ぐ。
 * リング径・線幅はアイコンサイズ（16〜36px 程度）に追従させる。
 * className には消費側が ItemIcon に渡したクラスをそのまま引き継ぐ
 * （MinecraftItemIcon は読み込み中 loadingPlaceholder を className なしの素で返すため、
 * sm:hidden 等の表示切替クラスをここに乗せないと responsive 二重描画の両方の
 * スピナーが同時に見えてしまう）
 */
function ItemIconSpinner({ size, className }: { size: number; className?: string }) {
  const ringSize = Math.max(10, Math.round(size * 0.6));
  const borderWidth = size >= 28 ? 2.5 : size >= 20 ? 2 : 1.5;

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center align-middle", className)}
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

/**
 * アイテム名をアプリの UI ロケール（"en"/"ja"）に合わせて取得する。
 * 英語ロケールは formatItemName の英語表記を優先し、日本語ロケールは和名（getItemNameJa）優先
 * → 無ければ英語にフォールバックする（player/profile.tsx・guide-embeds.tsx で共用）。
 */
export function getLocalizedItemName(itemId: string, locale: Locale): string {
  if (locale === "en") return formatItemName(itemId, "en_us");
  return getItemNameJa(itemId) || formatItemName(itemId);
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
      loadingPlaceholder={loadingPlaceholder ?? <ItemIconSpinner size={size} className={className} />}
      className={cn("pixelated", className)}
      {...props}
    />
  );
}
