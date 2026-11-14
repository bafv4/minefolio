// ホームの表示用整形（クライアント・サーバー共用の純粋関数）。
// ホームの時刻は m:ss（1時間以上は h:mm:ss）に統一する。ミリ秒はタイムラインのモーダル内だけで使う。

/** ミリ秒を "m:ss"（1時間以上は "h:mm:ss"）に変換。数値化できない値は "-" */
export function formatClock(ms: number): string {
  const total = Number(ms);
  if (!Number.isFinite(total) || total < 0) return "-";
  const totalSeconds = Math.floor(total / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

/** 秒を "h:mm:ss"（アーカイブの長さ用。1時間未満は "m:ss"） */
export function formatClockSeconds(totalSeconds: number): string {
  return formatClock(totalSeconds * 1000);
}

/** 読み上げ用に分・秒へ分解する */
export function splitMinutesSeconds(ms: number): { minutes: number; seconds: number } {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}
