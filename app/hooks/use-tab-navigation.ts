import { useLocation, useNavigation } from "react-router";
import { inSameTabGroup } from "@/lib/tab-nav-groups";

/**
 * タブ型ルート間のナビゲーション状態。
 * - targetPathname: ローディング中の遷移先パス（なければ null）
 * - isTabSwitching: 同一タブグループ内の別タブへ遷移中か。
 *   true の間、ページはコンテンツ領域をスケルトンに差し替える
 *   （全画面ローディングは NavigationProgress 側で抑止される）
 */
export function useTabNavigation() {
  const navigation = useNavigation();
  const location = useLocation();
  const targetPathname =
    navigation.state === "loading" ? (navigation.location?.pathname ?? null) : null;
  const isTabSwitching =
    !!targetPathname && inSameTabGroup(location.pathname, targetPathname);
  return { targetPathname, isTabSwitching };
}
