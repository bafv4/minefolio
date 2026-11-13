import { useState, useRef, useCallback } from "react";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Upload, Trash2, AlertCircle, CheckCircle } from "lucide-react";

/** アップローダーが表示する文言（呼び出し側で翻訳済みの文字列を渡す） */
export interface PngTextureUploaderLabels {
  pngOnly: string;
  maxSize: string;
  invalidSize: string;
  loadError: string;
  saveFailed: string;
  uploadSuccess: string;
  uploadFailed: string;
  deleteFailed: string;
  deleteSuccess: string;
  uploading: string;
  /** 未設定時のアップロードボタン */
  upload: string;
  /** 設定済み時のアップロードボタン */
  change: string;
  delete: string;
  hint: string;
  current: string;
}

export interface PngTextureUploaderProps {
  /** Blob パス `${blobDir}/${userId}/${kind}.png` と API パス `/api/me/${kind}` の決定に使う */
  kind: "skin" | "cape";
  /** Blob の保存ディレクトリ（例: "skins" / "capes"） */
  blobDir: string;
  userId: string;
  currentUrl: string | null;
  /** 許可する画像サイズ（ピクセル） */
  validSizes: readonly { w: number; h: number }[];
  labels: PngTextureUploaderLabels;
  /** 現在のテクスチャのプレビュー img の alt */
  previewAlt: string;
  /** 現在のテクスチャのプレビュー img の className */
  previewClassName: string;
  onUploadComplete: (url: string) => void;
  onDelete: () => void;
}

/** スキン・マント共通の PNG テクスチャアップローダー（Vercel Blob → /api/me/{kind} に URL を保存） */
export function PngTextureUploader({
  kind,
  blobDir,
  userId,
  currentUrl,
  validSizes,
  labels,
  previewAlt,
  previewClassName,
  onUploadComplete,
  onDelete,
}: PngTextureUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setError(null);
      setSuccess(null);

      // バリデーション
      if (file.type !== "image/png") {
        setError(labels.pngOnly);
        return;
      }

      if (file.size > 1 * 1024 * 1024) {
        setError(labels.maxSize);
        return;
      }

      // 画像サイズを確認
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const isValidSize = validSizes.some(
              (s) => img.width === s.w && img.height === s.h
            );
            if (!isValidSize) {
              reject(new Error(labels.invalidSize));
              return;
            }
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error(labels.loadError));
          };
          img.src = objectUrl;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : labels.loadError);
        return;
      }

      setIsUploading(true);

      try {
        // Vercel Blob にアップロード
        const blob = await upload(
          `${blobDir}/${userId}/${kind}.png`,
          file,
          {
            access: "public",
            handleUploadUrl: `/api/me/${kind}/upload-token`,
          }
        );

        // DBに保存
        const response = await fetch(`/api/me/${kind}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: blob.url,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || labels.saveFailed);
        }

        setSuccess(labels.uploadSuccess);
        onUploadComplete(blob.url);
      } catch (e) {
        console.error("Upload error:", e);
        setError(e instanceof Error ? e.message : labels.uploadFailed);
      } finally {
        setIsUploading(false);
        // ファイル入力をリセット
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [kind, blobDir, userId, validSizes, labels, onUploadComplete]
  );

  const handleDelete = useCallback(async () => {
    if (!currentUrl) return;

    setError(null);
    setSuccess(null);
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/me/${kind}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || labels.deleteFailed);
      }

      setSuccess(labels.deleteSuccess);
      onDelete();
    } catch (e) {
      console.error("Delete error:", e);
      setError(e instanceof Error ? e.message : labels.deleteFailed);
    } finally {
      setIsDeleting(false);
    }
  }, [kind, currentUrl, labels, onDelete]);

  return (
    <div className="space-y-3">
      {/* エラー/成功メッセージ */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* ファイルアップロード */}
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          onChange={handleFileSelect}
          className="hidden"
          id={`${kind}-upload`}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || isDeleting}
        >
          {isUploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {labels.uploading}
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              {currentUrl ? labels.change : labels.upload}
            </>
          )}
        </Button>

        {currentUrl && (
          <Button
            type="button"
            variant="ghost"
            onClick={handleDelete}
            disabled={isUploading || isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            {labels.delete}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{labels.hint}</p>

      {/* 現在のカスタムテクスチャ表示 */}
      {currentUrl && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-sm font-medium mb-2">{labels.current}</p>
          <img
            src={currentUrl}
            alt={previewAlt}
            className={previewClassName}
            style={{ imageRendering: "pixelated" }}
          />
        </div>
      )}
    </div>
  );
}
