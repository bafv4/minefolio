/**
 * omggif（1.0.10）の型定義。本体は型を同梱していないため、ソースから手書きする。
 * 実装では GifReader（デコード）のみ使う。エンコードは gifenc（app/gifenc.d.ts）が担当。
 * GifWriter はテストで検証用の GIF を組み立てるのに使う。
 * 使用箇所: app/components/guide-editor/lib/gif-crop.ts
 */
declare module "omggif" {
  export interface GifFrameInfo {
    /** フレーム矩形の左上（キャンバス全体に対する座標） */
    x: number;
    y: number;
    /** フレーム矩形の大きさ（GIF はフレームごとに部分更新できる） */
    width: number;
    height: number;
    has_local_palette: boolean;
    palette_offset: number;
    palette_size: number;
    data_offset: number;
    data_length: number;
    /** 透過色のパレットインデックス。透過なしなら null */
    transparent_index: number | null;
    interlaced: boolean;
    /** 表示時間。単位は GIF 仕様どおり 1/100 秒（センチ秒） */
    delay: number;
    /** 廃棄方法。0/1=そのまま, 2=背景で消去, 3=直前の状態へ復元 */
    disposal: number;
  }

  export class GifReader {
    constructor(buf: Uint8Array);
    /** 論理画面（全フレーム合成後）の大きさ */
    readonly width: number;
    readonly height: number;
    numFrames(): number;
    /** ループ回数。null=指定なし（1 回のみ）, 0=無限, n=n 回 */
    loopCount(): number | null;
    frameInfo(frameNum: number): GifFrameInfo;
    /**
     * フレームを RGBA バッファへ合成する。pixels は論理画面全体
     * （width × height × 4）で、透過画素は書き換えずに残す＝前フレームが透ける。
     * 廃棄方法（disposal）の処理は呼び出し側の責務。
     */
    decodeAndBlitFrameRGBA(frameNum: number, pixels: Uint8Array | Uint8ClampedArray): void;
    decodeAndBlitFrameBGRA(frameNum: number, pixels: Uint8Array | Uint8ClampedArray): void;
  }

  export interface GifWriterOptions {
    /** ループ回数。省略=指定なし（1 回のみ）, 0=無限 */
    loop?: number;
    /** グローバルカラーテーブル。各要素は 0xRRGGBB。長さは 2 の冪（2..256） */
    palette?: number[];
  }

  export interface GifWriterFrameOptions {
    /** ローカルカラーテーブル（省略時はグローバルを使う） */
    palette?: number[];
    /** 表示時間（センチ秒 = 1/100 秒） */
    delay?: number;
    /** 0/1=そのまま, 2=背景で消去, 3=直前の状態へ復元 */
    disposal?: number;
    /** 透過色のパレットインデックス */
    transparent?: number | null;
  }

  export class GifWriter {
    /** buf は書き込み先。出力に足りる大きさを事前に確保しておくこと */
    constructor(
      buf: Uint8Array,
      width: number,
      height: number,
      options?: GifWriterOptions,
    );
    addFrame(
      x: number,
      y: number,
      width: number,
      height: number,
      indexedPixels: Uint8Array | number[],
      options?: GifWriterFrameOptions,
    ): number;
    /** 終端を書き、出力の総バイト数を返す */
    end(): number;
  }
}
