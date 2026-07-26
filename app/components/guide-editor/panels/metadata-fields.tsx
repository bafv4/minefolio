// ガイドのメタ情報入力（タイトル / カバー画像 / 概要 / タグ）。
// 設定モーダル内で使う一般的なフォームスタイル（ラベル + ボーダー付き入力）。
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ImagePlus, Trash2, Loader2, AlertCircle, X } from "lucide-react";
import { useT } from "@/hooks/use-locale";

interface MetadataFieldsProps {
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
}

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;

export function MetadataFields({
  title,
  onTitleChange,
  summary,
  onSummaryChange,
  tags,
  onAddTag,
  onRemoveTag,
  coverImageUrl,
  onCoverUpload,
  onCoverRemove,
  isUploadingCover,
  uploadError,
}: MetadataFieldsProps) {
  const t = useT();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [tagInput, setTagInput] = useState("");

  const addTag = () => {
    const trimmed = tagInput.trim().slice(0, MAX_TAG_LENGTH);
    if (trimmed && !tags.includes(trimmed) && tags.length < MAX_TAGS) {
      onAddTag(trimmed);
      setTagInput("");
    }
  };

  return (
    <div className="space-y-4">
      {/* タイトル */}
      <div className="space-y-1.5">
        <Label htmlFor="guide-title">{t("guideEditor.ui.titleLabel")}</Label>
        <Input
          id="guide-title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder={t("guideEditor.titlePlaceholder")}
          spellCheck={false}
        />
      </div>

      {/* 概要 */}
      <div className="space-y-1.5">
        <Label htmlFor="guide-summary">{t("guideEditor.ui.summaryLabel")}</Label>
        <Textarea
          id="guide-summary"
          value={summary}
          onChange={(e) => onSummaryChange(e.target.value)}
          placeholder={t("guideEditor.summaryPlaceholder")}
          spellCheck={false}
          rows={3}
        />
      </div>

      {/* カバー画像 */}
      <div className="space-y-1.5">
        <Label>{t("guideEditor.ui.coverImage")}</Label>
        <div className="flex items-center gap-3">
          {coverImageUrl ? (
            <div className="relative group">
              <img
                src={coverImageUrl}
                alt={t("guideEditor.ui.thumbnailAlt")}
                className="h-20 rounded-lg object-cover aspect-2/1 border"
              />
              <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 rounded-lg">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      className="h-7 w-7 flex items-center justify-center bg-white/90 text-gray-700 rounded-md text-xs"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("guideEditor.ui.change")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={onCoverRemove}
                      className="h-7 w-7 flex items-center justify-center bg-white/90 text-destructive rounded-md text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("guideEditor.ui.delete")}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              disabled={isUploadingCover}
              className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground border border-dashed rounded-lg hover:bg-muted/50 transition-colors"
            >
              {isUploadingCover ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {t("guideEditor.ui.addThumbnail")}
            </button>
          )}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onCoverUpload(file);
              e.target.value = "";
            }}
          />
        </div>
        {/* アップロードエラー（カバー画像セクション内に表示） */}
        {uploadError && (
          <div
            className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
            role="alert"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {uploadError}
          </div>
        )}
      </div>

      {/* タグ */}
      <div className="space-y-1.5">
        <Label htmlFor="guide-tag-input">{t("guideEditor.ui.tagsLabel")}</Label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-3 py-2 min-h-9 focus-within:ring-1 focus-within:ring-ring">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button
                type="button"
                onClick={() => onRemoveTag(tag)}
                aria-label={t("guideEditor.ui.removeTag", { tag })}
                className="hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {tags.length < MAX_TAGS && (
            <input
              id="guide-tag-input"
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
                  onRemoveTag(tags[tags.length - 1]);
                }
              }}
              placeholder={tags.length === 0 ? t("guideEditor.tagPlaceholder") : ""}
              spellCheck={false}
              className="flex-1 min-w-24 bg-transparent text-sm outline-none"
            />
          )}
        </div>
      </div>
    </div>
  );
}
