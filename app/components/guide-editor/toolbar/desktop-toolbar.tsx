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
import { InlineColorPicker, CellColorPicker } from "../panels/color-picker";
import { useEditorRerender } from "../hooks/use-editor-rerender";
import {
  setBlockType,
  insertTable,
  insertHorizontalRule,
  insertColumns,
  insertCallout,
  insertToggle,
  applyTableOp,
  type BlockType,
  type CalloutType,
} from "../lib/block-commands";
import { EDITOR_Z } from "../constants";
import type { SaveMode } from "../hooks/use-guide-save";
import { t } from "@/lib/messages";

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
  onLink: () => void;
  onEmbed: (kind: "keybind" | "searchcraft") => void;
  onGuideLink: () => void;
}

// テキストブロックの種別変換（ホームタブのドロップダウン）。
// コールアウト/トグルは「挿入」タブへ分離（種別を選んで挿入する性質のため）。
const BLOCK_TYPES: { type: BlockType; label: string; icon: LucideIcon }[] = [
  { type: "paragraph", label: "テキスト", icon: Type },
  { type: "heading1", label: "見出し 1", icon: Heading1 },
  { type: "heading2", label: "見出し 2", icon: Heading2 },
  { type: "heading3", label: "見出し 3", icon: Heading3 },
  { type: "bulletList", label: "箇条書き", icon: List },
  { type: "orderedList", label: "番号付きリスト", icon: ListOrdered },
  { type: "blockquote", label: "引用", icon: Quote },
  { type: "codeBlock", label: "コードブロック", icon: Terminal },
];

// コールアウト種別（挿入タブのドロップダウン）
const CALLOUT_TYPES: { type: CalloutType; label: string; icon: LucideIcon }[] = [
  { type: "tip", label: "ヒント", icon: Lightbulb },
  { type: "info", label: "情報", icon: Info },
  { type: "warning", label: "警告", icon: TriangleAlert },
  { type: "danger", label: "危険", icon: Siren },
];

const TABS: { key: TabKey; label: string }[] = [
  { key: "home", label: "ホーム" },
  { key: "insert", label: "挿入" },
  { key: "table", label: "テーブル" },
];

function currentBlock(editor: Editor): { label: string; icon: LucideIcon } {
  if (editor.isActive("heading", { level: 1 })) return { label: "見出し 1", icon: Heading1 };
  if (editor.isActive("heading", { level: 2 })) return { label: "見出し 2", icon: Heading2 };
  if (editor.isActive("heading", { level: 3 })) return { label: "見出し 3", icon: Heading3 };
  if (editor.isActive("bulletList")) return { label: "箇条書き", icon: List };
  if (editor.isActive("orderedList")) return { label: "番号付きリスト", icon: ListOrdered };
  if (editor.isActive("blockquote")) return { label: "引用", icon: Quote };
  if (editor.isActive("codeBlock")) return { label: "コードブロック", icon: Terminal };
  return { label: "テキスト", icon: Type };
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
  const time = lastSaved ? lastSaved.at.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : null;
  if (saving) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        保存中…
      </span>
    );
  }
  if (isDirty) {
    // 未保存の変更あり → 警告色
    return (
      <span className="text-xs text-warning whitespace-nowrap" aria-live="polite">
        未保存の変更があります
      </span>
    );
  }
  // 保存済み（変更なし）→ 成功色
  return (
    <span className="flex items-center gap-1 text-xs text-success whitespace-nowrap" aria-live="polite">
      <Check className="h-3.5 w-3.5" />
      {lastSaved?.mode === "draft" ? "仮保存済み" : "保存済み"}
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
  onLink,
  onEmbed,
  onGuideLink,
}: DesktopToolbarProps) {
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
        aria-label="エディタツールバー"
      >
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          {/* 1段目: タブ + メタ操作 */}
          <div className="flex items-center gap-1 pt-1.5">
            <div className="flex items-center gap-0.5" role="tablist" aria-label="ツールバータブ">
              {visibleTabs.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setTab(key)}
                  className={cn(
                    "h-7 px-3 rounded-md text-sm transition-colors",
                    tab === key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 右側: 設定 / プレビュー | 仮保存 / 保存 */}
            <div className="ml-auto flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" onClick={onOpenSettings}>
                    <Settings className="h-4 w-4" />
                    <span className="hidden md:inline">ガイド設定</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" showArrow={false}>ガイド設定</TooltipContent>
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
                <span className="hidden md:inline">仮保存</span>
              </Button>
              <Button type="button" variant="default" size="sm" onClick={onSavePublish} disabled={saving}>
                <Save className="h-4 w-4" />
                <span className="hidden md:inline">{t("guideEditor.save")}</span>
              </Button>
            </div>
          </div>

          {/* 2段目: 常時表示の Undo/Redo + アクティブタブのツール */}
          <div className="flex flex-wrap items-center gap-0.5 py-1.5">
            <ToolbarButton label="元に戻す" shortcut="Ctrl Z" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
              <Undo2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton label="やり直し" shortcut="Ctrl Shift Z" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
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
                <ToolbarButton label={t("guideEditor.bold")} shortcut="Ctrl B" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
                  <Bold className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.italic")} shortcut="Ctrl I" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
                  <Italic className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="下線" shortcut="Ctrl U" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
                  <UnderlineIcon className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.strike")} shortcut="Ctrl Shift S" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
                  <Strikethrough className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label={t("guideEditor.code")} shortcut="Ctrl E" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
                  <Code className="h-4 w-4" />
                </ToolbarButton>
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
                <ToolbarButton label="2 カラム" onClick={() => insertColumns(editor, 2)}>
                  <Columns2 className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="3 カラム" onClick={() => insertColumns(editor, 3)}>
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
                          aria-label="コールアウトを挿入"
                        >
                          <Lightbulb className="h-4 w-4 text-muted-foreground" />
                          <span className="hidden lg:inline">コールアウト</span>
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" showArrow={false}>コールアウト</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" className="w-40">
                    {CALLOUT_TYPES.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <DropdownMenuItem key={opt.type} onClick={() => insertCallout(editor, opt.type)}>
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          {opt.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <ToolbarButton label="トグルリスト" onClick={() => insertToggle(editor)}>
                  <ChevronRight className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarSeparator />
                <ToolbarButton label="ガイドリンク" onClick={onGuideLink}>
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
                <ToolbarButton label="上に行を追加" disabled={!inTable} onClick={() => applyTableOp(editor, "addRowBefore")}>
                  <ArrowUpToLine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="下に行を追加" disabled={!inTable} onClick={() => applyTableOp(editor, "addRowAfter")}>
                  <ArrowDownToLine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="行を削除" disabled={!inTable} onClick={() => applyTableOp(editor, "deleteRow")}>
                  <Trash2 className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarSeparator />
                <ToolbarButton label="左に列を追加" disabled={!inTable} onClick={() => applyTableOp(editor, "addColBefore")}>
                  <ArrowLeftToLine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="右に列を追加" disabled={!inTable} onClick={() => applyTableOp(editor, "addColAfter")}>
                  <ArrowRightToLine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="列を削除" disabled={!inTable} onClick={() => applyTableOp(editor, "deleteCol")}>
                  <Trash2 className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarSeparator />
                <ToolbarButton label="セルを結合 / 分割" disabled={!inTable} onClick={() => applyTableOp(editor, "mergeOrSplit")}>
                  <Combine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="見出し行を切替" disabled={!inTable} onClick={() => applyTableOp(editor, "toggleHeaderRow")}>
                  <PanelTop className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="見出し列を切替" disabled={!inTable} onClick={() => applyTableOp(editor, "toggleHeaderColumn")}>
                  <PanelLeft className="h-4 w-4" />
                </ToolbarButton>
                {inTable && <CellColorPicker editor={editor} />}
                <ToolbarSeparator />
                <ToolbarButton label="テーブルを削除" disabled={!inTable} onClick={() => applyTableOp(editor, "deleteTable")}>
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
