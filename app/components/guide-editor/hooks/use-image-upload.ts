// Vercel Blob への画像アップロード共通フック（本文画像 / カバー画像で再利用）。
// 旧 index.tsx の handleImageUpload / handleCoverUpload から重複ロジックを集約。
import { useState, useCallback } from "react";
import { upload } from "@vercel/blob/client";

const HANDLE_UPLOAD_URL = "/api/me/guides/upload-image";
const ERROR_CLEAR_MS = 4000;

/** ファイル名から拡張子を取り出す（既定 png） */
function extOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() || "png";
}

export interface UseImageUploadResult {
  /** 指定パスへアップロードし、成功時は公開 URL を返す（失敗時 null） */
  uploadTo: (path: string, file: File, errorMessage: string) => Promise<string | null>;
  isUploading: boolean;
  error: string | null;
}

/**
 * 単一のアップロード状態（isUploading / error）を持つフック。
 * 本文画像とカバー画像で独立した状態が必要なため、用途ごとに 1 インスタンス生成する。
 */
export function useImageUpload(): UseImageUploadResult {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadTo = useCallback(
    async (path: string, file: File, errorMessage: string): Promise<string | null> => {
      setIsUploading(true);
      setError(null);
      try {
        const blob = await upload(path, file, {
          access: "public",
          handleUploadUrl: HANDLE_UPLOAD_URL,
        });
        return blob.url;
      } catch (e) {
        console.error("Image upload failed:", e);
        setError(errorMessage);
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

/** 本文画像の Blob パスを生成（旧実装と同一: guides/{userId}/{guideId}/images/{uuid}.{ext}） */
export function buildInlineImagePath(userId: string, guideId: string, file: File): string {
  return `guides/${userId}/${guideId}/images/${crypto.randomUUID()}.${extOf(file)}`;
}

/** カバー画像の Blob パスを生成（旧実装と同一: guides/{userId}/{guideId}/cover.{ext}） */
export function buildCoverImagePath(userId: string, guideId: string, file: File): string {
  return `guides/${userId}/${guideId}/cover.${extOf(file)}`;
}
