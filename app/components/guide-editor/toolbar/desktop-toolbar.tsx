// デスクトップ常設ツールバー（縮小版）。
// ブロック挿入は slash、インライン整形は bubble、ブロック操作は handle に委譲したため、
// ここではメタ操作のみ: Undo/Redo・保存状態・手動保存・公開トグル・プレビュー。
import { Link } from "react-router";
import type { Editor } from "@tiptap/core";
import { Undo2, Redo2, Save, Check, Loader2, Globe, Lock, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolbarButton, ToolbarSeparator } from "./toolbar-button";
import { EDITOR_Z } from "../constants";
import type { SaveStatus } from "../types";
import { t } from "@/lib/messages";

interface DesktopToolbarProps {
  editor: Editor;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  onSave: () => void;
  isPublished: boolean;
  onTogglePublish: (next: boolean) => void;
  /** 公開ページへのリンク（プレビュー） */
  previewUrl: string;
}

/** 保存状態のインジケーター（aria-live で読み上げ） */
function SaveIndicator({ status, lastSavedAt }: { status: SaveStatus; lastSavedAt: Date | null }) {
  const time = lastSavedAt
    ? lastSavedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      {status === "saving" && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("guideEditor.saving")}
        </>
      )}
      {status === "saved" && (
        <>
          <Check className="h-3.5 w-3.5 text-success" />
          {t("guideEditor.saved")}
          {time && <span className="tabular-nums">{time}</span>}
        </>
      )}
      {status === "unsaved" && <span>{t("guideEditor.unsaved")}</span>}
    </span>
  );
}

export function DesktopToolbar({
  editor,
  saveStatus,
  lastSavedAt,
  onSave,
  isPublished,
  onTogglePublish,
  previewUrl,
}: DesktopToolbarProps) {
  return (
    <div
      className="sticky top-16 flex items-center gap-1 border-b bg-background/95 backdrop-blur px-1 py-1"
      style={{ zIndex: EDITOR_Z.toolbar }}
      role="toolbar"
      aria-label="エディタツールバー"
    >
      <ToolbarButton
        label="元に戻す"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="やり直し"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <SaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} />

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSave}
          disabled={saveStatus === "saving"}
        >
          <Save className="h-4 w-4" />
          {t("guideEditor.save")}
        </Button>

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

        <Button asChild type="button" variant="ghost" size="sm">
          <Link to={previewUrl} target="_blank" rel="noopener noreferrer">
            <Eye className="h-4 w-4" />
            {t("guideEditor.preview")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
