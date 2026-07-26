// アニメーション GIF のトリミング検証。
// デコード（omggif）もエンコード（gifenc）も純 JS で DOM を使わないため、
// 「GIF を組み立てる → 切り出す → 読み直して中身を確認する」まで通しで検証できる。
import { describe, it, expect } from "vitest";
import { GifWriter, GifReader } from "omggif";
import {
  cropRgbaBuffer,
  clearRgbaRegion,
  toGifRepeat,
  cropAnimatedGif,
  GifDecodeError,
} from "../gif-crop";
import { GifTooLargeError } from "../gif-encode";

const RED = 0xff0000;
const GREEN = 0x00ff00;
const BLUE = 0x0000ff;

interface FixtureFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  /** パレット添字で埋める（単色フレーム用） */
  colorIndex: number;
  delay?: number;
  disposal?: number;
}

/** 検証用の GIF を組み立てる（パレットは RED / GREEN / BLUE + 黒） */
function makeGif(
  width: number,
  height: number,
  frames: FixtureFrame[],
  loop?: number,
): Uint8Array {
  const buf = new Uint8Array(64 * 1024);
  const writer = new GifWriter(buf, width, height, {
    loop,
    palette: [RED, GREEN, BLUE, 0x000000],
  });
  for (const frame of frames) {
    const pixels = new Uint8Array(frame.width * frame.height).fill(frame.colorIndex);
    writer.addFrame(frame.x, frame.y, frame.width, frame.height, pixels, {
      delay: frame.delay ?? 10,
      disposal: frame.disposal ?? 0,
    });
  }
  return buf.subarray(0, writer.end());
}

/**
 * 出力 GIF のフレームを 1 枚ずつ読む。
 * 出力は常に「合成済みの全画面フレーム」なので、前フレームと重ねずに
 * 単独で読めば、それがそのまま再生時の見た目になる
 * （透過ありのときに disposal 2 を書いているのもこのため）。
 */
function readFrames(bytes: Uint8Array) {
  const reader = new GifReader(bytes);
  const frames = [];
  for (let i = 0; i < reader.numFrames(); i++) {
    const buffer = new Uint8ClampedArray(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(i, buffer);
    const offset = (x: number, y: number) => (y * reader.width + x) * 4;
    const info = reader.frameInfo(i);
    frames.push({
      delay: info.delay,
      disposal: info.disposal,
      at: (x: number, y: number) => {
        const p = offset(x, y);
        return [buffer[p], buffer[p + 1], buffer[p + 2]].join(",");
      },
      alphaAt: (x: number, y: number) => buffer[offset(x, y) + 3],
    });
  }
  return { reader, frames };
}

describe("cropRgbaBuffer", () => {
  it("指定した矩形の画素だけを取り出す", () => {
    // 4×2 の RGBA。R 値に連番を入れて位置を判別する
    const src = new Uint8ClampedArray(4 * 2 * 4);
    for (let i = 0; i < 8; i++) src[i * 4] = i;

    const out = cropRgbaBuffer(src, 4, { sx: 1, sy: 0, sw: 2, sh: 2 });
    expect(out).toHaveLength(2 * 2 * 4);
    // 1行目は元の添字 1,2 / 2行目は 5,6
    expect([out[0], out[4], out[8], out[12]]).toEqual([1, 2, 5, 6]);
  });

  it("アルファをそのまま保つ（canvas を経由しないため）", () => {
    const src = new Uint8ClampedArray(2 * 1 * 4);
    src[3] = 0; // 完全透明
    src[7] = 128; // 半透明
    const out = cropRgbaBuffer(src, 2, { sx: 0, sy: 0, sw: 2, sh: 1 });
    expect([out[3], out[7]]).toEqual([0, 128]);
  });
});

describe("clearRgbaRegion", () => {
  it("指定矩形だけを透明にし、外側は触らない", () => {
    const buf = new Uint8ClampedArray(4 * 2 * 4).fill(255);
    clearRgbaRegion(buf, 4, { sx: 2, sy: 0, sw: 2, sh: 1 });
    // 1行目の右半分だけが 0
    expect([...buf.subarray(0, 8)]).toEqual([255, 255, 255, 255, 255, 255, 255, 255]);
    expect([...buf.subarray(8, 16)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    // 2行目は無傷
    expect([...buf.subarray(16, 24)]).toEqual([255, 255, 255, 255, 255, 255, 255, 255]);
  });
});

describe("toGifRepeat", () => {
  it("omggif のループ指定を gifenc の repeat へ写す", () => {
    expect(toGifRepeat(null)).toBe(-1); // 指定なし = 1 回のみ
    expect(toGifRepeat(0)).toBe(0); // 無限
    expect(toGifRepeat(3)).toBe(3);
  });
});

describe("cropAnimatedGif", () => {
  const opts = { maxBytes: 5 * 1024 * 1024 };

  it("全フレームを保ったまま切り出す", async () => {
    // 8×8。左上 4×4 が赤、右下 4×4 が緑のフレームを 2 枚
    const source = makeGif(
      8,
      8,
      [
        { x: 0, y: 0, width: 8, height: 8, colorIndex: 0, delay: 10 },
        { x: 0, y: 0, width: 8, height: 8, colorIndex: 1, delay: 20 },
      ],
      0,
    );

    const out = await cropAnimatedGif(source, { x: 0, y: 0, width: 0.5, height: 0.5 }, opts);
    const { reader, frames } = readFrames(out);

    expect(reader.numFrames()).toBe(2);
    expect(reader.width).toBe(4);
    expect(reader.height).toBe(4);
    expect(frames[0].at(2, 2)).toBe("255,0,0");
    expect(frames[1].at(2, 2)).toBe("0,255,0");
  });

  it("フレームの表示時間を保つ（再生速度が変わらない）", async () => {
    const source = makeGif(4, 4, [
      { x: 0, y: 0, width: 4, height: 4, colorIndex: 0, delay: 7 },
      { x: 0, y: 0, width: 4, height: 4, colorIndex: 1, delay: 33 },
    ]);
    const out = await cropAnimatedGif(source, { x: 0, y: 0, width: 1, height: 1 }, opts);
    const { frames } = readFrames(out);
    expect(frames.map((f) => f.delay)).toEqual([7, 33]);
  });

  it("部分更新フレームを合成してから切り出す（GIF は前フレームに重ねて描く）", async () => {
    // 1枚目で全面を赤にし、2枚目は右下 4×4 だけを緑で上書きする
    const source = makeGif(8, 8, [
      { x: 0, y: 0, width: 8, height: 8, colorIndex: 0 },
      { x: 4, y: 4, width: 4, height: 4, colorIndex: 1, disposal: 1 },
    ]);
    // 右下 4×4 を切り出す
    const out = await cropAnimatedGif(source, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, opts);
    const { frames } = readFrames(out);
    // 合成しないと 1 枚目の右下が空（透明）になってしまう
    expect(frames[0].at(2, 2)).toBe("255,0,0");
    expect(frames[1].at(2, 2)).toBe("0,255,0");
  });

  it("disposal=2（背景で消去）を反映し、残像を残さない", async () => {
    // 2枚目は右下だけ緑 + 消去指定。3枚目は左上だけ青なので、
    // 消去が効いていれば 3 枚目の右下は透明に戻っているはず
    const source = makeGif(8, 8, [
      { x: 0, y: 0, width: 8, height: 8, colorIndex: 0 },
      { x: 4, y: 4, width: 4, height: 4, colorIndex: 1, disposal: 2 },
      { x: 0, y: 0, width: 4, height: 4, colorIndex: 2, disposal: 1 },
    ]);
    const out = await cropAnimatedGif(source, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, opts);
    const { frames } = readFrames(out);
    expect(frames.length).toBe(3);
    expect(frames[0].at(2, 2)).toBe("255,0,0"); // 赤
    expect(frames[1].at(2, 2)).toBe("0,255,0"); // 緑
    expect(frames[2].alphaAt(2, 2)).toBe(0); // 消去され透明に戻る
    // 透過を含む出力は、前フレームが透けないよう消去指定を書く
    expect(frames.map((f) => f.disposal)).toEqual([2, 2, 2]);
  });

  it("ループ設定を引き継ぐ", async () => {
    const looping = makeGif(4, 4, [{ x: 0, y: 0, width: 4, height: 4, colorIndex: 0 }], 0);
    const out = await cropAnimatedGif(looping, { x: 0, y: 0, width: 1, height: 1 }, opts);
    expect(new GifReader(out).loopCount()).toBe(0);
  });

  it("上限を超えたら GifTooLargeError を投げる", async () => {
    const source = makeGif(64, 64, [
      { x: 0, y: 0, width: 64, height: 64, colorIndex: 0 },
      { x: 0, y: 0, width: 64, height: 64, colorIndex: 1 },
    ]);
    await expect(
      cropAnimatedGif(source, { x: 0, y: 0, width: 1, height: 1 }, { maxBytes: 10 }),
    ).rejects.toBeInstanceOf(GifTooLargeError);
  });

  it("GIF として読めないデータは GifDecodeError を投げる", async () => {
    await expect(
      cropAnimatedGif(new Uint8Array([1, 2, 3, 4]), { x: 0, y: 0, width: 1, height: 1 }, opts),
    ).rejects.toBeInstanceOf(GifDecodeError);
  });
});
