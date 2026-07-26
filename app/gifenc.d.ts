/**
 * gifenc（1.0.3）の型定義。本体は型を同梱していないため、README の API から手書きする。
 * 使用箇所: app/components/guide-editor/lib/video-to-gif.ts
 */
declare module "gifenc" {
  /** 色フォーマット。RGB のみか、アルファ付きか */
  export type GifPixelFormat = "rgb565" | "rgb444" | "rgba4444";

  /** カラーパレット。各要素は [r, g, b] または [r, g, b, a]（0..255） */
  export type GifPalette = number[][];

  export interface QuantizeOptions {
    format?: GifPixelFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  /** RGBA 画素列を maxColors 以下のパレットへ減色する */
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): GifPalette;

  /** RGBA 画素列を、パレット中の最近傍色のインデックス列（1 画素 1 バイト）に変換する */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifPixelFormat,
  ): Uint8Array;

  export interface GifFrameOptions {
    /** 省略時は最初のフレームのグローバルカラーテーブルを使う */
    palette?: GifPalette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    /** フレームの表示時間（ミリ秒） */
    delay?: number;
    /** -1 = 1 回だけ / 0 = 無限 / 正数 = 回数 */
    repeat?: number;
    dispose?: number;
  }

  export interface GifStream {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifFrameOptions,
    ): void;
    /** 終端バイトを書く（これを呼ばないと再生できない） */
    finish(): void;
    // 内部バッファは通常の ArrayBuffer。型引数を明示しないと Blob/File へ渡せない
    bytes(): Uint8Array<ArrayBuffer>;
    bytesView(): Uint8Array<ArrayBuffer>;
    reset(): void;
    writeHeader(): void;
  }

  export function GIFEncoder(options?: {
    auto?: boolean;
    initialCapacity?: number;
  }): GifStream;
}
