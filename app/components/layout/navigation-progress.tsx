import { useNavigation, useLocation } from "react-router";
import { useMemo, useRef } from "react";
import { Loader2, Lightbulb } from "lucide-react";
import { inSameTabGroup } from "@/lib/tab-nav-groups";
import { useT } from "@/hooks/use-locale";
import type { MessageKey } from "@/lib/messages";

// ランダムに表示する Tips。
// アプリの使い方に関するものは翻訳する（文言は pages-ja.ts / pages-en.ts）。
const TIP_KEYS = [
  "loadingTips.presets",
  "loadingTips.favorites",
  "loadingTips.speedruncom",
  "loadingTips.twitch",
  "loadingTips.multiplePresets",
  "loadingTips.multipleActions",
  "loadingTips.keyboardView",
  "loadingTips.markdownBio",
  "loadingTips.fingerColors",
  "loadingTips.feedback",
] as const satisfies readonly MessageKey[];

// Minecraft のスプラッシュテキストを踏まえたお遊びの文言。
// 元ネタの語感がすべてなので、どのロケールでも**原文のまま**出す（翻訳対象外）。
const SPLASH_TIPS = [
  "ネザーではいまFastionがトレンドです。",
  "Supercalifragilisticexpialidocious!",
  "Now Java 17+!",
  "日本ハロー！",
];

export function NavigationProgress() {
  const t = useT();
  const navigation = useNavigation();
  const location = useLocation();
  const isNavigating = navigation.state === "loading";

  // 同じパス内のナビゲーション（検索・フィルタ等）ではフルスクリーンローディングを表示しない
  const isSamePageNavigation =
    isNavigating &&
    navigation.location &&
    navigation.location.pathname === location.pathname;

  // タブ型ルート間の切替（/keybindings ⇄ /visual 等）はページ側がタブ内スケルトンを
  // 表示するため、フルスクリーンローディングは出さない
  const isTabGroupNavigation =
    isNavigating &&
    !!navigation.location &&
    inSameTabGroup(location.pathname, navigation.location.pathname);

  // ランダムなTipを選択（ナビゲーション開始時に固定）。
  // 翻訳対象のヒントとスプラッシュ文言を同じ確率で混ぜる
  const tip = useMemo(() => {
    const index = Math.floor(Math.random() * (TIP_KEYS.length + SPLASH_TIPS.length));
    return index < TIP_KEYS.length
      ? t(TIP_KEYS[index])
      : SPLASH_TIPS[index - TIP_KEYS.length];
  }, [isNavigating]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isNavigating || isSamePageNavigation || isTabGroupNavigation) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 p-6 max-w-sm text-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-lg font-medium">{t("loading.page")}</p>
        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-secondary/50 rounded-lg p-3">
          <Lightbulb className="h-4 w-4 shrink-0 mt-0.5 text-yellow-500" />
          <p className="text-left">{tip}</p>
        </div>
      </div>
    </div>
  );
}
