// GIF の書き出し（gifenc ラッパー）。動画からの変換（video-to-gif.ts）と
// GIF のトリミング（gif-crop.ts）で共有する。
//
// パレットはフレームごとではなく**グローバル 1 枚**を使う。フレームごとに作ると
// 色がフレーム間で揺れてちらつき、ローカルカラーテーブルが毎フレーム付いて
// ファイルも太るため。
//
// gifenc は動的 import する。SSR では評価されず、実際に書き出すまで読み込まれない。
import type { GifPalette, GifPixelFormat } from "gifenc";

/** 出力 GIF がサイズ上限を超えた */
export class GifTooLargeError extends Error {
  constructor(
    /** 実際の出力バイト数（UI で「◯MB でした」と出すため） */
    readonly actualBytes: number,
  ) {
    super("GIF_TOO_LARGE");
    this.name = "GifTooLargeError";
  }
}

/** パレット作成に使うサンプルフレーム数の上限。多すぎるとメモリと時間を食う */
export const PALETTE_SAMPLE_FRAMES = 6;

/** 同期ループで UI を固めないよう、この枚数ごとにイベントループへ制御を返す */
const YIELD_EVERY_FRAMES = 8;

export interface GifSourceFrame {
  /** 1 フレーム分の RGBA 画素列（width × height × 4） */
  rgba: Uint8ClampedArray;
  /** 表示時間（ミリ秒）。gifenc 側でセンチ秒へ丸められる */
  delayMs: number;
}

export interface EncodeGifOptions {
  width: number;
  height: number;
  /**
   * パレット作成用のサンプル。範囲全体から散らして渡すこと
   * （先頭だけだと途中で場面が変わったときに色が破綻する）。
   */
  paletteSamples: Uint8ClampedArray[];
  /** フレームを順に供給する。動画変換は逐次シークする非同期ジェネレータを渡す */
  frames: AsyncIterable<GifSourceFrame> | Iterable<GifSourceFrame>;
  /** 総フレーム数（進捗表示用。不明なら省略可） */
  frameCount?: number;
  /** ループ回数。-1=1 回のみ / 0=無限（既定）/ n=n 回 */
  repeat?: number;
  /** 出力の最大バイト数。超えたら GifTooLargeError */
  maxBytes: number;
  /** 書き出したフレーム数を通知する */
  onFrameEncoded?: (encoded: number) => void;
  signal?: AbortSignal;
}

/**
 * 透過画素を含むか。含む場合はアルファ付きフォーマットで減色しないと、
 * 透過部分が黒く塗り潰される（透過 GIF は珍しくない）。
 */
function hasTransparency(samples: Uint8ClampedArray[]): boolean {
  for (const sample of samples) {
    for (let i = 3; i < sample.length; i += 4) {
      if (sample[i] < 255) return true;
    }
  }
  return false;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/** フレーム列を 1 本の GIF バイト列へ書き出す */
export async function encodeGif(opts: EncodeGifOptions): Promise<Uint8Array<ArrayBuffer>> {
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");

  // 透過ありは rgba4444（アルファ 1bit 化）、なしは rgb565（色の再現性が高い）
  const transparent = hasTransparency(opts.paletteSamples);
  const format: GifPixelFormat = transparent ? "rgba4444" : "rgb565";

  const merged = concatSamples(opts.paletteSamples);
  const palette: GifPalette = quantize(merged, 256, {
    format,
    // 半透明を「完全に透明」か「完全に不透明」へ寄せる。GIF は 1bit 透過しか持てない
    oneBitAlpha: transparent,
  });
  // 透過色として使うインデックス（アルファ 0 の色）。無ければ透過なしとして扱う
  const transparentIndex = transparent ? palette.findIndex((color) => color[3] === 0) : -1;

  const gif = GIFEncoder();
  let encoded = 0;
  for await (const frame of opts.frames) {
    throwIfAborted(opts.signal);
    const index = applyPalette(frame.rgba, palette, format);
    gif.writeFrame(index, opts.width, opts.height, {
      // パレットは先頭フレームのみ = グローバルカラーテーブル
      palette: encoded === 0 ? palette : undefined,
      delay: frame.delayMs,
      repeat: opts.repeat ?? 0,
      ...(transparentIndex >= 0
        ? {
            transparent: true,
            transparentIndex,
            // ここへ渡るのは常に「合成済みの全画面フレーム」なので、
            // 次フレームの前に画面を消去させる（disposal 2）。
            // 既定のままだと透過画素から前フレームが透けてしまい、
            // 元 GIF で消去されていた領域に残像が出る
            dispose: 2,
          }
        : {}),
    });
    encoded++;
    opts.onFrameEncoded?.(encoded);
    // 非同期ソース（動画のシーク）では自然に制御が戻るが、同期ソースでは
    // ここで返さないとスピナーが止まったまま UI が固まる
    if (encoded % YIELD_EVERY_FRAMES === 0) await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();

  const bytes = gif.bytes();
  if (bytes.byteLength > opts.maxBytes) throw new GifTooLargeError(bytes.byteLength);
  return bytes;
}

/** サンプル群を 1 本の RGBA 列に連結する（quantize は 1 枚の画像として受け取るため） */
function concatSamples(samples: Uint8ClampedArray[]): Uint8ClampedArray {
  if (samples.length === 1) return samples[0];
  const merged = new Uint8ClampedArray(samples.reduce((sum, s) => sum + s.length, 0));
  let offset = 0;
  for (const sample of samples) {
    merged.set(sample, offset);
    offset += sample.length;
  }
  return merged;
}

/**
 * 全体から最大 PALETTE_SAMPLE_FRAMES 枚を等間隔で選ぶための添字ステップ。
 * 呼び出し側が「どのフレームを余分に取得するか」を決めるのに使う。
 */
export function paletteSampleStep(frameCount: number): number {
  return Math.max(1, Math.ceil(frameCount / PALETTE_SAMPLE_FRAMES));
}
