import { useMemo } from "react";
import { PngTextureUploader } from "@/components/png-texture-uploader";
import { useT } from "@/hooks/use-locale";

interface SkinUploaderProps {
  userId: string;
  currentSkinUrl: string | null;
  onUploadComplete: (url: string) => void;
  onDelete: () => void;
}

// 64x64 または 64x32（レガシー）または 128x128（HD）を許可
const VALID_SKIN_SIZES = [
  { w: 64, h: 64 },
  { w: 64, h: 32 },
  { w: 128, h: 128 },
] as const;

export function SkinUploader({
  userId,
  currentSkinUrl,
  onUploadComplete,
  onDelete,
}: SkinUploaderProps) {
  const t = useT();
  const labels = useMemo(
    () => ({
      pngOnly: t("skinUploader.pngOnly"),
      maxSize: t("skinUploader.maxSize"),
      invalidSize: t("skinUploader.invalidSize"),
      loadError: t("skinUploader.loadError"),
      saveFailed: t("skinUploader.saveFailed"),
      uploadSuccess: t("skinUploader.uploadSuccess"),
      uploadFailed: t("skinUploader.uploadFailed"),
      deleteFailed: t("skinUploader.deleteFailed"),
      deleteSuccess: t("skinUploader.deleteSuccess"),
      uploading: t("skinUploader.uploading"),
      upload: t("skinUploader.uploadSkin"),
      change: t("skinUploader.changeSkin"),
      delete: t("skinUploader.deleteSkin"),
      hint: t("skinUploader.uploadHint"),
      current: t("skinUploader.currentSkin"),
    }),
    [t],
  );

  return (
    <PngTextureUploader
      kind="skin"
      blobDir="skins"
      userId={userId}
      currentUrl={currentSkinUrl}
      validSizes={VALID_SKIN_SIZES}
      labels={labels}
      previewAlt="Custom skin"
      previewClassName="w-16 h-16 border rounded"
      onUploadComplete={onUploadComplete}
      onDelete={onDelete}
    />
  );
}
