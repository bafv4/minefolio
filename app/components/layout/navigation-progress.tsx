import { useNavigation } from "react-router";
import { useMemo } from "react";
import { Loader2, Lightbulb } from "lucide-react";

// ランダムに表示するTips
const TIPS = [
  "キー配置・デバイス設定・アイテム配置・サーチクラフトはプリセットとしてまとめることができます。",
  "プレイヤーはプロフィールの♡ボタンでお気に入りに登録することができます！",
  "Speedrun.comのユーザー名を登録すると、活動・記録画面に自動で記録が表示されるようになります。",
  "Twitchのユーザー名を登録すると、配信がホーム画面に表示されるようになります。",
  "設定プリセットは複数登録できます。",
  "複数の操作を1つのキーに割り当てることが可能です。",
  "キーボードビューでキーをクリックすると詳細を確認・編集できます。",
  "自己紹介欄ではMarkdownを使用できます。",
  "ネザーではいまFastionがトレンドです。",
  "Supercalifragilisticexpialidocious!",
  "指割り当てを設定するとキーボードビューに色が表示されます。",
  "なにか改善してほしいところがある場合は、制作者@bafv4まで遠慮なくご連絡ください！",
  "Now Java 17+!",
  "日本ハロー！",
];

export function NavigationProgress() {
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

  // ランダムなTipを選択（ナビゲーション開始時に固定）
  const tip = useMemo(() => {
    return TIPS[Math.floor(Math.random() * TIPS.length)];
  }, [isNavigating]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isNavigating) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 p-6 max-w-sm text-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-lg font-medium">読み込み中...</p>
        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-secondary/50 rounded-lg p-3">
          <Lightbulb className="h-4 w-4 shrink-0 mt-0.5 text-yellow-500" />
          <p className="text-left">{tip}</p>
        </div>
      </div>
    </div>
  );
}
