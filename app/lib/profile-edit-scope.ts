// /me/edit（プロフィール）と /me/account（公開とアカウント）が、保存バーで送るフォーム項目の振り分け。
// 保存本体（app/lib/profile-edit.server.ts の saveProfileBatch）は「送られた項目だけを更新する」ので、
// 各ページは自分の項目だけを送る。ここは振り分けの一覧（`.server` ではない）で、各ページの handleSave が送る項目と
// 一致することを app/routes/me/__tests__/account.test.ts が突き合わせる。項目を足したらここも更新する。
// MCID・Bedrock・リンク・動画の差分は `changes`（JSON）で、/me/edit だけが送る。

/** /me/edit が送るプロフィール列。speedruncomUsername は連携欄が読むだけで、ソーシャルリンクの Speedrun.com から決まる */
export const PROFILE_PAGE_FIELDS = [
  "displayName",
  "displayNameAlphabet",
  "bio",
  "location",
  "pronouns",
  "shortBio",
  "allowAutoTranslation",
  "rtaStartedYearMonth",
  "mainPlatform",
  "role",
  "profilePose",
  "slimSkin",
  "capeDisplay",
  "speedruncomUsername",
] as const;

/** /me/account が送るプロフィール列 */
export const ACCOUNT_PAGE_FIELDS = [
  "profileVisibility",
  "defaultProfileTab",
  "showPacemanOnHome",
  "showTwitchOnHome",
  "showYoutubeOnHome",
  "showRankedStats",
  "showPacemanStats",
] as const;
