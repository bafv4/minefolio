// 動画→GIF 変換のうち、DOM を使わない計画部分の検証。
// 実際のデコード（<video> のシーク）と gifenc のエンコードは JSDOM で再現できないため、
// フレーム時刻の割り付け・出力サイズ・切り出し範囲のクランプをここで担保する。
import { describe, it, expect } from "vitest";
import {
  scaleToWidth,
  planGifFrames,
  clampTrimRange,
  GIF_MAX_DURATION_SEC,
  GIF_MIN_DURATION_SEC,
} from "../video-to-gif";

describe("scaleToWidth", () => {
  it("上限より広い動画を比率を保って縮める", () => {
    expect(scaleToWidth(1920, 1080, 480)).toEqual({ width: 480, height: 270 });
  });

  it("上限より狭い動画は拡大しない", () => {
    expect(scaleToWidth(320, 240, 640)).toEqual({ width: 320, height: 240 });
  });

  it("縦長でも幅を基準に縮める", () => {
    expect(scaleToWidth(1080, 1920, 320)).toEqual({ width: 320, height: 569 });
  });
});

describe("planGifFrames", () => {
  it("長さ × fps 個のフレームを等間隔で並べる", () => {
    const plan = planGifFrames(0, 1, 10);
    expect(plan.times).toHaveLength(10);
    expect(plan.times[0]).toBeCloseTo(0);
    expect(plan.times[9]).toBeCloseTo(0.9);
    expect(plan.delayMs).toBe(100);
  });

  it("開始位置がフレーム時刻に反映される", () => {
    const plan = planGifFrames(2, 3, 4);
    expect(plan.times).toHaveLength(4);
    expect(plan.times[0]).toBeCloseTo(2);
    expect(plan.times[3]).toBeCloseTo(2.75);
  });

  it("上限に当たったら範囲全体へ均等配分し、遅延も伸ばす（再生速度を保つ）", () => {
    const plan = planGifFrames(0, 10, 30, 100);
    expect(plan.times).toHaveLength(100);
    // 10 秒を 100 フレームに割り付けるので 0.1 秒刻み
    expect(plan.times[99]).toBeCloseTo(9.9);
    expect(plan.delayMs).toBe(100);
    // 総再生時間は元の長さのまま
    expect(plan.times.length * plan.delayMs).toBe(10_000);
  });

  it("長さ 0 でも 1 フレームは返す（空の GIF を作らない）", () => {
    const plan = planGifFrames(1, 1, 10);
    expect(plan.times).toEqual([1]);
    expect(plan.delayMs).toBeGreaterThanOrEqual(20);
  });

  it("遅延は 20ms を下回らない（ビューア間で丸めがぶれるため）", () => {
    expect(planGifFrames(0, 0.02, 100).delayMs).toBeGreaterThanOrEqual(20);
  });
});

describe("clampTrimRange", () => {
  it("開始を動かすと終了が追従し、最長を超えない", () => {
    const range = clampTrimRange({ startSec: 50, endSec: 60 }, 120, "start");
    expect(range.startSec).toBe(50);
    expect(range.endSec).toBe(60);

    const stretched = clampTrimRange({ startSec: 10, endSec: 120 }, 120, "start");
    expect(stretched.endSec - stretched.startSec).toBeCloseTo(GIF_MAX_DURATION_SEC);
  });

  it("終了を動かすと開始が追従し、最長を超えない", () => {
    const range = clampTrimRange({ startSec: 0, endSec: 100 }, 120, "end");
    expect(range.endSec).toBe(100);
    expect(range.startSec).toBeCloseTo(100 - GIF_MAX_DURATION_SEC);
  });

  it("最短の長さを下回らない", () => {
    const range = clampTrimRange({ startSec: 5, endSec: 5 }, 120, "start");
    expect(range.endSec - range.startSec).toBeCloseTo(GIF_MIN_DURATION_SEC);
  });

  it("動画の外へは出ない", () => {
    const range = clampTrimRange({ startSec: -5, endSec: 999 }, 8, "start");
    expect(range.startSec).toBeGreaterThanOrEqual(0);
    expect(range.endSec).toBeLessThanOrEqual(8);
  });

  it("動画が最短より短くても破綻しない", () => {
    const range = clampTrimRange({ startSec: 0, endSec: 10 }, 0.3, "start");
    expect(range.startSec).toBe(0);
    expect(range.endSec).toBeCloseTo(0.3);
  });

  it("最長より短い動画では全体を選べる", () => {
    const range = clampTrimRange({ startSec: 0, endSec: 5 }, 5, "start");
    expect(range).toEqual({ startSec: 0, endSec: 5 });
  });
});
