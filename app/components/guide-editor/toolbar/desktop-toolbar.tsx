// デスクトップ常設ツールバー（Word ライクなリボン）。ヘッダー直下に sticky 固定。
// ブロック挿入・整形・メディア・埋め込み・メタ操作を一通り備える
// （slash コマンド / bubble メニューと併用できる発見可能な導線）。
import { Link } from "react-router";
import type { Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import {
  Undo2,
  Redo2,
  Save,
  Check,
  Loader2,
  Globe,
  Lock,
  Eye,
  Type,
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  Quote,
  Terminal,
  Lightbulb,
  ChevronRight,
  ChevronDown,
  Link as LinkIcon,
  ImageIcon,
  Table2,
  Minus,
  Columns2,
  Columns3,
  Keyboard,
  Package,
  FileText,
  Youtube as YoutubeIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton, ToolbarSeparator } from "./toolbar-button";
import { InlineColorPicker } from "../panels/color-picker";
import {
  setBlockType,
  insertTable,
  insertHorizontalRule,
  insertColumns,
  type BlockType,
} from "../lib/block-commands";
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
  previewUrl: string;
  // 挿入系（ダイアログ / プロンプトを開く）
  onImagePicker: () => void;
  onYoutube: () => void;
  onLink: () => void;
  onEmbed: (kind: "keybind" | "searchcraft") => void;
  onGuideLink: () => void;
}

const BLOCK_TYPES: { type: BlockType; label: string; icon: LucideIcon }[] = [
  { type: "paragraph", label: "テキスト", icon: Type },
  { type: "heading1", label: "見出し 1", icon: Heading1 },
  { type: "heading2", label: "見出し 2", icon: Heading2 },
  { type: "heading3", label: "見出し 3", icon: Heading3 },
  { type: "bulletList", label: "箇条書き", icon: List },
  { type: "orderedList", label: "番号付きリスト", icon: ListOrdered },
  { type: "blockquote", label: "引用", icon: Quote },
  { type: "codeBlock", label: "コードブロック", icon: Terminal },
  { type: "callout", label: "コールアウト", icon: Lightbulb },
  { type: "toggleList", label: "トグルリスト", icon: ChevronRight },
];

/** 現在の選択ブロックの種別表示 */
function currentBlock(editor: Editor): { label: string; icon: LucideIcon } {
  if (editor.isActive("heading", { level: 1 })) return { label: "見出し 1", icon: Heading1 };
  if (editor.isActive("heading", { level: 2 })) return { label: "見出し 2", icon: Heading2 };
  if (editor.isActive("heading", { level: 3 })) return { label: "見出し 3", icon: Heading3 };
  if (editor.isActive("bulletList")) return { label: "箇条書き", icon: List };
  if (editor.isActive("orderedList")) return { label: "番号付きリスト", icon: ListOrdered };
  if (editor.isActive("blockquote")) return { label: "引用", icon: Quote };
  if (editor.isActive("codeBlock")) return { label: "コードブロック", icon: Terminal };
  if (editor.isActive("callout")) return { label: "コールアウト", icon: Lightbulb };
  if (editor.isActive("toggleList")) return { label: "トグルリスト", icon: ChevronRight };
  return { label: "テキスト", icon: Type };
}

/** 保存状態のインジケーター（aria-live で読み上げ） */
function SaveIndicator({ status, lastSavedAt }: { status: SaveStatus; lastSavedAt: Date | null }) {
  const time = lastSavedAt
    ? lastSavedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap" aria-live="polite">
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
  onImagePicker,
  onYoutube,
  onLink,
  onEmbed,
  onGuideLink,
}: DesktopToolbarProps) {
  const block = currentBlock(editor);
  const BlockIcon = block.icon;

  return (
    <div
      className="sticky top-16 flex flex-wrap items-center gap-0.5 border-b bg-background/95 backdrop-blur px-2 py-1.5"
      style={{ zIndex: EDITOR_Z.toolbar }}
      role="toolbar"
      aria-label="エディタツールバー"
    >
      {/* 履歴 */}
      <ToolbarButton label="元に戻す" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="やり直し" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* ブロック種別 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            className="flex items-center gap-1.5 h-8 px-2 rounded-md text-sm hover:bg-muted transition-colors min-w-32"
            aria-label="ブロックの種別"
          >
            <BlockIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{block.label}</span>
            <ChevronDown className="h-3.5 w-3.5 ml-auto shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {BLOCK_TYPES.map((opt) => {
            const Icon = opt.icon;
            return (
              <DropdownMenuItem key={opt.type} onClick={() => setBlockType(editor, opt.type)}>
                <Icon className="h-4 w-4 text-muted-foreground" />
                {opt.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <ToolbarSeparator />

      {/* インライン整形 */}
      <ToolbarButton label={t("guideEditor.bold")} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t("guideEditor.italic")} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t("guideEditor.strike")} active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t("guideEditor.code")} active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="h-4 w-4" />
      </ToolbarButton>
      <InlineColorPicker editor={editor} />

      <ToolbarSeparator />

      {/* リスト・引用・コード */}
      <ToolbarButton label={t("guideEditor.unorderedList")} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t("guideEditor.orderedList")} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t("guideEditor.blockquote")} active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* 挿入: メディア・表・段組 */}
      <ToolbarButton label={t("guideEditor.link")} active={editor.isActive("link")} onClick={onLink}>
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t("guideEditor.image")} onClick={onImagePicker}>
        <ImageIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t("guideEditor.youtube")} onClick={onYoutube}>
        <YoutubeIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t("guideEditor.table")} onClick={() => insertTable(editor)}>
        <Table2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t("guideEditor.horizontalRule")} onClick={() => insertHorizontalRule(editor)}>
        <Minus className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="2 カラム" onClick={() => insertColumns(editor, 2)}>
        <Columns2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="3 カラム" onClick={() => insertColumns(editor, 3)}>
        <Columns3 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* 埋め込み */}
      <ToolbarButton label="ガイドリンク" onClick={onGuideLink}>
        <FileText className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t("guideEditor.embedKeybind")} onClick={() => onEmbed("keybind")}>
        <Keyboard className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label={t("guideEditor.embedSearchCraft")} onClick={() => onEmbed("searchcraft")}>
        <Package className="h-4 w-4" />
      </ToolbarButton>

      {/* メタ操作 */}
      <div className="ml-auto flex items-center gap-1.5">
        <SaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} />
        <Button type="button" variant="ghost" size="sm" onClick={onSave} disabled={saveStatus === "saving"}>
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
