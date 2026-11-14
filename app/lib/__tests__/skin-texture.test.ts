import { describe, it, expect } from "vitest";
import {
  headBaseRegion,
  headOverlayRegion,
  isLegacySkin,
  shouldHideLegacyHat,
} from "../skin-texture";

/** 全画素を同じ alpha で埋めた RGBA 配列を作る */
function makeRgba(width: number, height: number, alpha: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = alpha;
  return data;
}

describe("headBaseRegion / headOverlayRegion", () => {
  it("64 幅は 64 基準の座標のまま", () => {
    expect(headBaseRegion(64)).toEqual({ x: 8, y: 8, w: 8, h: 8 });
    expect(headOverlayRegion(64)).toEqual({ x: 40, y: 8, w: 8, h: 8 });
  });

  it("128 幅は 2 倍の座標になる", () => {
    expect(headBaseRegion(128)).toEqual({ x: 16, y: 16, w: 16, h: 16 });
    expect(headOverlayRegion(128)).toEqual({ x: 80, y: 16, w: 16, h: 16 });
  });

  it("幅が 0 でも 64 基準にフォールバックする", () => {
    expect(headBaseRegion(0)).toEqual({ x: 8, y: 8, w: 8, h: 8 });
  });
});

describe("isLegacySkin", () => {
  it("幅が高さの 2 倍のときだけ旧形式", () => {
    expect(isLegacySkin(64, 32)).toBe(true);
    expect(isLegacySkin(64, 64)).toBe(false);
    expect(isLegacySkin(128, 128)).toBe(false);
  });
});

describe("shouldHideLegacyHat", () => {
  it("64x32 で右半分が全て不透明なら true", () => {
    expect(shouldHideLegacyHat(makeRgba(64, 32, 255), 64, 32)).toBe(true);
  });

  it("64x32 で右半分に alpha<128 の画素が1つあれば false", () => {
    const data = makeRgba(64, 32, 255);
    data[(2 * 64 + 60) * 4 + 3] = 127;
    expect(shouldHideLegacyHat(data, 64, 32)).toBe(false);
  });

  it("64x32 で alpha がちょうど 128 の画素だけなら true", () => {
    expect(shouldHideLegacyHat(makeRgba(64, 32, 128), 64, 32)).toBe(true);
  });

  it("左半分の透明画素は判定に影響しない", () => {
    const data = makeRgba(64, 32, 255);
    data[(2 * 64 + 10) * 4 + 3] = 0;
    expect(shouldHideLegacyHat(data, 64, 32)).toBe(true);
  });

  it("64x64 / 128x128 は常に false", () => {
    expect(shouldHideLegacyHat(makeRgba(64, 64, 255), 64, 64)).toBe(false);
    expect(shouldHideLegacyHat(makeRgba(128, 128, 255), 128, 128)).toBe(false);
  });
});
