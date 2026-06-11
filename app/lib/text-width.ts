// 文字の表示幅ユーティリティ（全角=2, 半角=1）。
// keybindings-cells.tsx と virtual-keyboard.tsx に重複していたものを集約。

function isWideChar(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x9fff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

/** 文字列の表示幅（全角=2, 半角=1）を返す。 */
export function getVisualWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    width += isWideChar(char.charCodeAt(0)) ? 2 : 1;
  }
  return width;
}

/** 表示幅 maxWidth を超える場合は末尾を「…」で省略する。 */
export function truncateByVisualWidth(str: string, maxWidth = 10): string {
  if (getVisualWidth(str) <= maxWidth) return str;
  let width = 0;
  let result = "";
  for (const char of str) {
    const charWidth = isWideChar(char.charCodeAt(0)) ? 2 : 1;
    if (width + charWidth > maxWidth - 1) {
      return result + "…";
    }
    result += char;
    width += charWidth;
  }
  return str;
}
