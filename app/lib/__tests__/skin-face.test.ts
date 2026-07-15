import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { renderSkinFacePng } from "../skin-face.server";

/** 64x64 のスキンPNGを作り、頭ベース(8,8)と帽子(40,8)の8x8領域に指定色を塗る */
function makeSkin(
  base: [number, number, number],
  hat: [number, number, number],
  hatAlpha: number,
): Uint8Array {
  const png = new PNG({ width: 64, height: 64, fill: true });
  const setRegion = (rx: number, ry: number, [r, g, b]: number[], a: number) => {
    for (let y = ry; y < ry + 8; y++) {
      for (let x = rx; x < rx + 8; x++) {
        const i = (y * 64 + x) * 4;
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
        png.data[i + 3] = a;
      }
    }
  };
  setRegion(8, 8, base, 255);
  setRegion(40, 8, hat, hatAlpha);
  return PNG.sync.write(png);
}

function centerPixel(bytes: Buffer, size: number): [number, number, number, number] {
  const decoded = PNG.sync.read(bytes);
  const i = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
  return [decoded.data[i], decoded.data[i + 1], decoded.data[i + 2], decoded.data[i + 3]];
}

describe("renderSkinFacePng", () => {
  it("帽子が透明なら頭ベースの色で描画する", () => {
    const png = renderSkinFacePng(makeSkin([10, 20, 30], [0, 0, 0], 0), 16);
    expect(centerPixel(png, 16)).toEqual([10, 20, 30, 255]);
  });

  it("帽子が不透明なら帽子の色で上書きする", () => {
    const png = renderSkinFacePng(makeSkin([10, 20, 30], [200, 100, 50], 255), 16);
    expect(centerPixel(png, 16)).toEqual([200, 100, 50, 255]);
  });

  it("帽子が半透明ならアルファ合成する", () => {
    // base(0,0,0) に hat(255,255,255) を alpha=128 で合成 → 約128
    const png = renderSkinFacePng(makeSkin([0, 0, 0], [255, 255, 255], 128), 16);
    const [r, g, b] = centerPixel(png, 16);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(136);
    expect(g).toBe(r);
    expect(b).toBe(r);
  });

  it("指定した出力サイズになる", () => {
    const decoded = PNG.sync.read(renderSkinFacePng(makeSkin([1, 2, 3], [0, 0, 0], 0), 32));
    expect(decoded.width).toBe(32);
    expect(decoded.height).toBe(32);
  });
});
