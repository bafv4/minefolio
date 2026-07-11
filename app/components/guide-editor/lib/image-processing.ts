// アップロード前のクライアント側画像処理。
// 実機写真（HEIC/大サイズ等）をそのまま送るとサーバの content-type / サイズ上限で
// 弾かれるため、ブラウザでデコード→縮小→webp/jpeg 再エンコードして正規化する。

/** ブラウザでデコードできない形式（例: Chrome の HEIC）や再エンコード失敗 */
export class UnsupportedImageError extends Error {
  constructor() {
    super("UNSUPPORTED_IMAGE");
    this.name = "UnsupportedImageError";
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
