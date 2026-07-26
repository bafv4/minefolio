// アニメーション GIF のトリミング。アニメーションを保ったまま切り出すため、
// 全フレームをデコード → 矩形で切り出し → 1 本の GIF へ書き戻す。
//
// 静止画のトリミング（image-processing.ts の cropImageFromUrl）は canvas で
// createImageBitmap するが、それだと GIF は 1 フレーム目だけの静止画に潰れる。
//
// デコードは omggif（MIT / 依存なし / ブラウザ差なし）を動的 import する。
// ブラウザ内蔵の ImageDecoder は Safari が未対応なので使わない。
import { toPixelRect, type CropRect } from "./image-crop";
import { ImageLoadError } from "./image-processing";
import { encodeGif, paletteSampleStep, type GifSourceFrame } from "./gif-encode";

/** GIF として解釈できない（壊れている / 実は GIF ではない） */
export class GifDecodeError extends Error {
  constructor() {
    super("GIF_DECODE_FAILED");
    this.name = "GifDecodeError";
  }
}

/** 切り出し領域（実ピクセル） */
interface PixelRegion {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * RGBA バッファから矩形を切り出す（行ごとにコピーするだけの純粋関数）。
 * canvas を経由しないので、アルファがそのまま保たれる。
 */
export function cropRgbaBuffer(
  source: Uint8ClampedArray,
  sourceWidth: number,
  region: PixelRegion,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(region.sw * region.sh * 4);
  const rowBytes = region.sw * 4;
  for (let row = 0; row < region.sh; row++) {
    const start = ((region.sy + row) * sourceWidth + region.sx) * 4;
    out.set(source.subarray(start, start + rowBytes), row * rowBytes);
  }
  return out;
}

/** 論理画面バッファの矩形を透明（0,0,0,0）で塗り潰す */
export function clearRgbaRegion(
  buffer: Uint8ClampedArray,
  bufferWidth: number,
  region: PixelRegion,
): void {
  const rowBytes = region.sw * 4;
  for (let row = 0; row < region.sh; row++) {
    const start = ((region.sy + row) * bufferWidth + region.sx) * 4;
    buffer.fill(0, start, start + rowBytes);
  }
}

/**
 * ループ回数を gifenc の repeat へ変換する。
 * omggif: null = Netscape ブロックなし（1 回のみ）/ 0 = 無限 / n = n 回
 * gifenc: -1 = 1 回のみ / 0 = 無限 / n = n 回
 */
export function toGifRepeat(loopCount: number | null): number {
  return loopCount === null ? -1 : loopCount;
}

/**
 * 各フレームを論理画面へ合成しながら、切り出した RGBA を順に返す。
 *
 * GIF はフレームごとに部分矩形だけを更新し、透過画素は下の絵を透かす。
 * さらに「廃棄方法（disposal）」で次フレームの下地が決まるため、
 * 単にフレームを並べるだけでは残像やちらつきになる。ここで正しく合成する。
 */
function* cropFrames(
  reader: import("omggif").GifReader,
  region: PixelRegion,
): Generator<GifSourceFrame> {
  const canvas = new Uint8ClampedArray(reader.width * reader.height * 4);
  let snapshot: Uint8ClampedArray | null = null;

  for (let i = 0; i < reader.numFrames(); i++) {
    const info = reader.frameInfo(i);
    // disposal 3（直前へ復元）に備えて、描く前の状態を控える
    snapshot = info.disposal === 3 ? canvas.slice() : null;

    reader.decodeAndBlitFrameRGBA(i, canvas);
    yield {
      rgba: cropRgbaBuffer(canvas, reader.width, region),
      // GIF の遅延はセンチ秒。gifenc は ミリ秒 で受け取り内部で戻す
      delayMs: info.delay * 10,
    };

    if (info.disposal === 2) {
      clearRgbaRegion(canvas, reader.width, {
        sx: info.x,
        sy: info.y,
        sw: info.width,
        sh: info.height,
      });
    } else if (info.disposal === 3 && snapshot) {
      canvas.set(snapshot);
    }
  }
}

export interface CropAnimatedGifOptions {
  /** 出力の最大バイト数。超えたら GifTooLargeError */
  maxBytes: number;
  /** 書き出したフレーム数の通知（進捗表示用） */
  onFrameEncoded?: (encoded: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * GIF のバイト列を矩形で切り出し、アニメーションを保ったまま書き戻す。
 * I/O を含まないので、単体テストからそのまま呼べる。
 */
export async function cropAnimatedGif(
  bytes: Uint8Array,
  rect: CropRect,
  opts: CropAnimatedGifOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const { GifReader } = await import("omggif");

  let reader: InstanceType<typeof GifReader>;
  try {
    reader = new GifReader(bytes);
  } catch {
    throw new GifDecodeError();
  }

  const frameCount = reader.numFrames();
  if (frameCount === 0) throw new GifDecodeError();
  const region = toPixelRect(rect, reader.width, reader.height);

  // パレットは全フレームを見る前に必要だが、GIF は前フレームに依存するため
  // 途中から復元できない。全フレームを保持するとメモリを食うので、
  // 走査を 2 周に分ける（デコードは十分速く、シークも要らない）。
  const step = paletteSampleStep(frameCount);
  const paletteSamples: Uint8ClampedArray[] = [];
  let index = 0;
  for (const frame of cropFrames(reader, region)) {
    if (index % step === 0) paletteSamples.push(frame.rgba);
    index++;
  }

  return encodeGif({
    width: region.sw,
    height: region.sh,
    paletteSamples,
    frames: cropFrames(reader, region),
    frameCount,
    repeat: toGifRepeat(reader.loopCount()),
    maxBytes: opts.maxBytes,
    onFrameEncoded: (encoded) => opts.onFrameEncoded?.(encoded, frameCount),
    signal: opts.signal,
  });
}

/**
 * アップロード済みの GIF を矩形で切り出し、アニメーションを保った GIF File を返す。
 * 取得には CORS が必要（Vercel Blob の公開 URL は許可されている）。
 */
export async function cropAnimatedGifFromUrl(
  src: string,
  rect: CropRect,
  fileName: string,
  opts: CropAnimatedGifOptions,
): Promise<File> {
  let bytes: Uint8Array;
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new ImageLoadError();
  }
  return new File([await cropAnimatedGif(bytes, rect, opts)], fileName, { type: "image/gif" });
}
