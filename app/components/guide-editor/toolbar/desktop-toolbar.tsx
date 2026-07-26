// デスクトップ常設ツールバー（タブ式リボン）。ヘッダー直下に fixed 固定。
// 常時表示: Undo/Redo・保存状態・仮保存/保存・設定。タブ: ホーム / 挿入 / テーブル。
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import type { Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import {
  Undo2,
  Redo2,
  Save,
  FileEdit,
  Check,
  Loader2,
  Settings,
  Eye,
  Type,
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Strikethrough,
  Underline as UnderlineIcon,
  Code,
  List,
  ListOrdered,
  Quote,
  Terminal,
  Lightbulb,
  Info,
  TriangleAlert,
  Siren,
  ChevronRight,
  ChevronDown,
  Link as LinkIcon,
  ImageIcon,
  Film,
  Table2,
  Minus,
  Columns2,
  Columns3,
  Keyboard,
  Package,
  FileText,
  Youtube as YoutubeIcon,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
  Combine,
  PanelTop,
  PanelLeft,
  AlignHorizontalDistributeCenter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton, ToolbarSeparator } from "./toolbar-button";
import { InlineColorPicker, TableStylePicker } from "../panels/color-picker";
import { FontSizePicker } from "../panels/font-size-picker";
import { useEditorRerender } from "../hooks/use-editor-rerender";
import {
  setBlockType,
  insertTable,
  insertHorizontalRule,
  insertColumns,
  insertCallout,
  insertToggle,
  applyTableOp,
  unifyColumnWidths,
  type BlockType,
  type CalloutType,
} from "../lib/block-commands";
import { EDITOR_Z } from "../constants";
import type { SaveMode } from "../hooks/use-guide-save";
import { useT, useLocale } from "@/hooks/use-locale";
import type { MessageKey } from "@/lib/messages";

type TabKey = "home" | "insert" | "table";

interface DesktopToolbarProps {
  editor: Editor;
  isDirty: boolean;
  saving: boolean;
  lastSaved: { mode: SaveMode; at: Date } | null;
  onSaveDraft: () => void;
  onSavePublish: () => void;
  onOpenSettings: () => void;
  previewUrl: string;
  onImagePicker: () => void;
  onYoutube: () => void;
  onVideoToGif: () => void;
  onLink: () => void;
  onEmbed: (kind: "keybind" | "searchcraft") => void;
  onGuideLink: () => void;
}

// テキストブロックの種別変換（ホームタブのドロップダウン）。
// コールアウト/トグルは「挿入」タブへ分離（種別を選んで挿入する性質のため）。
const BLOCK_TYPES: { type: BlockType; labelKey: MessageKey; icon: LucideIcon }[] = [
  { type: "paragraph", labelKey: "guideEditor.slash.text", icon: Type },
  { type: "heading1", labelKey: "guideEditor.slash.heading1", icon: Heading1 },
  { type: "heading2", labelKey: "guideEditor.slash.heading2", icon: Heading2 },
  { type: "heading3", labelKey: "guideEditor.slash.heading3", icon: Heading3 },
  { type: "bulletList", labelKey: "guideEditor.slash.bulletList", icon: List },
  { type: "orderedList", labelKey: "guideEditor.slash.orderedList", icon: ListOrdered },
  { type: "blockquote", labelKey: "guideEditor.slash.quote", icon: Quote },
  { type: "codeBlock", labelKey: "guideEditor.slash.codeBlock", icon: Terminal },
];

// コールアウト種別（挿入タブのドロップダウン）
const CALLOUT_TYPES: { type: CalloutType; labelKey: MessageKey; icon: LucideIcon }[] = [
  { type: "tip", labelKey: "guideEditor.callout.tip", icon: Lightbulb },
  { type: "info", labelKey: "guideEditor.callout.info", icon: Info },
  { type: "warning", labelKey: "guideEditor.callout.warning", icon: TriangleAlert },
  { type: "danger", labelKey: "guideEditor.callout.danger", icon: Siren },
];

const TABS: { key: TabKey; labelKey: MessageKey }[] = [
  { key: "home", labelKey: "guideEditor.toolbar.tabHome" },
  { key: "insert", labelKey: "guideEditor.toolbar.tabInsert" },
  { key: "table", labelKey: "guideEditor.toolbar.tabTable" },
];

function currentBlock(editor: Editor): { labelKey: MessageKey; icon: LucideIcon } {
  if (editor.isActive("heading", { level: 1 })) return { labelKey: "guideEditor.slash.heading1", icon: Heading1 };
  if (editor.isActive("heading", { level: 2 })) return { labelKey: "guideEditor.slash.heading2", icon: Heading2 };
  if (editor.isActive("heading", { level: 3 })) return { labelKey: "guideEditor.slash.heading3", icon: Heading3 };
  if (editor.isActive("bulletList")) return { labelKey: "guideEditor.slash.bulletList", icon: List };
  if (editor.isActive("orderedList")) return { labelKey: "guideEditor.slash.orderedList", icon: ListOrdered };
  if (editor.isActive("blockquote")) return { labelKey: "guideEditor.slash.quote", icon: Quote };
  if (editor.isActive("codeBlock")) return { labelKey: "guideEditor.slash.codeBlock", icon: Terminal };
  return { labelKey: "guideEditor.slash.text", icon: Type };
}

/** 保存状態インジケーター（aria-live） */
function SaveIndicator({
  isDirty,
  saving,
  lastSaved,
}: {
  isDirty: boolean;
  saving: boolean;
  lastSaved: { mode: SaveMode; at: Date } | null;
}) {
  const t = useT();
  const locale = useLocale();
  const time = lastSaved ? lastSaved.at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : null;
  if (saving) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("guideEditor.saving")}
      </span>
    );
  }
  if (isDirty) {
    // 未保存の変更あり → 警告色
    return (
      <span className="text-xs text-warning whitespace-nowrap" aria-live="polite">
        {t("guideEditor.toolbar.unsavedChanges")}
      </span>
    );
  }
  // 保存済み（変更なし）→ 成功色
  return (
    <span className="flex items-center gap-1 text-xs text-success whitespace-nowrap" aria-live="polite">
      <Check className="h-3.5 w-3.5" />
      {lastSaved?.mode === "draft" ? t("guideEditor.toolbar.savedDraft") : t("guideEditor.saved")}
      {time && <span className="tabular-nums">{time}</span>}
    </span>
  );
}

export function DesktopToolbar({
  editor,
  isDirty,
  saving,
  lastSaved,
  onSaveDraft,
  onSavePublish,
  onOpenSettings,
  previewUrl,
  onImagePicker,
  onYoutube,
  onVideoToGif,
  onLink,
  onEmbed,
  onGuideLink,
}: DesktopToolbarProps) {
  const t = useT();
  useEditorRerender(editor);
  const [tab, setTab] = useState<TabKey>("home");

  const block = currentBlock(editor);
  const BlockIcon = block.icon;
  const inTable = editor.isActive("table");

  // 「テーブル」タブはテーブル選択時のみ表示。テーブルから外れたら home へ戻す。
  useEffect(() => {
    if (tab === "table" && !inTable) setTab("home");
  }, [tab, inTable]);
  const visibleTabs = inTable ? TABS : TABS.filter((tt) => tt.key !== "table");

  // fixed 化に伴うスペーサー高さ計測
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => setBarHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div
        ref={barRef}
        className="fixed top-16 left-0 right-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        style={{ zIndex: EDITOR_Z.toolbar }}
        role="toolbar"
        aria-label={t("guideEditor.toolbar.ariaToolbar")}
      >
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          {/* 1段目: タブ + メタ操作 */}
          <div className="flex items-center gap-1 pt-1.5">
            <div className="flex items-center gap-0.5" role="tablist" aria-label={t("guideEditor.toolbar.ariaTabs")}>
              {visibleTabs.map(({ key, labelKey }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setTab(key)}
                  className={cn(
                    "relative h-7 px-3 rounded-t-md text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    "after:pointer-events-none after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full",
                    tab === key
                      ? "bg-muted/60 font-medium text-foreground after:bg-brand"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>

            {/* 右側: 設定 / プレビュー | 仮保存 / 保存 */}
            <div className="ml-auto flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" onClick={onOpenSettings}>
                    <Settings className="h-4 w-4" />
                    <span className="hidden md:inline">{t("guideEditor.toolbar.settings")}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" showArrow={false}>{t("guideEditor.toolbar.settings")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild type="button" variant="ghost" size="sm">
                    <Link to={previewUrl} target="_blank" rel="noopener noreferrer">
                      <Eye className="h-4 w-4" />
                      <span className="hidden md:inline">{t("guideEditor.preview")}</span>
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" showArrow={false}>{t("guideEditor.preview")}</TooltipContent>
              </Tooltip>
              <ToolbarSeparator />
              <Button type="button" variant="outline" size="sm" onClick={onSaveDraft} disabled={saving}>
                <FileEdit className="h-4 w-4" />
                <span className="hidden md:inline">{t("guideEditor.toolbar.saveDraft")}</span>
              </Button>
              <Button type="button" variant="default" size="sm" onClick={onSavePublish} disabled={saving}>
                <Save className="h-4 w-4" />
                <span className="hidden md:inline">{t("guideEditor.save")}</span>
              </Button>
            </div>
          </div>

          {/* 2段目: 常時表示の Undo/Redo + アクティブタブのツール */}
          <div className="flex flex-wrap items-center gap-0.5 py-1.5">
            <ToolbarButton label={t("guideEditor.toolbar.undo")} shortcut="Ctrl Z" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
              <Undo2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton label={t("guideEditor.toolbar.redo")} shortcut="Ctrl Shift Z" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
              <Redo2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarSeparator />

            {tab === "home" && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      className="flex items-center gap-1.5 h-8 px-2 rounded-md text-sm hover:bg-muted transition-colors min-w-32"
                      aria-label={t("guideEditor.toolbar.ariaBlockType")}
                    >
                      <BlockIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{t(block.labelKey)}</span>
                      <ChevronDown className="h-3.5 w-3.5 ml-auto shrink-0 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {BLOCK_TYPES.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <DropdownMenuItem key={opt.type} onClick={() => setBlockType(editor, opt.type)}>
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          {t(opt.labelKey)}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <ToolbarSeparator />
                <ToolbarButton label={t("guideEditor.bold")} shortcut="Ctrl B" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
                  <Bold className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.italic")} shortcut="Ctrl I" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
                  <Italic className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.toolbar.underline")} shortcut="Ctrl U" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
                  <UnderlineIcon className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.strike")} shortcut="Ctrl Shift S" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
                  <Strikethrough className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.code")} shortcut="Ctrl E" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
                  <Code className="h-4 w-4" />
                </ToolbarButton>
                <FontSizePicker editor={editor} />
      <InlineColorPicker editor={editor} />
                <ToolbarSeparator />
                <ToolbarButton label={t("guideEditor.unorderedList")} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
                  <List className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.orderedList")} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
                  <ListOrdered className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.blockquote")} active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
                  <Quote className="h-4 w-4" />
                </ToolbarButton>
              </>
            )}

            {tab === "insert" && (
              <>
                <ToolbarButton label={t("guideEditor.link")} active={editor.isActive("link")} onClick={onLink}>
                  <LinkIcon className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.image")} onClick={onImagePicker}>
                  <ImageIcon className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.gifTitle")} onClick={onVideoToGif}>
                  <Film className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.youtube")} onClick={onYoutube}>
                  <YoutubeIcon className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarSeparator />
                <ToolbarButton label={t("guideEditor.table")} onClick={() => insertTable(editor)}>
                  <Table2 className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.horizontalRule")} onClick={() => insertHorizontalRule(editor)}>
                  <Minus className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.slash.columns2")} onClick={() => insertColumns(editor, 2)}>
                  <Columns2 className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.slash.columns3")} onClick={() => insertColumns(editor, 3)}>
                  <Columns3 className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarSeparator />
                {/* コールアウト: 種別を選んで挿入 */}
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          className="flex items-center gap-1.5 h-8 px-2 rounded-md text-sm hover:bg-muted transition-colors"
                          aria-label={t("guideEditor.toolbar.ariaInsertCallout")}
                        >
                          <Lightbulb className="h-4 w-4 text-muted-foreground" />
                          <span className="hidden lg:inline">{t("guideEditor.toolbar.calloutLabel")}</span>
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" showArrow={false}>{t("guideEditor.toolbar.calloutLabel")}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" className="w-40">
                    {CALLOUT_TYPES.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <DropdownMenuItem key={opt.type} onClick={() => insertCallout(editor, opt.type)}>
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          {t(opt.labelKey)}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <ToolbarButton label={t("guideEditor.slash.toggleList")} onClick={() => insertToggle(editor)}>
                  <ChevronRight className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarSeparator />
                <ToolbarButton label={t("guideEditor.slash.guideLink")} onClick={onGuideLink}>
                  <FileText className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.embedKeybind")} onClick={() => onEmbed("keybind")}>
                  <Keyboard className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.embedSearchCraft")} onClick={() => onEmbed("searchcraft")}>
                  <Package className="h-4 w-4" />
                </ToolbarButton>
              </>
            )}

            {tab === "table" && (
              <>
                <ToolbarButton label={t("guideEditor.toolbar.addRowBefore")} disabled={!inTable} onClick={() => applyTableOp(editor, "addRowBefore")}>
                  <ArrowUpToLine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.toolbar.addRowAfter")} disabled={!inTable} onClick={() => applyTableOp(editor, "addRowAfter")}>
                  <ArrowDownToLine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.toolbar.deleteRow")} disabled={!inTable} onClick={() => applyTableOp(editor, "deleteRow")}>
                  <Trash2 className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarSeparator />
                <ToolbarButton label={t("guideEditor.toolbar.addColBefore")} disabled={!inTable} onClick={() => applyTableOp(editor, "addColBefore")}>
                  <ArrowLeftToLine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.toolbar.addColAfter")} disabled={!inTable} onClick={() => applyTableOp(editor, "addColAfter")}>
                  <ArrowRightToLine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.toolbar.deleteCol")} disabled={!inTable} onClick={() => applyTableOp(editor, "deleteCol")}>
                  <Trash2 className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.toolbar.unifyColWidths")} disabled={!inTable} onClick={() => unifyColumnWidths(editor)}>
                  <AlignHorizontalDistributeCenter className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarSeparator />
                <ToolbarButton label={t("guideEditor.toolbar.mergeOrSplit")} disabled={!inTable} onClick={() => applyTableOp(editor, "mergeOrSplit")}>
                  <Combine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.toolbar.toggleHeaderRow")} disabled={!inTable} onClick={() => applyTableOp(editor, "toggleHeaderRow")}>
                  <PanelTop className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.toolbar.toggleHeaderColumn")} disabled={!inTable} onClick={() => applyTableOp(editor, "toggleHeaderColumn")}>
                  <PanelLeft className="h-4 w-4" />
                </ToolbarButton>
                {inTable && <TableStylePicker editor={editor} />}
                <ToolbarSeparator />
                <ToolbarButton label={t("guideEditor.toolbar.deleteTable")} disabled={!inTable} onClick={() => applyTableOp(editor, "deleteTable")}>
                  <Table2 className="h-4 w-4" />
                </ToolbarButton>
              </>
            )}

            {/* 保存状態はツール行の右端に表示 */}
            <div className="ml-auto pl-2">
              <SaveIndicator isDirty={isDirty} saving={saving} lastSaved={lastSaved} />
            </div>
          </div>
        </div>
      </div>

      {/* fixed バーの高さ分のスペーサー */}
      <div aria-hidden style={{ height: barHeight }} />
    </>
  );
}
