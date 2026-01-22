import { useNavigation } from "react-router";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function NavigationProgress() {
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isNavigating) {
      setVisible(true);
      setProgress(0);

      // 徐々に進行度を上げる（最大90%まで）
      const timer1 = setTimeout(() => setProgress(30), 100);
      const timer2 = setTimeout(() => setProgress(60), 300);
      const timer3 = setTimeout(() => setProgress(80), 600);
      const timer4 = setTimeout(() => setProgress(90), 1000);

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
        clearTimeout(timer4);
      };
    } else if (visible) {
      // 完了時に100%にしてからフェードアウト
      setProgress(100);
      const hideTimer = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 200);

      return () => clearTimeout(hideTimer);
    }
  }, [isNavigating, visible]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-1 bg-transparent">
      <div
        className={cn(
          "h-full bg-primary transition-all duration-200 ease-out",
          progress === 100 && "opacity-0"
        )}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
