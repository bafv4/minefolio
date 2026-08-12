import type { Translator } from "@/lib/messages";

/** users.mainPlatform の許容値（schema.ts と同じ列挙） */
export type MainPlatform =
  | "pc_windows"
  | "pc_mac"
  | "pc_linux"
  | "switch"
  | "mobile"
  | "other";

/**
 * メインプレイ環境（users.mainPlatform）の表示ラベルを一箇所に集約する。
 * - "full"（既定）: プロフィール詳細・設定フォームなど余白のあるコンテキスト向け（例: "PC（Windows）"）
 * - "short": カード・フィルタチップなど密な表示向け（例: "Windows"）
 *
 * 呼び出し側: browse.tsx（フィルタチップ）/ profile-feed-card.tsx（カード）/ profile.tsx（プロフィール詳細）
 */
export function platformLabel(
  t: Translator,
  platform: string | null | undefined,
  variant: "full" | "short" = "full",
): string | null {
  switch (platform) {
    case "pc_windows":
      return variant === "full" ? t("playerProfile.platformPcWindows") : "Windows";
    case "pc_mac":
      return variant === "full" ? t("playerProfile.platformPcMac") : "Mac";
    case "pc_linux":
      return variant === "full" ? t("playerProfile.platformPcLinux") : "Linux";
    case "switch":
      return "Switch";
    case "mobile":
      return "Mobile";
    case "other":
      return t("browse.platformOther");
    default:
      return null;
  }
}
