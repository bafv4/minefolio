import { useNavigation, useLocation } from "react-router";
import { useEffect, useMemo, useState } from "react";
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

/** この時間より長くかかる遷移でだけ全面の読み込み表示を出す（速い遷移ではちらつかせない） */
const SHOW_DELAY_MS = 300;
/** Tips はさらに待たされたときだけ（読める時間があるときだけ）出す */
const TIP_DELAY_MS = 1000;

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

  const active = isNavigating && !isSamePageNavigation && !isTabGroupNavigation;

  const [visible, setVisible] = useState(false);
  const [tipVisible, setTipVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      setTipVisible(false);
      return;
    }
    const showTimer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    const tipTimer = window.setTimeout(() => setTipVisible(true), TIP_DELAY_MS);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(tipTimer);
    };
  }, [active]);

  // 外枠（ライブリージョン）は常に描き、中身だけ遅らせて出す。出た時に「読み込み中」が読み上げられる
  return (
    <div role="status" aria-live="polite">
      {active && visible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="flex flex-col items-center gap-4 p-6 max-w-sm text-center">
            <Loader2 className="h-10 w-10 animate-spin motion-reduce:animate-none text-primary" aria-hidden />
            <p className="text-lg font-medium">{t("loading.page")}</p>
            {tipVisible && (
              <div
                aria-hidden
                className="flex items-start gap-2 text-sm text-muted-foreground bg-secondary/50 rounded-lg p-3"
              >
                <Lightbulb className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
                <p className="text-left">{tip}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
