// トリミング矩形の計算（純粋関数）の検証。
// UI 側のポインタ操作は「移動量を正規化して渡すだけ」なので、
// 枠が画像からはみ出さない・比率が崩れない・最小辺を割らない、をここで担保する。
import { describe, it, expect } from "vitest";
import {
  FULL_CROP,
  MIN_CROP_SIZE,
  clampCropRect,
  moveCropRect,
  resizeCropRect,
  fitCropRectToAspect,
  toNormalizedAspect,
  toPixelRect,
  isCropped,
  type CropRect,
} from "../image-crop";

/** 矩形が 0..1 の内側に収まっているか */
function isInsideImage(rect: CropRect): boolean {
  return (
    rect.x >= -1e-9 &&
    rect.y >= -1e-9 &&
    rect.x + rect.width <= 1 + 1e-9 &&
    rect.y + rect.height <= 1 + 1e-9
  );
}

describe("clampCropRect", () => {
  it("画像の外にある矩形を内側へ押し戻す", () => {
    const rect = clampCropRect({ x: -0.5, y: 0.9, width: 0.4, height: 0.4 });
    expect(rect).toEqual({ x: 0, y: 0.6, width: 0.4, height: 0.4 });
  });

  it("最小辺を下回るサイズを引き上げる", () => {
    const rect = clampCropRect({ x: 0.5, y: 0.5, width: 0.001, height: 0.001 });
    expect(rect.width).toBe(MIN_CROP_SIZE);
    expect(rect.height).toBe(MIN_CROP_SIZE);
  });

  it("1 を超えるサイズを画像全体に収める", () => {
    expect(clampCropRect({ x: 0, y: 0, width: 2, height: 3 })).toEqual(FULL_CROP);
  });
});

describe("moveCropRect", () => {
  it("サイズを変えずに平行移動する", () => {
    const rect = moveCropRect({ x: 0.2, y: 0.2, width: 0.3, height: 0.3 }, 0.1, -0.1);
    expect(rect.x).toBeCloseTo(0.3);
    expect(rect.y).toBeCloseTo(0.1);
    expect(rect.width).toBeCloseTo(0.3);
    expect(rect.height).toBeCloseTo(0.3);
  });

  it("画像の端で止まり、はみ出さない", () => {
    const rect = moveCropRect({ x: 0.8, y: 0.8, width: 0.2, height: 0.2 }, 0.5, 0.5);
    expect(rect).toEqual({ x: 0.8, y: 0.8, width: 0.2, height: 0.2 });
    expect(isInsideImage(rect)).toBe(true);
  });
});

describe("resizeCropRect（自由変形）", () => {
  const base: CropRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

  it("掴んだ辺だけを動かす", () => {
    const rect = resizeCropRect(base, "e", 0.1, 0.1);
    expect(rect.x).toBeCloseTo(0.25);
    expect(rect.y).toBeCloseTo(0.25);
    expect(rect.width).toBeCloseTo(0.6);
    // 東ハンドルは縦方向に影響しない
    expect(rect.height).toBeCloseTo(0.5);
  });

  it("角ハンドルは 2 辺を同時に動かす", () => {
    const rect = resizeCropRect(base, "nw", -0.1, -0.1);
    expect(rect.x).toBeCloseTo(0.15);
    expect(rect.y).toBeCloseTo(0.15);
    expect(rect.width).toBeCloseTo(0.6);
    expect(rect.height).toBeCloseTo(0.6);
  });

  it("辺を通り越してドラッグしても反転せず最小辺で止まる", () => {
    const rect = resizeCropRect(base, "w", 0.9, 0);
    expect(rect.width).toBeCloseTo(MIN_CROP_SIZE);
    expect(rect.x).toBeCloseTo(0.75 - MIN_CROP_SIZE);
    expect(isInsideImage(rect)).toBe(true);
  });

  it("画像の外へ広げようとしても端で止まる", () => {
    const rect = resizeCropRect(base, "se", 5, 5);
    expect(rect).toEqual({ x: 0.25, y: 0.25, width: 0.75, height: 0.75 });
    expect(isInsideImage(rect)).toBe(true);
  });
});

describe("resizeCropRect（比率固定）", () => {
  it("角ドラッグで比率を保つ", () => {
    const rect = resizeCropRect({ x: 0.2, y: 0.2, width: 0.4, height: 0.4 }, "se", 0.2, 0, 1);
    expect(rect.width / rect.height).toBeCloseTo(1);
    expect(rect.width).toBeCloseTo(0.6);
  });

  it("正方形でない比率も保つ", () => {
    const aspect = 2; // 幅が高さの 2 倍
    const rect = resizeCropRect({ x: 0, y: 0, width: 0.4, height: 0.2 }, "se", 0.2, 0, aspect);
    expect(rect.width / rect.height).toBeCloseTo(aspect);
  });

  it("端に当たったら比率を保ったまま縮める（はみ出さない）", () => {
    const rect = resizeCropRect({ x: 0.5, y: 0.5, width: 0.3, height: 0.3 }, "se", 5, 5, 1);
    expect(isInsideImage(rect)).toBe(true);
    expect(rect.width / rect.height).toBeCloseTo(1);
    // アンカー（左上 = 0.5, 0.5）から端まで = 0.5
    expect(rect.width).toBeCloseTo(0.5);
  });

  it("アンカーと反対側の角を掴んでも比率を保つ", () => {
    const rect = resizeCropRect({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, "nw", -0.2, 0, 1);
    expect(rect.width / rect.height).toBeCloseTo(1);
    // 右下（0.6, 0.6）が固定される
    expect(rect.x + rect.width).toBeCloseTo(0.6);
    expect(rect.y + rect.height).toBeCloseTo(0.6);
  });
});

describe("toNormalizedAspect", () => {
  it("正方形の画像では比率をそのまま返す", () => {
    expect(toNormalizedAspect(16 / 9, 500, 500)).toBeCloseTo(16 / 9);
  });

  it("横長の画像では正規化系での比率が小さくなる", () => {
    // 2:1 の画像で 1:1 を切り出すには、正規化系では 幅 0.5 : 高さ 1 になる
    expect(toNormalizedAspect(1, 1000, 500)).toBeCloseTo(0.5);
  });
});

describe("fitCropRectToAspect", () => {
  it("画像に収まる最大の矩形を作る", () => {
    const rect = fitCropRectToAspect(1);
    expect(rect).toEqual(FULL_CROP);
  });

  it("縦長の比率では幅が縮む", () => {
    const rect = fitCropRectToAspect(0.5);
    expect(rect.height).toBeCloseTo(1);
    expect(rect.width).toBeCloseTo(0.5);
    expect(isInsideImage(rect)).toBe(true);
  });

  it("現在の矩形の中心を保つ", () => {
    const around: CropRect = { x: 0.4, y: 0.1, width: 0.2, height: 0.2 };
    const rect = fitCropRectToAspect(2, around);
    expect(rect.x + rect.width / 2).toBeCloseTo(0.5);
    expect(isInsideImage(rect)).toBe(true);
  });
});

describe("toPixelRect", () => {
  it("正規化矩形を実ピクセルへ変換する", () => {
    expect(toPixelRect({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, 800, 400)).toEqual({
      sx: 200,
      sy: 200,
      sw: 400,
      sh: 100,
    });
  });

  it("丸め誤差があっても画像の外へはみ出さない", () => {
    const { sx, sy, sw, sh } = toPixelRect(FULL_CROP, 333, 777);
    expect(sx + sw).toBeLessThanOrEqual(333);
    expect(sy + sh).toBeLessThanOrEqual(777);
  });

  it("極小の矩形でも最低 1px を返す", () => {
    const { sw, sh } = toPixelRect({ x: 0, y: 0, width: 0.0001, height: 0.0001 }, 10, 10);
    expect(sw).toBe(1);
    expect(sh).toBe(1);
  });
});

describe("isCropped", () => {
  it("画像全体なら false（無駄な再エンコードを避ける）", () => {
    expect(isCropped(FULL_CROP)).toBe(false);
  });

  it("一部でも切り取られていれば true", () => {
    expect(isCropped({ x: 0, y: 0, width: 1, height: 0.9 })).toBe(true);
    expect(isCropped({ x: 0.1, y: 0, width: 0.9, height: 1 })).toBe(true);
  });
});
