// Minecraftスキンの「顔」（頭の正面 + 帽子レイヤー）をサーバー側で合成する。
// アプリ一覧の顔アバター（app/lib/avatar-cache.ts の composite）と同じ見た目を、
// WebGL/canvas の無い OGP 生成環境（satori）向けに純JSのラスター処理で再現する。

import { PNG } from "pngjs";

// スキンテクスチャ内の頭部の領域（64x64 / 64x32 どちらでも同座標）
const HEAD_BASE = { x: 8, y: 8, w: 8, h: 8 };
const HEAD_OVERLAY = { x: 40, y: 8, w: 8, h: 8 };

// アプリ一覧と同じフォールバック用 Steve UUID（MCID未登録・スキン解決失敗時）
const STEVE_UUID = "8667ba71b85a4004af54457a9734eed7";

/** 8x8領域を size×size にニアレストネイバー拡大したときの、出力(ox,oy)に対応する元ピクセルのインデックス */
function sampleIndex(
  region: { x: number; y: number; w: number; h: number },
  skinWidth: number,
  ox: number,
  oy: number,
  size: number,
): number {
  const sx = region.x + Math.min(region.w - 1, Math.floor((ox / size) * region.w));
  const sy = region.y + Math.min(region.h - 1, Math.floor((oy / size) * region.h));
  return (sy * skinWidth + sx) * 4;
}

/**
 * スキンPNGバイト列から顔（正面 + 帽子レイヤーをアルファ合成）を size×size で描画し、PNGバイト列を返す。
 * ピクセルはニアレストネイバーで拡大するため、アプリと同じくドット感を保つ。
 */
export function renderSkinFacePng(skinBytes: Uint8Array, size: number): Buffer {
  const skin = PNG.sync.read(Buffer.from(skinBytes));
  const out = new PNG({ width: size, height: size });

  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      const oi = (oy * size + ox) * 4;

      // ベース（頭の正面。通常は不透明）
      const bi = sampleIndex(HEAD_BASE, skin.width, ox, oy, size);
      let r = skin.data[bi];
      let g = skin.data[bi + 1];
      let b = skin.data[bi + 2];
      let a = skin.data[bi + 3];

      // 帽子レイヤーをアルファ合成で上に重ねる
      const hi = sampleIndex(HEAD_OVERLAY, skin.width, ox, oy, size);
      const ha = skin.data[hi + 3];
      if (ha > 0) {
        const af = ha / 255;
        r = Math.round(skin.data[hi] * af + r * (1 - af));
        g = Math.round(skin.data[hi + 1] * af + g * (1 - af));
        b = Math.round(skin.data[hi + 2] * af + b * (1 - af));
        a = Math.max(a, ha);
      }

      out.data[oi] = r;
      out.data[oi + 1] = g;
      out.data[oi + 2] = b;
      out.data[oi + 3] = a;
    }
  }

  return PNG.sync.write(out);
}

/** 指定した /api/skin URL からスキンを取得し、顔を合成した data URL を返す（失敗時 null） */
async function faceFromSkinApi(skinApiUrl: string, size: number): Promise<string | null> {
  try {
    const res = await fetch(skinApiUrl, { headers: { "User-Agent": "Minefolio/1.0" } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return `data:image/png;base64,${renderSkinFacePng(bytes, size).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * ユーザーのスキンPNG（カスタムスキン > Mojang(UUID) の順で `/api/skin` が解決）から顔を合成する。
 * カスタムスキンも UUID も無い（MCID未登録）場合は、アプリ一覧と同じく Steve の顔にフォールバックする。
 * すべて失敗した場合のみ null（呼び出し側はプレースホルダーを表示）。
 */
export async function fetchSkinFaceDataUrl(
  origin: string,
  userId: string,
  size: number,
): Promise<string | null> {
  const primary = await faceFromSkinApi(
    `${origin}/api/skin?userId=${encodeURIComponent(userId)}`,
    size,
  );
  if (primary) return primary;
  // MCID未登録などでスキンを解決できない場合は Steve にフォールバック
  return faceFromSkinApi(`${origin}/api/skin?uuid=${STEVE_UUID}`, size);
}
