import { useMemo } from "react";
import { PngTextureUploader } from "@/components/png-texture-uploader";
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
] as const;

export function CapeUploader({
  userId,
  currentCapeUrl,
  onUploadComplete,
  onDelete,
}: CapeUploaderProps) {
  const t = useT();
  const labels = useMemo(
    () => ({
      pngOnly: t("capeUploader.pngOnly"),
      maxSize: t("capeUploader.maxSize"),
      invalidSize: t("capeUploader.invalidSize"),
      loadError: t("capeUploader.loadError"),
      saveFailed: t("capeUploader.saveFailed"),
      uploadSuccess: t("capeUploader.uploadSuccess"),
      uploadFailed: t("capeUploader.uploadFailed"),
      deleteFailed: t("capeUploader.deleteFailed"),
      deleteSuccess: t("capeUploader.deleteSuccess"),
      uploading: t("capeUploader.uploading"),
      upload: t("capeUploader.uploadCape"),
      change: t("capeUploader.changeCape"),
      delete: t("capeUploader.deleteCape"),
      hint: t("capeUploader.uploadHint"),
      current: t("capeUploader.currentCape"),
    }),
    [t],
  );

  return (
    <PngTextureUploader
      kind="cape"
      blobDir="capes"
      userId={userId}
      currentUrl={currentCapeUrl}
      validSizes={VALID_CAPE_SIZES}
      labels={labels}
      previewAlt={labels.current}
      // テクスチャの縦横比 2:1 のまま pixelated で表示
      previewClassName="h-16 w-auto border rounded"
      onUploadComplete={onUploadComplete}
      onDelete={onDelete}
    />
  );
}
