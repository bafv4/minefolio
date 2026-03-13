import { useState, useRef, useCallback } from "react";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Upload, Trash2, AlertCircle, CheckCircle } from "lucide-react";
import { t } from "@/lib/messages";

interface SkinUploaderProps {
  userId: string;
  currentSkinUrl: string | null;
  onUploadComplete: (url: string) => void;
  onDelete: () => void;
}

export function SkinUploader({
  userId,
  currentSkinUrl,
  onUploadComplete,
  onDelete,
}: SkinUploaderProps) {
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
        setError(t("skinUploader.pngOnly"));
        return;
      }

      if (file.size > 1 * 1024 * 1024) {
        setError(t("skinUploader.maxSize"));
        return;
      }

      // 画像サイズを確認
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            // 64x64 または 64x32（レガシー）または 128x128（HD）を許可
            const validSizes = [
              { w: 64, h: 64 },
              { w: 64, h: 32 },
              { w: 128, h: 128 },
            ];
            const isValidSize = validSizes.some(
              (s) => img.width === s.w && img.height === s.h
            );
            if (!isValidSize) {
              reject(new Error(t("skinUploader.invalidSize")));
              return;
            }
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error(t("skinUploader.loadError")));
          };
          img.src = objectUrl;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : t("skinUploader.loadError"));
        return;
      }

      setIsUploading(true);

      try {
        // Vercel Blob にアップロード
        const blob = await upload(
          `skins/${userId}/skin.png`,
          file,
          {
            access: "public",
            handleUploadUrl: "/api/me/skin/upload-token",
          }
        );

        // DBに保存
        const response = await fetch("/api/me/skin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: blob.url,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || t("skinUploader.saveFailed"));
        }

        setSuccess(t("skinUploader.uploadSuccess"));
        onUploadComplete(blob.url);
      } catch (e) {
        console.error("Upload error:", e);
        setError(e instanceof Error ? e.message : t("skinUploader.uploadFailed"));
      } finally {
        setIsUploading(false);
        // ファイル入力をリセット
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [userId, onUploadComplete]
  );

  const handleDelete = useCallback(async () => {
    if (!currentSkinUrl) return;

    setError(null);
    setSuccess(null);
    setIsDeleting(true);

    try {
      const response = await fetch("/api/me/skin", {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t("skinUploader.deleteFailed"));
      }

      setSuccess(t("skinUploader.deleteSuccess"));
      onDelete();
    } catch (e) {
      console.error("Delete error:", e);
      setError(e instanceof Error ? e.message : t("skinUploader.deleteFailed"));
    } finally {
      setIsDeleting(false);
    }
  }, [currentSkinUrl, onDelete]);

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
          id="skin-upload"
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
              {t("skinUploader.uploading")}
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              {currentSkinUrl
                ? t("skinUploader.changeSkin")
                : t("skinUploader.uploadSkin")}
            </>
          )}
        </Button>

        {currentSkinUrl && (
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
            {t("skinUploader.deleteSkin")}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("skinUploader.uploadHint")}
      </p>

      {/* 現在のカスタムスキン表示 */}
      {currentSkinUrl && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-sm font-medium mb-2">{t("skinUploader.currentSkin")}</p>
          <img
            src={currentSkinUrl}
            alt="Custom skin"
            className="w-16 h-16 border rounded"
            style={{ imageRendering: "pixelated" }}
          />
        </div>
      )}
    </div>
  );
}
