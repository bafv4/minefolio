import { useEffect, useState } from "react";
import { useT } from "@/hooks/use-locale";

/**
 * ライブ欄の「N秒前に更新」。最後に取得に成功した時刻（checkedAt、ms）からの経過を1秒ごとに再描画する。
 * SSR とのずれを避けるため、マウント前は高さだけ確保して何も描かない。タブ非表示中は再描画を止める。
 * 毎秒変わるので aria-live は付けない。
 * 初回の取得中（pending）も行の高さだけ確保する（取得後に行が差し込まれて区間の帯が下にずれないように）。
 */
export function LiveUpdatedAt({ checkedAt, pending = false }: { checkedAt: number | null; pending?: boolean }) {
  const t = useT();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      stop();
      timer = setInterval(() => setNow(Date.now()), 1000);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (checkedAt === null && !pending) return null;

  let label: string | null = null;
  if (now !== null && checkedAt !== null) {
    const seconds = Math.max(0, Math.floor((now - checkedAt) / 1000));
    label =
      seconds < 60
        ? t("home.liveUpdatedSecondsAgo", { count: seconds })
        : t("home.liveUpdatedMinutesAgo", { count: Math.floor(seconds / 60) });
  }

  return (
    <p className="min-h-4 text-right text-xs text-muted-foreground tabular-nums">
      {label && checkedAt !== null ? (
        <time dateTime={new Date(checkedAt).toISOString()}>{label}</time>
      ) : (
        // マウント前・初回取得中も、確定後と同じ幅を取る（幅0だと折り返しが変わり、行の段数が一瞬ずれる）
        <span aria-hidden="true" className="invisible">
          {t("home.liveUpdatedSecondsAgo", { count: 10 })}
        </span>
      )}
    </p>
  );
}
