// Vercel Blob への画像アップロード共通フック（本文画像 / カバー画像で再利用）。
// アップロード前にクライアント側で縮小＋webp/jpeg 再エンコードし、サーバの
// content-type / サイズ上限で弾かれにくくする。
import { useState, useCallback } from "react";
import { upload } from "@vercel/blob/client";
import {
  prepareImageForUpload,
  UnsupportedImageError,
  ImageTooLargeError,
  type PrepareImageOptions,
} from "../lib/image-processing";

const HANDLE_UPLOAD_URL = "/api/me/guides/upload-image";
const ERROR_CLEAR_MS = 5000;

/** アップロードの上限バイト数（サーバの maximumSizeInBytes と一致させる） */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** カバー画像の処理プリセット（サムネイル用途なので長辺は控えめ） */
export const COVER_IMAGE_PREPARE: PrepareImageOptions = {
  maxDimension: 1600,
  maxBytes: MAX_UPLOAD_BYTES,
};

/** 本文画像の処理プリセット（本文幅いっぱいまで想定） */
export const INLINE_IMAGE_PREPARE: PrepareImageOptions = {
  maxDimension: 1920,
  maxBytes: MAX_UPLOAD_BYTES,
};

export interface UploadImageOptions extends PrepareImageOptions {
  /** その他の失敗に使う一般エラー文言 */
  errorMessage: string;
}

export interface UseImageUploadResult {
  /**
   * 画像を整えて pathBase（拡張子なし）へアップロードし、成功時は公開 URL を返す（失敗時 null）。
   * 実際のパスは処理後の拡張子を付与した `${pathBase}.${ext}` になる。
   */
  uploadTo: (pathBase: string, file: File, opts: UploadImageOptions) => Promise<string | null>;
  isUploading: boolean;
  error: string | null;
}

function messageFor(e: unknown, fallback: string): string {
  if (e instanceof UnsupportedImageError) {
    return "この画像形式には対応していません。JPEG / PNG などで保存し直してからお試しください。";
  }
  if (e instanceof ImageTooLargeError) {
    return `画像サイズが大きすぎます（上限 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB）。`;
  }
  return fallback;
}

/**
 * 単一のアップロード状態（isUploading / error）を持つフック。
 * 本文画像とカバー画像で独立した状態が必要なため、用途ごとに 1 インスタンス生成する。
 */
export function useImageUpload(): UseImageUploadResult {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadTo = useCallback(
    async (pathBase: string, file: File, opts: UploadImageOptions): Promise<string | null> => {
      setIsUploading(true);
      setError(null);
      try {
        const prepared = await prepareImageForUpload(file, opts);
        const ext = prepared.name.split(".").pop()?.toLowerCase() || "webp";
        const blob = await upload(`${pathBase}.${ext}`, prepared, {
          access: "public",
          handleUploadUrl: HANDLE_UPLOAD_URL,
        });
        return blob.url;
      } catch (e) {
        console.error("Image upload failed:", e);
        setError(messageFor(e, opts.errorMessage));
        setTimeout(() => setError(null), ERROR_CLEAR_MS);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  return { uploadTo, isUploading, error };
}

/** 本文画像の Blob パス（拡張子なし）。実拡張子は処理後に付与される。 */
export function buildInlineImagePath(userId: string, guideId: string): string {
  return `guides/${userId}/${guideId}/images/${crypto.randomUUID()}`;
}

/** カバー画像の Blob パス（拡張子なし）。実拡張子は処理後に付与される。 */
export function buildCoverImagePath(userId: string, guideId: string): string {
  return `guides/${userId}/${guideId}/cover`;
}
