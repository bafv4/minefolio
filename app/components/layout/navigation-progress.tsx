import { useNavigation } from "react-router";
import { useMemo } from "react";
import { Loader2, Lightbulb } from "lucide-react";

// ランダムに表示するTips
const TIPS = [
  "キー配置はプリセットとして保存できます",
  "プレイヤーをお気に入りに追加すると素早くアクセスできます",
  "比較機能で他のプレイヤーと設定を比べられます",
  "サーチクラフトは順番をドラッグで変更できます",
  "アイテム配置は各セグメントごとに設定できます",
  "プロフィールはURLをシェアして共有できます",
  "キーボードビューでキーをクリックすると詳細を編集できます",
  "複数の操作を同じキーに割り当てることもできます",
  "指割り当てを設定するとキーボードビューに色が表示されます",
  "デバイス設定でマウス感度を記録しておくと便利です",
  "記録ページで自己ベストを管理できます",
  "Minecraftの言語設定も記録できます",
  "プリセットを切り替えて複数の設定を管理できます",
  "他のプリセットから設定をコピーすることもできます",
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
