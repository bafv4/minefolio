import type { Translator } from "@/lib/messages";

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
      // 設定フォーム（/me/edit）の選択肢と同じ文言（ja「スマホ」・en「Mobile」）
      return t("meEdit.mobile");
    case "other":
      return t("browse.platformOther");
    default:
      return null;
  }
}
