// Minecraft スキンテクスチャの頭部領域と旧形式スキンの帽子判定（DOM・pngjs 非依存の純関数）。
// クライアント（avatar-cache）とサーバー（skin-face.server）の両方から使うため `.server` にしない。

export interface TextureRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** スキン幅から 64 基準の倍率を求める（64→1、128→2）。幅が不正（0 以下・非有限）なら 1 */
export function skinScale(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return width / 64;
}

function scaleRegion(region: TextureRegion, scale: number): TextureRegion {
  return {
    x: Math.round(region.x * scale),
    y: Math.round(region.y * scale),
    w: Math.max(1, Math.round(region.w * scale)),
    h: Math.max(1, Math.round(region.h * scale)),
  };
}

/** 頭の正面（64 基準で (8,8) から 8x8）の切り出し領域。HD スキンでは倍率分だけ拡大した位置になる */
export function headBaseRegion(skinWidth: number): TextureRegion {
  return scaleRegion({ x: 8, y: 8, w: 8, h: 8 }, skinScale(skinWidth));
}

/** 帽子レイヤー（64 基準で (40,8) から 8x8）の切り出し領域 */
export function headOverlayRegion(skinWidth: number): TextureRegion {
  return scaleRegion({ x: 40, y: 8, w: 8, h: 8 }, skinScale(skinWidth));
}

/** 旧形式（64x32 系: 幅が高さのちょうど2倍）のスキンか */
export function isLegacySkin(width: number, height: number): boolean {
  return width > 0 && width === height * 2;
}

/**
 * 旧形式スキンで帽子レイヤーを描かないべきか。
 * Minecraft 本体は旧形式スキンの読み込み時に doNotchTransparencyHack を適用する。
 * 右半分（x ∈ [width/2, width)、全高）に alpha < 128 の画素が1つでもあれば何もしないが、
 * 1つも無ければその領域全体を透明扱いにする。旧形式の帽子が不透明な黒で塗られている
 * スキンが顔を真っ黒にしないよう、同じ判定で帽子を省く。64x64 以上の新形式には適用されない。
 */
export function shouldHideLegacyHat(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): boolean {
  if (!isLegacySkin(width, height)) return false;
  for (let y = 0; y < height; y++) {
    for (let x = width / 2; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] < 128) return false;
    }
  }
  return true;
}
