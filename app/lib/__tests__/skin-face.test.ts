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

  describe("旧形式（64x32）スキン", () => {
    /** 64x32 の全画素を不透明な色で塗る（頭ベース(8,8)は肌色、右半分は帽子色）。transparentAt で右半分に透明画素を作れる */
    function makeLegacy(hat: [number, number, number], transparentAt?: [number, number]): Uint8Array {
      const png = new PNG({ width: 64, height: 32, fill: true });
      const set = (x: number, y: number, [r, g, b]: number[], a: number) => {
        const i = (y * 64 + x) * 4;
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
        png.data[i + 3] = a;
      };
      for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) set(x, y, [10, 20, 30], 255);
      for (let y = 0; y < 32; y++) for (let x = 32; x < 64; x++) set(x, y, hat, 255);
      if (transparentAt) set(transparentAt[0], transparentAt[1], [0, 0, 0], 0);
      return PNG.sync.write(png);
    }

    it("帽子領域が不透明な黒だけなら帽子を描かずベース色になる", () => {
      const png = renderSkinFacePng(makeLegacy([0, 0, 0]), 16);
      expect(centerPixel(png, 16)).toEqual([10, 20, 30, 255]);
    });

    it("右半分に透明画素があれば帽子を描く", () => {
      const png = renderSkinFacePng(makeLegacy([200, 100, 50], [60, 2]), 16);
      expect(centerPixel(png, 16)).toEqual([200, 100, 50, 255]);
    });
  });

  it("128x128 スキンは倍率に合わせて (16,16) と (80,16) の 16x16 を使う", () => {
    const paint = (png: PNG, rx: number, ry: number, [r, g, b]: number[]) => {
      for (let y = ry; y < ry + 16; y++) {
        for (let x = rx; x < rx + 16; x++) {
          const i = (y * 128 + x) * 4;
          png.data[i] = r;
          png.data[i + 1] = g;
          png.data[i + 2] = b;
          png.data[i + 3] = 255;
        }
      }
    };
    const make = (withHat: boolean) => {
      const png = new PNG({ width: 128, height: 128, fill: true });
      paint(png, 16, 16, [10, 20, 30]);
      if (withHat) paint(png, 80, 16, [200, 100, 50]);
      return PNG.sync.write(png);
    };
    // 帽子が透明ならベースが、塗れば帽子が反映される（64 基準の座標では別の領域を読んでしまう）
    expect(centerPixel(renderSkinFacePng(make(false), 16), 16)).toEqual([10, 20, 30, 255]);
    expect(centerPixel(renderSkinFacePng(make(true), 16), 16)).toEqual([200, 100, 50, 255]);
  });

  it("指定した出力サイズになる", () => {
    const decoded = PNG.sync.read(renderSkinFacePng(makeSkin([1, 2, 3], [0, 0, 0], 0), 32));
    expect(decoded.width).toBe(32);
    expect(decoded.height).toBe(32);
  });
});
