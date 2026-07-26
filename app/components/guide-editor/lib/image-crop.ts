// 画像トリミングの矩形計算（純粋関数のみ / DOM 非依存）。
//
// 座標は画像サイズに依存しない 0..1 の正規化値で扱う。こうすると
// 画面上の表示（% 指定）と実際の切り出し（px）で同じ値をそのまま使え、
// 表示倍率が変わっても矩形がずれない。実際の切り出しは
// image-processing.ts の cropImageFromUrl が toPixelRect を通して行う。

export interface CropRect {
  /** 左端（0..1） */
  x: number;
  /** 上端（0..1） */
  y: number;
  /** 幅（0..1） */
  width: number;
  /** 高さ（0..1） */
  height: number;
}

/** リサイズハンドルの位置。角は 2 文字、辺は 1 文字 */
export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** 画像全体（＝トリミングなし） */
export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** 切り出し領域の最小辺（正規化値）。潰れた矩形やゼロ除算を防ぐ */
export const MIN_CROP_SIZE = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 0..1 の範囲に収め、最小辺を保証する */
export function clampCropRect(rect: CropRect): CropRect {
  const width = clamp(rect.width, MIN_CROP_SIZE, 1);
  const height = clamp(rect.height, MIN_CROP_SIZE, 1);
  return {
    width,
    height,
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
  };
}

/** 矩形を平行移動する（画像の外へは出さない＝サイズは変わらない） */
export function moveCropRect(rect: CropRect, dx: number, dy: number): CropRect {
  return clampCropRect({ ...rect, x: rect.x + dx, y: rect.y + dy });
}

/**
 * ハンドルのドラッグで矩形をリサイズする。
 *
 * `aspect` は「正規化座標系での 幅/高さ 比」。ピクセル比（16/9 等）から作るには
 * toNormalizedAspect() を通すこと。比率固定時は角ハンドルのみを想定しており
 * （UI 側で辺ハンドルを隠す）、対角のコーナーを固定して幅主導で高さを決める。
 */
export function resizeCropRect(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  aspect: number | null = null,
): CropRect {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");

  if (!aspect) {
    // 自由変形: ドラッグした辺だけを動かす。辺が反転しないよう最小辺で止める
    const newLeft = west ? clamp(left + dx, 0, right - MIN_CROP_SIZE) : left;
    const newRight = east ? clamp(right + dx, newLeft + MIN_CROP_SIZE, 1) : right;
    const newTop = north ? clamp(top + dy, 0, bottom - MIN_CROP_SIZE) : top;
    const newBottom = south ? clamp(bottom + dy, newTop + MIN_CROP_SIZE, 1) : bottom;
    return clampCropRect({
      x: newLeft,
      y: newTop,
      width: newRight - newLeft,
      height: newBottom - newTop,
    });
  }

  // 比率固定: 動かさない側のコーナーをアンカーにする
  const anchorX = west ? right : left;
  const anchorY = north ? bottom : top;

  let width = Math.max(MIN_CROP_SIZE, west ? right - (left + dx) : right + dx - left);
  let height = width / aspect;
  if (height < MIN_CROP_SIZE) {
    height = MIN_CROP_SIZE;
    width = height * aspect;
  }

  // アンカーから画像の端までに収まるよう、比率を保ったまま縮める
  const scale = Math.min(
    1,
    (west ? anchorX : 1 - anchorX) / width,
    (north ? anchorY : 1 - anchorY) / height,
  );
  width *= scale;
  height *= scale;

  return clampCropRect({
    x: west ? anchorX - width : anchorX,
    y: north ? anchorY - height : anchorY,
    width,
    height,
  });
}

/**
 * ピクセル比（16/9 等）を正規化座標系での 幅/高さ 比へ変換する。
 * 正規化系は画像の縦横比の分だけ歪んでいるため、素の比率をそのまま使うと
 * 正方形を指定したのに長方形が切り出される。
 */
export function toNormalizedAspect(
  pixelAspect: number,
  imageWidth: number,
  imageHeight: number,
): number {
  if (imageWidth <= 0 || imageHeight <= 0) return pixelAspect;
  return pixelAspect * (imageHeight / imageWidth);
}

/**
 * 指定比率で画像に収まる最大の矩形を、`around` の中心に合わせて作る。
 * 比率プリセットを選び直したときに、いま見ている位置から大きく飛ばないようにする。
 */
export function fitCropRectToAspect(aspect: number, around: CropRect = FULL_CROP): CropRect {
  let width = 1;
  let height = 1 / aspect;
  if (height > 1) {
    height = 1;
    width = aspect;
  }
  const centerX = around.x + around.width / 2;
  const centerY = around.y + around.height / 2;
  return clampCropRect({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  });
}

/** 正規化矩形を実ピクセルの整数矩形へ（画像の外にはみ出さない / 最低 1px） */
export function toPixelRect(
  rect: CropRect,
  naturalWidth: number,
  naturalHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sx = clamp(Math.round(rect.x * naturalWidth), 0, Math.max(0, naturalWidth - 1));
  const sy = clamp(Math.round(rect.y * naturalHeight), 0, Math.max(0, naturalHeight - 1));
  const sw = clamp(Math.round(rect.width * naturalWidth), 1, naturalWidth - sx);
  const sh = clamp(Math.round(rect.height * naturalHeight), 1, naturalHeight - sy);
  return { sx, sy, sw, sh };
}

/**
 * 実質的にトリミングされているか（＝再エンコードとアップロードの価値があるか）。
 * 全体のままなら適用しても画質が落ちるだけなので、呼び出し側で弾く。
 */
export function isCropped(rect: CropRect, epsilon = 0.001): boolean {
  return (
    rect.x > epsilon ||
    rect.y > epsilon ||
    rect.width < 1 - epsilon ||
    rect.height < 1 - epsilon
  );
}
