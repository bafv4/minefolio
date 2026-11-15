export function formatTime(ms: number): string {
  // DB の型崩れ（integer 列に文字列が入っている等）や外部APIの欠損値が
  // 「NaN:NaN.NaN」として画面に出ないよう、数値化できない値は "-" に落とす
  // （数値文字列は Number() で従来どおり数値として扱う）
  const totalMs = Number(ms);
  if (!Number.isFinite(totalMs)) return "-";

  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  const milliseconds = totalMs % 1000;

  // 1時間以上は h:mm:ss.mmm（分・秒は2桁ゼロ詰め）。未満は従来の m:ss.mmm
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

export function parseTimeToMs(timeStr: string): number | null {
  // h:mm:ss.mmm / m:ss.mmm / ss.mmm（formatTime の出力と往復できるよう時の桁も受け付ける）
  const match = timeStr.match(/^(?:(?:(\d+):)?(\d+):)?(\d+)\.(\d{3})$/);

  if (!match) {
    return null;
  }

  const hours = parseInt(match[1] || "0");
  const minutes = parseInt(match[2] || "0");
  const seconds = parseInt(match[3]);
  const milliseconds = parseInt(match[4]);

  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

/** UTC の `YYYY-MM-DD`（snapshotDate・recordDate 等の日付キーの形式） */
export function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
