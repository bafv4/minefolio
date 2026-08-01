// プロフィールの「デフォルト表示タブ」の値リスト。schema.ts の defaultProfileTab enum と
// me/edit.tsx（action の検証・Select の選択肢）が別々に値リストを持つと同期が崩れやすいため、
// タブ値の単一情報源としてここに集約する。値・順序は schema.ts の enum 定義に合わせる。
export const PROFILE_TAB_VALUES = [
  "profile",
  "stats",
  "keybindings",
  "items",
  "searchcraft",
  "devices",
  // @deprecated 過去に存在したゲーム内設定タブの残置 enum 値。UI 上に対応するタブは存在しない
  // （DB 列はドロップせず残置。docs/profiles.md「プロフィール表示タブ」参照）
  "settings",
  "playstyle",
] as const;

export type ProfileTabValue = (typeof PROFILE_TAB_VALUES)[number];

// 既定タブとして選択可能な値（me/edit.tsx の Select に列挙する集合・順序）。
// "settings"（廃止 enum 値）と "guides"（プロフィールページ上のタブだが既定タブには選べない）は含まない。
export const SELECTABLE_PROFILE_TABS = [
  "profile",
  "stats",
  "playstyle",
  "keybindings",
  "devices",
  "items",
  "searchcraft",
] as const satisfies readonly ProfileTabValue[];

export type SelectableProfileTabValue = (typeof SELECTABLE_PROFILE_TABS)[number];

export function isSelectableProfileTab(value: unknown): value is SelectableProfileTabValue {
  return (
    typeof value === "string" &&
    (SELECTABLE_PROFILE_TABS as readonly string[]).includes(value)
  );
}
