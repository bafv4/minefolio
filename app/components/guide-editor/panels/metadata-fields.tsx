// ガイドのメタ情報入力（タイトル / カバー画像 / 概要 / タグ）。
// 旧 index.tsx のメタ欄 JSX を制御コンポーネントとして切り出す。
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ImagePlus, Trash2, Loader2, AlertCircle } from "lucide-react";
import { t } from "@/lib/messages";

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
    <div className="space-y-3 mt-4">
      {/* タイトル */}
      <input
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder={t("guideEditor.titlePlaceholder")}
        aria-label={t("guideEditor.titlePlaceholder")}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="w-full text-2xl font-bold bg-transparent border-none outline-none focus:ring-0 p-0"
      />

      {/* カバー画像 */}
      <div className="flex items-center gap-3">
        {coverImageUrl ? (
          <div className="relative group">
            <img
              src={coverImageUrl}
              alt="サムネイル"
              className="h-20 rounded-lg object-cover aspect-2/1"
            />
            <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 rounded-lg">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="h-7 w-7 flex items-center justify-center bg-white/90 text-gray-700 rounded-md text-xs"
                title="変更"
              >
                <ImagePlus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onCoverRemove}
                className="h-7 w-7 flex items-center justify-center bg-white/90 text-destructive rounded-md text-xs"
                title="削除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            disabled={isUploadingCover}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground border border-dashed rounded-lg hover:bg-muted/50 transition-colors"
          >
            {isUploadingCover ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            サムネイル画像を追加
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

      {/* 概要 */}
      <Input
        value={summary}
        onChange={(e) => onSummaryChange(e.target.value)}
        placeholder={t("guideEditor.summaryPlaceholder")}
        aria-label={t("guideEditor.summaryPlaceholder")}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="text-sm"
      />

      {/* タグ */}
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="cursor-pointer select-none"
            onClick={() => onRemoveTag(tag)}
          >
            {tag} ×
          </Badge>
        ))}
        {tags.length < MAX_TAGS && (
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder={t("guideEditor.tagPlaceholder")}
            aria-label={t("guideEditor.tagPlaceholder")}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="text-sm bg-transparent border-none outline-none focus:ring-0 min-w-24"
          />
        )}
      </div>

      {/* アップロードエラー */}
      {uploadError && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {uploadError}
        </div>
      )}
    </div>
  );
}
