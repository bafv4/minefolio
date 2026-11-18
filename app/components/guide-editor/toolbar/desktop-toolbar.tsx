// デスクトップ常設ツールバー（タブ式リボン）。ヘッダー直下に fixed 固定。
// 常時表示: 設定・プレビュー・保存状態・公開状態・下書き保存/保存（公開）（1段目）と Undo/Redo（2段目）。タブ: ホーム / 挿入 / テーブル。
import { useState, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
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
  CircleHelp,
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
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
  Combine,
  PanelTop,
  PanelLeft,
  AlignHorizontalDistributeCenter,
  LayoutTemplate,
  Globe,
  Lock,
} from "lucide-react";
import { Youtube as YoutubeIcon } from "@/components/brand-icons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/status-pill";
import { GUIDE_WRITING_GUIDE_PATH } from "@/lib/official-guides";
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
import {
  getPublishAction,
  PUBLISH_ACTION_MESSAGES,
  type SaveMode,
} from "../hooks/use-guide-save";
import { useT, useLocale } from "@/hooks/use-locale";
import type { MessageKey } from "@/lib/messages";

type TabKey = "home" | "insert" | "table";

interface DesktopToolbarProps {
  editor: Editor;
  isDirty: boolean;
  saving: boolean;
  lastSaved: { mode: SaveMode; at: Date } | null;
  /** いま読者に公開されているか（保存済みの isPublished） */
  livePublished: boolean;
  /** 公開の設定（設定モーダルのスイッチ。未保存の変更を含む） */
  publishSetting: boolean;
  /** 下書き保存を出すか（公開版があるときだけ。use-guide-save の hasDraftSave）。false なら保存ボタンは1つ */
  draftSaveAvailable: boolean;
  /** 下書き保存した内容（DB のドラフト）があるか。未保存の変更が無くても「公開」でドラフトを公開版へ反映できる */
  hasSavedDraft: boolean;
  onSaveDraft: () => void;
  onSavePublish: () => void;
  onOpenSettings: () => void;
  previewUrl: string;
  onImagePicker: () => void;
  onYoutube: () => void;
  onVideoToGif: () => void;
  onLink: () => void;
  onEmbed: (kind: "keybind" | "searchcraft") => void;
  onTemplateEmbed: () => void;
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

/** タブと 2 段目のツール群（tabpanel）を結ぶ id */
const tabId = (key: TabKey) => `guide-toolbar-tab-${key}`;
const TAB_PANEL_ID = "guide-toolbar-tabpanel";

/**
 * 保存のショートカット（index.tsx のキー監視と揃える。表記は他のツールの "Ctrl B" 等と同じ流儀）。
 * 下書き保存があればそのボタン、無ければ唯一の保存ボタンに付ける
 */
const SAVE_SHORTCUT = "Ctrl S";
const SAVE_ARIA_KEYSHORTCUTS = "Control+S Meta+S";

/**
 * 挿入タブの Minefolio 固有の埋め込み（短い文字＋ツールチップの説明）。
 * 語は / メニュー（slash-command/items.ts）と同じ「ガイドリンク」「リマップ」「サーチクラフト」「テンプレート」
 */
const EMBED_TOOLS: {
  key: "guideLink" | "keybind" | "searchcraft" | "template";
  icon: LucideIcon;
  shortKey: MessageKey;
  labelKey: MessageKey;
}[] = [
  { key: "guideLink", icon: FileText, shortKey: "guideEditor.toolbar.embedShortGuideLink", labelKey: "guideEditor.slash.guideLink" },
  { key: "keybind", icon: Keyboard, shortKey: "guideEditor.toolbar.embedShortKeybind", labelKey: "guideEditor.embedKeybind" },
  { key: "searchcraft", icon: Package, shortKey: "guideEditor.toolbar.embedShortSearchCraft", labelKey: "guideEditor.embedSearchCraft" },
  { key: "template", icon: LayoutTemplate, shortKey: "guideEditor.toolbar.embedShortTemplate", labelKey: "guideEditor.embedTemplate" },
];

/**
 * アイコン＋短い文字のツールボタン（名前は見えている文字。ツールチップに説明）。文字は ToolbarButton の
 * showLabel と同じ text-xs（ツール行をデスクトップの幅〔max-w-5xl〕で1行に収めるため）
 */
function LabeledToolButton({
  label,
  hint,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          className="flex h-8 items-center gap-1 rounded-md px-1.5 text-xs whitespace-nowrap hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" showArrow={false} className="z-[65]">{hint}</TooltipContent>
    </Tooltip>
  );
}

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
    // 未保存の変更あり → 警告色。見た目は短い「未保存」、読み上げは完全な文（ui.md 9 章。1段目に収めるため）
    return (
      <span className="text-xs text-warning whitespace-nowrap" aria-live="polite">
        <span aria-hidden>{t("guideEditor.toolbar.unsavedShort")}</span>
        <span className="sr-only">{t("guideEditor.toolbar.unsavedChanges")}</span>
      </span>
    );
  }
  // 保存済み（変更なし）→ 平常なので色は付けない（色で知らせるのは「未保存」の warning だけ）
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap" aria-live="polite">
      <Check className="h-3.5 w-3.5" />
      {lastSaved?.mode === "draft" ? t("guideEditor.toolbar.savedDraft") : t("guideEditor.saved")}
      {time && <span className="tabular-nums">{time}</span>}
    </span>
  );
}

/** 公開状態のピル（ui.md 6 章「丸ピル」）。公開の設定が保存済みの状態と違うときは「未保存」を添えて警告色にする */
function PublishStatusPill({ livePublished, publishSetting }: { livePublished: boolean; publishSetting: boolean }) {
  const t = useT();
  const action = getPublishAction(livePublished, publishSetting);
  const pending = livePublished !== publishSetting;
  return (
    <StatusPill icon={livePublished ? Globe : Lock} tone={pending ? "warning" : "default"}>
      {t(PUBLISH_ACTION_MESSAGES[action].status)}
    </StatusPill>
  );
}

/** ツールチップの本文（説明＋任意のショートカット）。ToolbarButton の表示と同じ kbd の見た目 */
function HintTooltipContent({ hint, shortcut }: { hint: string; shortcut?: string }) {
  return (
    <TooltipContent side="bottom" showArrow={false} className="z-[65] flex max-w-72 items-center gap-2">
      <span>{hint}</span>
      {shortcut && (
        <kbd className="shrink-0 rounded border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </TooltipContent>
  );
}

export function DesktopToolbar({
  editor,
  isDirty,
  saving,
  lastSaved,
  livePublished,
  publishSetting,
  draftSaveAvailable,
  hasSavedDraft,
  onSaveDraft,
  onSavePublish,
  onOpenSettings,
  previewUrl,
  onImagePicker,
  onYoutube,
  onVideoToGif,
  onLink,
  onEmbed,
  onTemplateEmbed,
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

  // タブは roving tabindex（選択中だけ Tab で止まる）。左右の矢印・Home/End でフォーカスと選択を移す
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  const handleTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = visibleTabs.map((tt) => tt.key);
    const current = keys.indexOf(tab);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (current + 1) % keys.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + keys.length) % keys.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = keys.length - 1;
    if (next === null) return;
    e.preventDefault();
    const nextKey = keys[next];
    setTab(nextKey);
    tabRefs.current[nextKey]?.focus();
  };

  const publishAction = getPublishAction(livePublished, publishSetting);
  const publishMessages = PUBLISH_ACTION_MESSAGES[publishAction];
  // 公開版が無いガイドでは Ctrl+S がこのボタンと同じ保存をする。ただし初めて公開する保存はショートカットでは行わない（index.tsx）
  const shortcutSavesHere = !draftSaveAvailable && publishAction !== "publish";
  // 保存しても何も変わらないときは押せない状態にする（Ctrl+S が変更の無いときに何もしないのと揃える）。
  // フォーカスとツールチップは残すため disabled ではなく aria-disabled（保存中は従来どおり disabled）。
  // 下書き保存は未保存の変更があるときだけ。保存（公開）は、未保存の変更・下書き保存した内容（公開版へ反映できる）・
  // 未保存の公開の設定のどれかがあるとき
  const draftSaveInert = !isDirty;
  const publishSaveInert = !isDirty && !hasSavedDraft && livePublished === publishSetting;

  // fixed 化に伴うスペーサー高さ計測
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    // 高さは :root の scroll-padding-top（app/app.css の --sticky-bar-inset）にも渡し、Tab で移った
    // フォーカスがヘッダー下に fixed のこのツールバーに隠れないようにする（WCAG 2.4.11）
    const root = document.documentElement;
    const update = () => {
      setBarHeight(el.offsetHeight);
      root.style.setProperty("--editor-toolbar-height", `${el.offsetHeight}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--editor-toolbar-height");
    };
  }, []);

  return (
    <>
      <div
        ref={barRef}
        data-editor-toolbar=""
        className="fixed top-16 left-0 right-0 border-b bg-background"
        style={{ zIndex: EDITOR_Z.toolbar }}
        role="toolbar"
        aria-label={t("guideEditor.toolbar.ariaToolbar")}
      >
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          {/* 1段目: タブ + メタ操作 */}
          {/* 1段目は折り返さない幅に収めている。書き方の手引きのアイコンを足した後は、非公開の状態の 1280px（ja）で
              1行（コンテンツ幅 960px）に収まることを実測済み。公開中・未公開の変更あり・保存ボタン2つの状態と、
              en の最も長い状態は未実測。
              それでも足りないときは、操作の塊ごと次の行へ回す（はみ出して切れないように） */}
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1.5">
            <div
              className="flex items-center gap-0.5"
              role="tablist"
              aria-label={t("guideEditor.toolbar.ariaTabs")}
              onKeyDown={handleTabKeyDown}
            >
              {visibleTabs.map(({ key, labelKey }) => (
                <button
                  key={key}
                  ref={(el) => {
                    tabRefs.current[key] = el;
                  }}
                  id={tabId(key)}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  aria-controls={TAB_PANEL_ID}
                  tabIndex={tab === key ? 0 : -1}
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

            {/* 右側: 書き方の手引き / 設定 / プレビュー | 保存状態 / 公開状態 / 下書き保存 / 保存（公開） */}
            <div className="ml-auto flex items-center gap-1.5">
              {/* 書き方の手引き（公式ガイド）。1段目の幅に余裕が無いのでアイコンだけにし、名前は sr-only で
                  「新しいタブで開く」ことまで伝える */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild type="button" variant="ghost" size="sm">
                    <Link to={GUIDE_WRITING_GUIDE_PATH} target="_blank" rel="noopener noreferrer">
                      <CircleHelp className="h-4 w-4" aria-hidden />
                      <span className="sr-only">
                        {t("meGuides.writingGuide")}
                        {t("meGuides.opensInNewTab")}
                      </span>
                    </Link>
                  </Button>
                </TooltipTrigger>
                <HintTooltipContent hint={`${t("meGuides.writingGuide")}${t("meGuides.opensInNewTab")}`} />
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* 見える文字は短い「設定」、名前は「ガイド設定」（見える文字を含む。label in name） */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onOpenSettings}
                    aria-label={t("guideEditor.toolbar.settings")}
                  >
                    <Settings className="h-4 w-4" />
                    <span className="hidden md:inline">{t("guideEditor.toolbar.settingsShort")}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" showArrow={false}>{t("guideEditor.toolbar.settings")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild type="button" variant="ghost" size="sm">
                    <Link to={previewUrl} target="_blank" rel="noopener noreferrer">
                      <Eye className="h-4 w-4" aria-hidden />
                      <span className="hidden md:inline">{t("guideEditor.preview")}</span>
                      {/* 新しいタブで開くことを読み上げでも伝える（書き方の手引きのリンクと同じ文） */}
                      <span className="sr-only">{t("meGuides.opensInNewTab")}</span>
                    </Link>
                  </Button>
                </TooltipTrigger>
                {/* プレビューは下書き保存した内容を開く。未保存の変更があるときはそれが含まれないことを伝える */}
                <HintTooltipContent
                  hint={t(isDirty ? "guideEditor.toolbar.previewUnsavedHint" : "guideEditor.toolbar.previewHint")}
                />
              </Tooltip>
              <ToolbarSeparator />
              {/* 保存状態は保存ボタンの隣に置く（ツール行は挿入タブの文字付きの埋め込みで幅を使うので、
                  「未保存の変更があります」で折り返さないよう、余裕のある1段目へ） */}
              <SaveIndicator isDirty={isDirty} saving={saving} lastSaved={lastSaved} />
              <PublishStatusPill livePublished={livePublished} publishSetting={publishSetting} />
              {/* 下書き保存は公開版があるときだけ（公開版が無ければ保存ボタン1つ。Ctrl+S もそれ） */}
              {draftSaveAvailable && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={draftSaveInert ? undefined : onSaveDraft}
                      disabled={saving}
                      aria-disabled={draftSaveInert || undefined}
                      className={cn(draftSaveInert && "opacity-50")}
                      aria-keyshortcuts={SAVE_ARIA_KEYSHORTCUTS}
                    >
                      <FileEdit className="h-4 w-4" />
                      <span className="hidden md:inline">{t("guideEditor.toolbar.saveDraft")}</span>
                    </Button>
                  </TooltipTrigger>
                  <HintTooltipContent hint={t("guideEditor.toolbar.saveDraftHint")} shortcut={SAVE_SHORTCUT} />
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={publishSaveInert ? undefined : onSavePublish}
                    disabled={saving}
                    aria-disabled={publishSaveInert || undefined}
                    className={cn(publishSaveInert && "opacity-50")}
                    aria-keyshortcuts={shortcutSavesHere ? SAVE_ARIA_KEYSHORTCUTS : undefined}
                  >
                    <Save className="h-4 w-4" />
                    <span className="hidden md:inline">{t(publishMessages.label)}</span>
                  </Button>
                </TooltipTrigger>
                <HintTooltipContent
                  hint={t(publishMessages.hint)}
                  shortcut={shortcutSavesHere ? SAVE_SHORTCUT : undefined}
                />
              </Tooltip>
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

            {/* アクティブなタブのツール群（Undo/Redo はタブに依らないので外に置く） */}
            <div
              id={TAB_PANEL_ID}
              role="tabpanel"
              aria-labelledby={tabId(tab)}
              className="flex flex-wrap items-center gap-0.5"
            >
            {tab === "home" && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      className="flex items-center gap-1.5 h-8 px-2 rounded-md text-sm hover:bg-muted transition-colors min-w-32"
                      // 名前は見えている種別名で始める（label in name、WCAG 2.5.3）
                      aria-label={t("guideEditor.toolbar.ariaBlockTypeNamed", { type: t(block.labelKey) })}
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
                {/* ほかのツールボタンと同じ 32px（バブルメニューの中では従来の 28px のまま） */}
                <FontSizePicker editor={editor} size="default" />
                <InlineColorPicker editor={editor} size="default" />
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
                <ToolbarButton
                  label={t("guideEditor.table")}
                  description={t("guideEditor.ui.tableSearchStrHint")}
                  onClick={() => insertTable(editor)}
                >
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
                          {/* 文字は出さない（名前は aria-label、説明はツールチップ）。末尾の埋め込みのグループに文字を
                              付けたぶん、ツール行を1行に収めるため */}
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
                {/* Minefolio 固有の埋め込み。ほかの汎用ツールと見分けられるよう、文字付きのボタンのグループにする */}
                <div role="group" aria-label={t("guideEditor.toolbar.embedGroup")} className="flex items-center gap-0.5">
                  {EMBED_TOOLS.map(({ key, icon: Icon, shortKey, labelKey }) => (
                    <LabeledToolButton
                      key={key}
                      label={t(shortKey)}
                      hint={t(labelKey)}
                      onClick={
                        key === "guideLink"
                          ? onGuideLink
                          : key === "template"
                            ? onTemplateEmbed
                            : () => onEmbed(key)
                      }
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </LabeledToolButton>
                  ))}
                </div>
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
            </div>
          </div>
        </div>
      </div>

      {/* fixed バーの高さ分のスペーサー */}
      <div aria-hidden style={{ height: barHeight }} />
    </>
  );
}
