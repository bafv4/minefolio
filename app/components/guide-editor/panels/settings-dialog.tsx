// ガイド設定モーダル（タイトル / 概要 / カバー画像 / タグ / 公開設定）。
// ツールバーの「設定」ボタンから開く。公開のオン/オフはここで設定し、「保存」で確定する。
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Globe, Lock } from "lucide-react";
import { MetadataFields } from "./metadata-fields";
import { t } from "@/lib/messages";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // メタ情報
  title: string;
  onTitleChange: (value: string) => void;
  summary: string;
  onSummaryChange: (value: string) => void;
  tags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  coverImageUrl: string | null;
  onCoverUpload: (file: File) => void;
  onCoverRemove: () => void;
  isUploadingCover: boolean;
  uploadError: string | null;
  // 公開設定
  isPublished: boolean;
  onTogglePublish: (next: boolean) => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  isPublished,
  onTogglePublish,
  ...metaProps
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ガイド設定</DialogTitle>
          <DialogDescription>
            タイトル・概要・カバー画像・タグ・公開設定を編集します。「保存」で確定されます。
          </DialogDescription>
        </DialogHeader>

        <MetadataFields {...metaProps} />

        {/* 公開設定 */}
        <div className="flex items-center justify-between rounded-lg border p-3 mt-1">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{t("guideEditor.published")}</p>
            <p className="text-xs text-muted-foreground">
              {isPublished
                ? "このガイドは公開されています。"
                : "下書きです。「保存」で公開状態を確定します。"}
            </p>
          </div>
          <Button
            type="button"
            variant={isPublished ? "default" : "outline"}
            size="sm"
            onClick={() => onTogglePublish(!isPublished)}
            aria-pressed={isPublished}
          >
            {isPublished ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {isPublished ? t("guideEditor.published") : t("guideEditor.draft")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
