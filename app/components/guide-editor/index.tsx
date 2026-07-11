// ガイドエディタのエントリ。メタ欄 + ツールバー + Tiptap 本文を組み立てる薄い宿主。
// 旧 2993 行の単一実装を責務分割し、extensions/ node-views/ slash-command/ panels/
// toolbar/ hooks/ へ移譲した結果のコンポジション層。
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import { EditorContent } from "@tiptap/react";
import { ArrowLeft, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useMediaQuery } from "@/hooks/use-media-query";
import { t } from "@/lib/messages";
import type { GuideEditorProps, SlashCommandContext } from "./types";
import type { SlashCommandStorage } from "./extensions/slash-command";
import { useGuideEditor } from "./hooks/use-guide-editor";
import { useGuideSave } from "./hooks/use-guide-save";
import {
  useImageUpload,
  buildInlineImagePath,
  buildCoverImagePath,
  COVER_IMAGE_PREPARE,
  INLINE_IMAGE_PREPARE,
} from "./hooks/use-image-upload";
import { useUnsavedWarning } from "./hooks/use-unsaved-warning";
import { insertEmbed, insertGuideLink } from "./lib/block-commands";
import { SettingsDialog } from "./panels/settings-dialog";
import { EmbedDialog, type EmbedKind } from "./panels/embed-dialog";
import { GuideLinkSearch, type GuideSearchResult } from "./panels/guide-link-search";
import { DesktopToolbar } from "./toolbar/desktop-toolbar";
import { EditorBubbleMenu } from "./toolbar/bubble-menu";
import { MobileToolbar } from "./toolbar/mobile-toolbar";
import { BlockHandle } from "./toolbar/block-handle";
import { TableHandles } from "./toolbar/table-handles";

export function GuideEditor({
  guideId,
  userId,
  initialTitle,
  initialContent,
  initialSummary,
  initialTags,
  initialIsPublished,
  initialCoverImageUrl,
  initialHasDraft,
  publishedSnapshot,
  authorSlug,
  guideSlug,
}: GuideEditorProps) {
  // ── 本文・メタ状態 ──────────────────────────
  // 本文(content)は editor を真実源とし React state に持たない（毎キー再レンダリング回避）。
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initialCoverImageUrl);
  // 未保存変更フラグ。同値 setState は React がバイパスするため毎キー再レンダリングしない。
  const [dirty, setDirty] = useState(false);
  // DB にコミット済みドラフトが存在するか（仮保存で true、保存/破棄で false）。
  const [draftActive, setDraftActive] = useState(initialHasDraft);

  // ── ダイアログ状態 ──────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [embedKind, setEmbedKind] = useState<EmbedKind | null>(null);
  const [guideLinkOpen, setGuideLinkOpen] = useState(false);

  const isTouch = useMediaQuery("(hover: none)");

  // ── アップロード ──────────────────────────
  const imageUpload = useImageUpload();
  const coverUpload = useImageUpload();
  // paste ハンドラから最新の画像アップロードを呼ぶための ref（editor 生成前に渡す）
  const imageUploadRef = useRef<(file: File) => void>(() => {});

  const editor = useGuideEditor({
    initialContent,
    onUpdate: () => setDirty(true),
    onImagePaste: (file) => imageUploadRef.current(file),
  });

  const imageInputRef = useRef<HTMLInputElement>(null);

  // ── 手動保存（自動セーブ廃止） ──────────────
  const { submit, saving, lastSaved } = useGuideSave();

  // メタ情報はラベル付きハンドラ側でダーティを立てる（ロールバック時の一括リセットと
  // 衝突しないよう、effect ではなく明示的にマークする）。本文は editor.onUpdate が立てる。
  const markDirty = useCallback(() => setDirty(true), []);

  const save = useCallback(
    (mode: "draft" | "publish") => {
      if (!editor) return;
      submit(mode, {
        title,
        content: editor.getHTML(),
        summary,
        tags,
        isPublished,
        coverImageUrl,
      });
      setDirty(false);
      setDraftActive(mode === "draft");
    },
    [editor, submit, title, summary, tags, isPublished, coverImageUrl],
  );

  // ドラフトを破棄して公開版へロールバック（エディタ・メタを公開版へ戻し、ドラフト列を null に）
  const handleRollback = useCallback(() => {
    if (!editor) return;
    // setContent は onUpdate→setDirty(true) を発火するが、同一ハンドラ内の
    // 後続 setDirty(false) が最終値になる（React のバッチ処理）。
    editor.commands.setContent(publishedSnapshot.content);
    setTitle(publishedSnapshot.title);
    setSummary(publishedSnapshot.summary);
    setTags(publishedSnapshot.tags);
    setCoverImageUrl(publishedSnapshot.coverImageUrl);
    setIsPublished(publishedSnapshot.isPublished);
    submit("discard", {
      title: publishedSnapshot.title,
      content: publishedSnapshot.content,
      summary: publishedSnapshot.summary,
      tags: publishedSnapshot.tags,
      isPublished: publishedSnapshot.isPublished,
      coverImageUrl: publishedSnapshot.coverImageUrl,
    });
    setDirty(false);
    setDraftActive(false);
  }, [editor, publishedSnapshot, submit]);

  // 未保存離脱警告
  const blocker = useUnsavedWarning(dirty);

  // ── ハンドラ ──────────────────────────────
  const handleLinkInsert = useCallback(() => {
    if (!editor) return;
    const href = window.prompt("URLを入力してください", "https://");
    if (!href) return;
    if (editor.state.selection.empty) {
      const text = window.prompt("リンクテキストを入力してください", href) || href;
      editor.chain().focus().insertContent(`<a href="${href}">${text}</a>`).run();
    } else {
      editor.chain().focus().setLink({ href }).run();
    }
  }, [editor]);

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (!editor) return;
      const url = await imageUpload.uploadTo(
        buildInlineImagePath(userId, guideId),
        file,
        { ...INLINE_IMAGE_PREPARE, errorMessage: "画像のアップロードに失敗しました" },
      );
      if (url) {
        editor
          .chain()
          .focus()
          .setImage({ src: url, alt: file.name.replace(/\.[^.]+$/, "") })
          .run();
      }
    },
    [editor, userId, guideId, imageUpload],
  );
  imageUploadRef.current = handleImageUpload;

  // ── スラッシュコマンドのコンテキスト注入 ──────
  const slashContext: SlashCommandContext = useMemo(
    () => ({
      openImagePicker: () => imageInputRef.current?.click(),
      insertYoutube: () => {
        if (!editor) return;
        const url = window.prompt(
          "YouTube URLを入力してください",
          "https://www.youtube.com/watch?v=",
        );
        if (url) editor.commands.setYoutubeVideo({ src: url });
      },
      insertLink: handleLinkInsert,
      openEmbedDialog: (kind) => setEmbedKind(kind),
      openGuideLinkSearch: () => setGuideLinkOpen(true),
    }),
    [editor, handleLinkInsert],
  );

  useEffect(() => {
    if (!editor) return;
    const storage = (editor.storage as unknown as Record<string, unknown>).slashCommand as
      | SlashCommandStorage
      | undefined;
    if (storage) storage.ctx = slashContext;
  }, [editor, slashContext]);

  const handleInsertEmbed = (kind: EmbedKind, slug: string, preset: string) => {
    if (editor) insertEmbed(editor, kind, slug, preset || null);
  };

  const handleInsertGuideLink = (guide: GuideSearchResult) => {
    if (editor) insertGuideLink(editor, guide);
  };

  // プレビューはドラフト（仮保存）内容を表示（著者本人のみ。未保存ドラフトが無ければ公開版）
  const previewUrl = `/guides/${authorSlug}/${guideSlug}?draft=1`;

  return (
    <div className="flex flex-col">
      {editor && (
        <DesktopToolbar
          editor={editor}
          isDirty={dirty}
          saving={saving}
          lastSaved={lastSaved}
          onSaveDraft={() => save("draft")}
          onSavePublish={() => save("publish")}
          onOpenSettings={() => setSettingsOpen(true)}
          previewUrl={previewUrl}
          onImagePicker={() => imageInputRef.current?.click()}
          onYoutube={slashContext.insertYoutube}
          onLink={handleLinkInsert}
          onEmbed={(kind) => setEmbedKind(kind)}
          onGuideLink={() => setGuideLinkOpen(true)}
        />
      )}

      {/* コンテンツ幅は公開ビュー（guides/view.tsx の article）と一致させ WYSIWYG にする */}
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2 mt-4">
          <Link
            to="/my-guides"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("guideEditor.back")}
          </Link>
          {/* タイトルは設定モーダルで編集。本文上には現在のタイトルを見出しとして表示 */}
        </div>

        {/* 未公開ドラフト編集中の通知 + 公開版へのロールバック */}
        {draftActive && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
            <span>未公開のドラフトを編集中です。「保存」で公開版へ反映、または公開版に戻せます。</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={handleRollback}
              disabled={saving}
            >
              <Undo2 className="h-3.5 w-3.5" />
              公開版に戻す
            </Button>
          </div>
        )}

        <div className="py-3 min-h-100">
          <div className="guide-content prose prose-neutral dark:prose-invert max-w-none">
            {editor && !isTouch && (
              <EditorBubbleMenu editor={editor} onLink={handleLinkInsert} enabled={!isTouch} />
            )}
            {/* デスクトップ: テーブル上はブロックハンドルの代わりに行・列ハンドルを出す */}
            {editor && <BlockHandle editor={editor} touch={isTouch} suppressInTable={!isTouch} />}
            {editor && !isTouch && <TableHandles editor={editor} />}
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {editor && isTouch && <MobileToolbar editor={editor} onLink={handleLinkInsert} />}

      {/* 画像ファイル選択（slash / paste から起動） */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageUpload(file);
          e.target.value = "";
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialValues={{ title, summary, tags, coverImageUrl, isPublished }}
        uploadCover={(file) =>
          coverUpload.uploadTo(
            buildCoverImagePath(userId, guideId),
            file,
            { ...COVER_IMAGE_PREPARE, errorMessage: "カバー画像のアップロードに失敗しました" },
          )
        }
        isUploadingCover={coverUpload.isUploading}
        uploadError={coverUpload.error ?? imageUpload.error}
        onApply={(v) => {
          // モーダル内 State を全体 State へ反映（保存はしない → ダーティに）
          setTitle(v.title);
          setSummary(v.summary);
          setTags(v.tags);
          setCoverImageUrl(v.coverImageUrl);
          setIsPublished(v.isPublished);
          markDirty();
        }}
      />

      <EmbedDialog
        kind={embedKind}
        onOpenChange={(open) => !open && setEmbedKind(null)}
        onInsert={handleInsertEmbed}
      />
      <GuideLinkSearch
        open={guideLinkOpen}
        onOpenChange={setGuideLinkOpen}
        onInsert={handleInsertGuideLink}
      />

      {/* 未保存離脱の確認 */}
      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("guideEditor.unsavedLeaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("guideEditor.unsavedLeaveDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              {t("guideEditor.stay")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>
              {t("guideEditor.leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
