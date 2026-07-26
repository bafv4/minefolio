// アップロード前のクライアント側画像処理。
// 実機写真（HEIC/大サイズ等）をそのまま送るとサーバの content-type / サイズ上限で
// 弾かれるため、ブラウザでデコード→縮小→webp/jpeg 再エンコードして正規化する。
// アップロード済み画像のトリミング（cropImageFromUrl）もここに置く。
import { toPixelRect, type CropRect } from "./image-crop";

/** ブラウザでデコードできない形式（例: Chrome の HEIC）や再エンコード失敗 */
export class UnsupportedImageError extends Error {
  constructor() {
    super("UNSUPPORTED_IMAGE");
    this.name = "UnsupportedImageError";
  }
}

/** アップロード済み画像を取得できない（CORS 不許可・URL 失効・オフライン等） */
export class ImageLoadError extends Error {
  constructor() {
    super("IMAGE_LOAD_FAILED");
    this.name = "ImageLoadError";
  }
}

/** 再エンコード後もサイズ上限を超える（主にアニメ GIF） */
export class ImageTooLargeError extends Error {
  constructor() {
    super("IMAGE_TOO_LARGE");
    this.name = "ImageTooLargeError";
  }
}

export interface PrepareImageOptions {
  /** 長辺の最大ピクセル数（これを超える画像は縮小する） */
  maxDimension: number;
  /** 出力の最大バイト数（超えると ImageTooLargeError） */
  maxBytes: number;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** webp 優先で canvas をエンコード。webp 非対応環境は jpeg にフォールバック。 */
async function encodeCanvas(
  canvas: HTMLCanvasElement,
): Promise<{ blob: Blob; ext: string; type: string }> {
  // 一部ブラウザは webp 非対応時に PNG を返すため type を検証する
  const webp = await canvasToBlob(canvas, "image/webp", 0.85);
  if (webp && webp.type === "image/webp") {
    return { blob: webp, ext: "webp", type: "image/webp" };
  }
  const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.85);
  if (jpeg) return { blob: jpeg, ext: "jpg", type: "image/jpeg" };
  throw new UnsupportedImageError();
}

/**
 * アップロード用に画像を整える。
 * - GIF: アニメーション保持のため無加工（サイズ超過時のみ ImageTooLargeError）
 * - それ以外: 長辺を maxDimension に縮小し webp（不可なら jpeg）へ再エンコード
 * - デコード不可な形式は UnsupportedImageError
 */
export async function prepareImageForUpload(
  file: File,
  opts: PrepareImageOptions,
): Promise<File> {
  if (file.type === "image/gif") {
    if (file.size > opts.maxBytes) throw new ImageTooLargeError();
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // HEIC 等、当該ブラウザがデコードできない形式
    throw new UnsupportedImageError();
  }

  try {
    const scale = Math.min(1, opts.maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UnsupportedImageError();
    ctx.drawImage(bitmap, 0, 0, width, height);

    const { blob, ext, type } = await encodeCanvas(canvas);
    if (blob.size > opts.maxBytes) throw new ImageTooLargeError();

    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${base}.${ext}`, { type });
  } finally {
    bitmap.close();
  }
}

/**
 * canvas 経由の加工でアニメーションが失われる形式か。
 * GIF は createImageBitmap すると 1 フレーム目だけの静止画になるため、
 * トリミングは canvas ではなく gif-crop.ts の全フレーム再エンコードへ回す。
 * 判定は拡張子と data URL の MIME の両方（allowBase64 の貼り付け経路がある）。
 */
export function isAnimatedImageUrl(src: string): boolean {
  return /^data:image\/gif[;,]/i.test(src) || /\.gif(?:[?#]|$)/i.test(src);
}

/**
 * アップロード済みの画像を取得し、正規化矩形で切り出した File を返す。
 *
 * 出力を PNG（可逆）にしているのは、この後 prepareImageForUpload が webp へ
 * 再エンコードするため。ここで webp にすると非可逆変換が 2 回かかる。
 * 画像の取得には CORS が必要（Vercel Blob の公開 URL は許可されている）。
 */
export async function cropImageFromUrl(
  src: string,
  rect: CropRect,
  fileName: string,
): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bitmap = await createImageBitmap(await res.blob(), { imageOrientation: "from-image" });
  } catch {
    throw new ImageLoadError();
  }

  try {
    const { sx, sy, sw, sh } = toPixelRect(rect, bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UnsupportedImageError();
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await canvasToBlob(canvas, "image/png", 1);
    if (!blob) throw new UnsupportedImageError();
    return new File([blob], fileName, { type: "image/png" });
  } finally {
    bitmap.close();
  }
}
