import { useState, useRef, useCallback } from "react";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Upload, Trash2, AlertCircle, CheckCircle } from "lucide-react";
import { useT } from "@/hooks/use-locale";

interface CapeUploaderProps {
  userId: string;
  currentCapeUrl: string | null;
  onUploadComplete: (url: string) => void;
  onDelete: () => void;
}

// 64x32（標準）/ 22x17（旧形式）と、その HD（2x / 4x / 8x）
const VALID_CAPE_SIZES = [
  { w: 64, h: 32 },
  { w: 22, h: 17 },
  { w: 128, h: 64 },
  { w: 256, h: 128 },
  { w: 512, h: 256 },
];

export function CapeUploader({
  userId,
  currentCapeUrl,
  onUploadComplete,
  onDelete,
}: CapeUploaderProps) {
  const t = useT();
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
        setError(t("capeUploader.pngOnly"));
        return;
      }

      if (file.size > 1 * 1024 * 1024) {
        setError(t("capeUploader.maxSize"));
        return;
      }

      // 画像サイズを確認
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const isValidSize = VALID_CAPE_SIZES.some(
              (s) => img.width === s.w && img.height === s.h
            );
            if (!isValidSize) {
              reject(new Error(t("capeUploader.invalidSize")));
              return;
            }
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error(t("capeUploader.loadError")));
          };
          img.src = objectUrl;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : t("capeUploader.loadError"));
        return;
      }

      setIsUploading(true);

      try {
        // Vercel Blob にアップロード
        const blob = await upload(
          `capes/${userId}/cape.png`,
          file,
          {
            access: "public",
            handleUploadUrl: "/api/me/cape/upload-token",
          }
        );

        // DBに保存
        const response = await fetch("/api/me/cape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: blob.url,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || t("capeUploader.saveFailed"));
        }

        setSuccess(t("capeUploader.uploadSuccess"));
        onUploadComplete(blob.url);
      } catch (e) {
        console.error("Upload error:", e);
        setError(e instanceof Error ? e.message : t("capeUploader.uploadFailed"));
      } finally {
        setIsUploading(false);
        // ファイル入力をリセット
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [userId, onUploadComplete, t]
  );

  const handleDelete = useCallback(async () => {
    if (!currentCapeUrl) return;

    setError(null);
    setSuccess(null);
    setIsDeleting(true);

    try {
      const response = await fetch("/api/me/cape", {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t("capeUploader.deleteFailed"));
      }

      setSuccess(t("capeUploader.deleteSuccess"));
      onDelete();
    } catch (e) {
      console.error("Delete error:", e);
      setError(e instanceof Error ? e.message : t("capeUploader.deleteFailed"));
    } finally {
      setIsDeleting(false);
    }
  }, [currentCapeUrl, onDelete, t]);

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
          id="cape-upload"
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
              {t("capeUploader.uploading")}
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              {currentCapeUrl
                ? t("capeUploader.changeCape")
                : t("capeUploader.uploadCape")}
            </>
          )}
        </Button>

        {currentCapeUrl && (
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
            {t("capeUploader.deleteCape")}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("capeUploader.uploadHint")}
      </p>

      {/* 現在のカスタムマント表示（テクスチャの縦横比 2:1 のまま pixelated で表示） */}
      {currentCapeUrl && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-sm font-medium mb-2">{t("capeUploader.currentCape")}</p>
          <img
            src={currentCapeUrl}
            alt={t("capeUploader.currentCape")}
            className="h-16 w-auto border rounded"
            style={{ imageRendering: "pixelated" }}
          />
        </div>
      )}
    </div>
  );
}
