// 初期設定ウィザード（/onboarding）の再開位置の推定。
// 進み具合の列は DB に無いので、保存済みの内容から「どこまで進んだか」を推定する。
// /onboarding の loader と、共通レイアウトの再開案内（routes/_layout.tsx）の両方で使う（.server ではない）。

/** ウィザードのステップ数（ようこそ画面・完了画面は数えない） */
export const ONBOARDING_TOTAL_STEPS = 5;

/** 連携ステップ（ステップ4）で扱うプラットフォーム */
export const ONBOARDING_LINK_PLATFORMS = ["youtube", "twitch", "twitter", "speedruncom"] as const;

export interface OnboardingProgressInput {
  displayName: string | null;
  shortBio: string | null;
  bio: string | null;
  location: string | null;
  pronouns: string | null;
  mcid: string | null;
  bedrockMcid: string | null;
  customSkinUrl: string | null;
  customCapeUrl: string | null;
  /** 保存済みのリンクのプラットフォーム（連携ステップの物だけを数える） */
  linkPlatforms: readonly string[];
}

/**
 * 再開するステップ（1〜5）を返す。入力の痕跡がある最も後のステップの「次」から再開する。
 * - ステップ1: 表示名が Discord の表示名と違う、またはひとこと・自己紹介・所在地・代名詞のどれかがある
 *   （「はじめる」の時点で表示名には Discord の表示名が入るので、それだけでは痕跡にしない）
 * - ステップ2: Java版 / Bedrock版 MCID のどちらかがある
 * - ステップ3: カスタムスキン・カスタムマントのどちらかがある
 * - ステップ4: 連携のリンクが1件以上ある
 * - ステップ5（公開範囲）は選ぶとウィザードが完了するので、未完了なら必ず残っている
 * 何も入れずに進んだ（スキップした）ステップは痕跡が残らないため、そこへ戻ることがある。
 */
export function estimateOnboardingResumeStep(
  user: OnboardingProgressInput,
  discordName: string | null | undefined,
): 1 | 2 | 3 | 4 | 5 {
  const has = (value: string | null | undefined) => !!value?.trim();
  const linkSet = new Set<string>(ONBOARDING_LINK_PLATFORMS);
  if (user.linkPlatforms.some((platform) => linkSet.has(platform))) return 5;
  if (has(user.customSkinUrl) || has(user.customCapeUrl)) return 4;
  if (has(user.mcid) || has(user.bedrockMcid)) return 3;
  const displayNameChanged = has(user.displayName) && user.displayName?.trim() !== (discordName?.trim() ?? "");
  if (displayNameChanged || has(user.shortBio) || has(user.bio) || has(user.location) || has(user.pronouns)) {
    return 2;
  }
  return 1;
}
