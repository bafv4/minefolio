// ガイド設定モーダル（タイトル / 概要 / カバー画像 / タグ / 公開設定）。
// モーダル内はローカル State を持ち、「反映」で親 State へコミット、「キャンセル」で破棄する。
// ※ 反映は保存・仮保存ではなく、あくまで全体 State への反映のみ。
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MetadataFields } from "./metadata-fields";
import { t } from "@/lib/messages";

export interface GuideSettingsValues {
  title: string;
  summary: string;
  tags: string[];
  coverImageUrl: string | null;
  isPublished: boolean;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** モーダルを開いたときの初期値（親 State のスナップショット） */
  initialValues: GuideSettingsValues;
  /** カバー画像を Blob へアップロードし URL を返す（即時アップロード） */
  uploadCover: (file: File) => Promise<string | null>;
  isUploadingCover: boolean;
  uploadError: string | null;
  /** 反映: モーダル内 State を親 State へコミット（保存はしない） */
  onApply: (values: GuideSettingsValues) => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialValues,
  uploadCover,
  isUploadingCover,
  uploadError,
  onApply,
}: SettingsDialogProps) {
  // ── モーダル内ローカル State ──
  const [title, setTitle] = useState(initialValues.title);
  const [summary, setSummary] = useState(initialValues.summary);
  const [tags, setTags] = useState<string[]>(initialValues.tags);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initialValues.coverImageUrl);
  const [isPublished, setIsPublished] = useState(initialValues.isPublished);

  // 開くたびに親の現在値で再初期化（前回のキャンセル分を引きずらない）
  useEffect(() => {
    if (open) {
      setTitle(initialValues.title);
      setSummary(initialValues.summary);
      setTags(initialValues.tags);
      setCoverImageUrl(initialValues.coverImageUrl);
      setIsPublished(initialValues.isPublished);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleCoverUpload = async (file: File) => {
    const url = await uploadCover(file);
    if (url) setCoverImageUrl(url);
  };

  const apply = () => {
    onApply({ title, summary, tags, coverImageUrl, isPublished });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ガイド設定</DialogTitle>
          <DialogDescription>
            タイトル・概要・カバー画像・タグ・公開設定を編集します。「反映」で編集中の内容へ反映されます（保存は別途行ってください）。
          </DialogDescription>
        </DialogHeader>

        <MetadataFields
          title={title}
          onTitleChange={setTitle}
          summary={summary}
          onSummaryChange={setSummary}
          tags={tags}
          onAddTag={(tag) => setTags((prev) => [...prev, tag])}
          onRemoveTag={(tag) => setTags((prev) => prev.filter((x) => x !== tag))}
          coverImageUrl={coverImageUrl}
          onCoverUpload={handleCoverUpload}
          onCoverRemove={() => setCoverImageUrl(null)}
          isUploadingCover={isUploadingCover}
          uploadError={uploadError}
        />

        {/* 公開設定（トグル） */}
        <div className="flex items-center justify-between rounded-lg border p-3 mt-1">
          <div className="space-y-0.5">
            <Label htmlFor="guide-publish-toggle">{t("guideEditor.published")}</Label>
            <p className="text-xs text-muted-foreground">
              {isPublished
                ? "公開する（保存時に公開状態が反映されます）"
                : "下書き（保存時に非公開のままになります）"}
            </p>
          </div>
          <Switch
            id="guide-publish-toggle"
            checked={isPublished}
            onCheckedChange={setIsPublished}
            aria-label={t("guideEditor.published")}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button type="button" onClick={apply}>
            反映
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
