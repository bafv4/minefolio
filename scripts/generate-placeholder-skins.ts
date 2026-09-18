// MCID未登録ユーザー向けの全身プレースホルダー（黒スキン）を生成するスクリプト。
//
// 顔のプレースホルダーは `public/skins/no-mcid-face.svg`（16x16 のドット絵を 1px ごとの <rect> で
// 手描きしたもの）で、このスクリプトの生成対象ではない。直接編集する。
//
// 生成物（リポジトリにコミットする。配信は public/ の静的配信に任せる）:
//   public/skins/no-mcid.png … 64x64。標準（default）モデルのベースレイヤー全パーツを
//                              不透明の黒（#1a1a1a）で塗ったスキン。オーバーレイ層は透明。
//                              プロフィールの全身表示（MinecraftFullBody）に使う。
//                              skinview3d のテクスチャはラスタでないと扱えないため PNG のままにする。
//
// 第三者 Mod のテクスチャは一切使わないオリジナル。出力は完全に決定的で、再実行しても同じ PNG になる。
//
// 実行:
//   pnpm exec tsx scripts/generate-placeholder-skins.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PNG } from "pngjs";

type Rgba = readonly [number, number, number, number];

const OUT_DIR = resolve(process.cwd(), "public/skins");
const BODY_PATH = resolve(OUT_DIR, "no-mcid.png");

const SKIN_SIZE = 64;
const BLACK: Rgba = [26, 26, 26, 255]; // #1a1a1a（純黒だと3Dの陰影が潰れるため少し持ち上げる）

/** 64x64 スキンのベースレイヤー（頭・胴・両腕・両脚）の展開図領域。オーバーレイ層は含めない。 */
const BASE_LAYER_RECTS: ReadonlyArray<{ x: number; y: number; w: number; h: number }> = [
  { x: 0, y: 0, w: 32, h: 16 }, // 頭
  { x: 0, y: 16, w: 16, h: 16 }, // 右脚
  { x: 16, y: 16, w: 24, h: 16 }, // 胴
  { x: 40, y: 16, w: 16, h: 16 }, // 右腕
  { x: 16, y: 48, w: 16, h: 16 }, // 左脚
  { x: 32, y: 48, w: 16, h: 16 }, // 左腕
];

function fillRect(png: PNG, x: number, y: number, w: number, h: number, [r, g, b, a]: Rgba): void {
  for (let oy = y; oy < y + h; oy++) {
    for (let ox = x; ox < x + w; ox++) {
      if (ox < 0 || oy < 0 || ox >= png.width || oy >= png.height) continue;
      const i = (oy * png.width + ox) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
}

function buildBody(): PNG {
  const png = new PNG({ width: SKIN_SIZE, height: SKIN_SIZE, fill: true });
  // fill: true は全ピクセル 0（= 完全透明）で初期化されるため、ベース領域だけ塗る
  for (const rect of BASE_LAYER_RECTS) {
    fillRect(png, rect.x, rect.y, rect.w, rect.h, BLACK);
  }
  return png;
}

function write(path: string, png: PNG): void {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = PNG.sync.write(png);
  writeFileSync(path, bytes);
  console.log(`✅ ${path} (${png.width}x${png.height}, ${bytes.length} bytes)`);
}

write(BODY_PATH, buildBody());
console.log("完了。生成物は public/ の静的配信でそのまま提供されます。");
