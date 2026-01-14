export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;
  
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
