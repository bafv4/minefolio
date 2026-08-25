export function formatTime(ms: number): string {
  // DB の型崩れ（integer 列に文字列が入っている等）や外部APIの欠損値が
  // 「NaN:NaN.NaN」として画面に出ないよう、数値化できない値は "-" に落とす
  // （数値文字列は Number() で従来どおり数値として扱う）
  const totalMs = Number(ms);
  if (!Number.isFinite(totalMs)) return "-";

  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = totalMs % 1000;

  return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

export function parseTimeToMs(timeStr: string): number | null {
  const match = timeStr.match(/^(?:(\d+):)?(\d+)\.(\d{3})$/);
  
  if (!match) {
    return null;
  }
  
  const minutes = parseInt(match[1] || "0");
  const seconds = parseInt(match[2]);
  const milliseconds = parseInt(match[3]);
  
  return (minutes * 60 + seconds) * 1000 + milliseconds;
}
