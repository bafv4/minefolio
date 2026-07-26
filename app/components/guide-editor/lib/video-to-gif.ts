// 短い動画を GIF へ変換する（すべてブラウザ内で完結。サーバへ動画は送らない）。
//
// ここが担うのは「<video> を目的の時刻へシークし、canvas へ描いて RGBA を取り出す」まで。
// パレット作成とエンコードは gif-encode.ts（GIF のトリミングと共通）に委ねる。
import { encodeGif, paletteSampleStep, type GifSourceFrame } from "./gif-encode";

export { GifTooLargeError } from "./gif-encode";

/** 動画をデコードできない / シークが返らない */
export class VideoDecodeError extends Error {
  constructor() {
    super("VIDEO_DECODE_FAILED");
    this.name = "VideoDecodeError";
  }
}

/** 切り出せる最大の長さ（秒）。これ以上は GIF に向かない */
export const GIF_MAX_DURATION_SEC = 15;

/** 切り出しの最小の長さ（秒） */
export const GIF_MIN_DURATION_SEC = 0.5;

/** 走査するフレーム数の上限。長さ × fps がこれを超えたら間引く */
export const GIF_MAX_FRAMES = 200;

/** 出力幅の選択肢（px） */
export const GIF_WIDTH_PRESETS = [320, 480, 640] as const;

/** フレームレートの選択肢 */
export const GIF_FPS_PRESETS = [8, 10, 12, 15] as const;

/** シーク 1 回あたりの待ち時間の上限（ミリ秒） */
const SEEK_TIMEOUT_MS = 8000;

/** 出力サイズ（幅を上限に合わせる。元より大きくはしない） */
export function scaleToWidth(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, maxWidth / width);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface GifFramePlan {
  /** キャプチャする各フレームの時刻（秒） */
  times: number[];
  /** 1 フレームあたりの表示時間（ミリ秒） */
  delayMs: number;
}

/**
 * 切り出し範囲と fps から、実際に走査するフレームの時刻を決める。
 * 上限（maxFrames）に当たった場合は fps を落とす代わりに範囲全体へ均等配分し、
 * delayMs もそれに合わせる（＝再生速度を実時間どおりに保つ）。
 */
export function planGifFrames(
  startSec: number,
  endSec: number,
  fps: number,
  maxFrames: number = GIF_MAX_FRAMES,
): GifFramePlan {
  const duration = Math.max(0, endSec - startSec);
  const requested = Math.max(1, Math.round(duration * fps));
  const count = Math.min(maxFrames, requested);
  const step = count > 1 ? duration / count : 0;
  return {
    times: Array.from({ length: count }, (_, i) => startSec + i * step),
    // GIF の遅延は 1/100 秒単位。20ms 未満は多くのビューアで別の値に丸められる
    delayMs: Math.max(20, Math.round((step || 1 / fps) * 1000)),
  };
}

export interface GifTrimRange {
  startSec: number;
  endSec: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 切り出し範囲を「最短 GIF_MIN_DURATION_SEC・最長 GIF_MAX_DURATION_SEC・動画長の内側」に収める。
 * `anchor` は今ユーザーが動かした側で、そちらを優先して反対側を追従させる
 * （開始を動かしたら終了がついてくる）。
 */
export function clampTrimRange(
  range: GifTrimRange,
  duration: number,
  anchor: "start" | "end",
): GifTrimRange {
  const maxLength = Math.min(GIF_MAX_DURATION_SEC, duration);
  const minLength = Math.min(GIF_MIN_DURATION_SEC, duration);

  if (anchor === "start") {
    const startSec = clamp(range.startSec, 0, Math.max(0, duration - minLength));
    return {
      startSec,
      endSec: clamp(
        range.endSec,
        startSec + minLength,
        Math.min(duration, startSec + maxLength),
      ),
    };
  }

  const endSec = clamp(range.endSec, minLength, duration);
  return {
    endSec,
    startSec: clamp(range.startSec, Math.max(0, endSec - maxLength), endSec - minLength),
  };
}

export interface ConvertVideoToGifOptions {
  /** 出力の最大幅（px）。高さは比率維持 */
  maxWidth: number;
  /** フレームレート */
  fps: number;
  /** 切り出し開始（秒） */
  startSec: number;
  /** 切り出し終了（秒） */
  endSec: number;
  /** 出力の最大バイト数。超えたら GifTooLargeError */
  maxBytes: number;
  /** 進捗（0..1）。フレーム走査とエンコードの合計に対する割合 */
  onProgress?: (ratio: number) => void;
  /** 中断用 */
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/** メタデータが読めるまで待つ（読めない形式・コーデックはここで失敗する） */
function waitForLoad(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 /* HAVE_CURRENT_DATA */) {
      resolve();
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", ok);
      video.removeEventListener("error", ng);
    };
    const ok = () => {
      cleanup();
      resolve();
    };
    const ng = () => {
      cleanup();
      reject(new VideoDecodeError());
    };
    const timer = setTimeout(ng, SEEK_TIMEOUT_MS);
    video.addEventListener("loadeddata", ok);
    video.addEventListener("error", ng);
  });
}

/**
 * 実際の長さ（秒）を得る。
 * MediaRecorder 由来の webm は duration が Infinity になることがあるため、
 * その場合は極端に大きい時刻へシークして実長を確定させる。
 */
export async function resolveVideoDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;

  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("timeupdate", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, SEEK_TIMEOUT_MS);
    video.addEventListener("timeupdate", done);
    video.currentTime = Number.MAX_SAFE_INTEGER;
  });

  const duration = video.duration;
  video.currentTime = 0;
  if (!Number.isFinite(duration) || duration <= 0) throw new VideoDecodeError();
  return duration;
}

/** 指定時刻へシークして、その位置のフレームが描画可能になるまで待つ */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // 既にその位置なら seeked が飛ばずタイムアウトするので、待たずに返す
    if (Math.abs(video.currentTime - time) < 1e-3) {
      resolve();
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", ok);
      video.removeEventListener("error", ng);
    };
    const ok = () => {
      cleanup();
      resolve();
    };
    const ng = () => {
      cleanup();
      reject(new VideoDecodeError());
    };
    const timer = setTimeout(ng, SEEK_TIMEOUT_MS);
    video.addEventListener("seeked", ok);
    video.addEventListener("error", ng);
    video.currentTime = time;
  });
}

/**
 * 動画ファイルを GIF（File）へ変換する。
 * 元ファイルはアップロードせず、生成した GIF だけを返す。
 */
export async function convertVideoToGif(
  file: File,
  opts: ConvertVideoToGifOptions,
): Promise<File> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  // 別タブ描画を避けつつデコードは動かすため、DOM には挿入しない
  video.src = objectUrl;

  try {
    await waitForLoad(video);
    throwIfAborted(opts.signal);

    const duration = await resolveVideoDuration(video);
    const startSec = Math.max(0, Math.min(opts.startSec, duration));
    const endSec = Math.max(startSec, Math.min(opts.endSec, duration));
    const plan = planGifFrames(startSec, endSec, opts.fps);

    const size = scaleToWidth(video.videoWidth, video.videoHeight, opts.maxWidth);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    // 各フレームで getImageData するので、GPU 往復を避けるヒントを付ける
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new VideoDecodeError();

    const captureAt = async (time: number): Promise<Uint8ClampedArray> => {
      await seekTo(video, time);
      ctx.drawImage(video, 0, 0, size.width, size.height);
      return ctx.getImageData(0, 0, size.width, size.height).data;
    };

    // ── 1) パレット用のサンプル取得 ──────────────
    // 範囲全体から数フレームだけ抜き出す。先頭フレームだけで作ると、
    // 途中で場面が変わったときに色が破綻する。
    const sampleStep = paletteSampleStep(plan.times.length);
    const sampleTimes = plan.times.filter((_, i) => i % sampleStep === 0);
    const paletteSamples: Uint8ClampedArray[] = [];
    for (const time of sampleTimes) {
      throwIfAborted(opts.signal);
      paletteSamples.push(await captureAt(time));
    }

    // 進捗はサンプリングと本走査の合計に対する割合で出す
    const totalSteps = sampleTimes.length + plan.times.length;
    opts.onProgress?.(sampleTimes.length / totalSteps);

    // ── 2) 本走査 + エンコード ──────────────────
    // 逐次シークしながら 1 フレームずつ渡す（全フレームを抱えないのでメモリが増えない）
    async function* frames(): AsyncGenerator<GifSourceFrame> {
      for (const time of plan.times) {
        yield { rgba: await captureAt(time), delayMs: plan.delayMs };
      }
    }

    const bytes = await encodeGif({
      width: size.width,
      height: size.height,
      paletteSamples,
      frames: frames(),
      frameCount: plan.times.length,
      repeat: 0, // 無限ループ
      maxBytes: opts.maxBytes,
      onFrameEncoded: (encoded) =>
        opts.onProgress?.((sampleTimes.length + encoded) / totalSteps),
      signal: opts.signal,
    });

    const base = file.name.replace(/\.[^.]+$/, "") || "video";
    return new File([bytes], `${base}.gif`, { type: "image/gif" });
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute("src");
    video.load();
  }
}
