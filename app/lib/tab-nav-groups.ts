/**
 * 「タブとして振る舞うルート」のグループ定義。
 * 同一グループ内のルート間ナビゲーションは、全画面ローディング
 * （NavigationProgress）ではなくタブ内スケルトンで表現する。
 */
export const TAB_NAV_GROUPS: string[][] = [
  ["/keybindings", "/keybindings/visual", "/keybindings/stats"],
  ["/guides", "/guides/templates"],
  ["/my-guides", "/my-guides/templates"],
];

/** 2つのパスが同一タブグループ内の「別タブ」への移動かどうか */
export function inSameTabGroup(a: string, b: string): boolean {
  if (a === b) return false;
  return TAB_NAV_GROUPS.some((group) => group.includes(a) && group.includes(b));
}
