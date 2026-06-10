// ガイドエディタのエントリ。メタ欄 + ツールバー + Tiptap 本文を組み立てる薄い宿主。
// 旧 2993 行の単一実装を責務分割し、extensions/ node-views/ slash-command/ panels/
// toolbar/ hooks/ へ移譲した結果のコンポジション層。
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import { EditorContent } from "@tiptap/react";
import { ArrowLeft } from "lucide-react";
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
import { useAutoSave } from "./hooks/use-auto-save";
import {
  useImageUpload,
  buildInlineImagePath,
  buildCoverImagePath,
} from "./hooks/use-image-upload";
import { useUnsavedWarning } from "./hooks/use-unsaved-warning";
import { insertEmbed, insertGuideLink } from "./lib/block-commands";
import { MetadataFields } from "./panels/metadata-fields";
import { EmbedDialog, type EmbedKind } from "./panels/embed-dialog";
import { GuideLinkSearch, type GuideSearchResult } from "./panels/guide-link-search";
import { DesktopToolbar } from "./toolbar/desktop-toolbar";
import { EditorBubbleMenu } from "./toolbar/bubble-menu";
import { MobileToolbar } from "./toolbar/mobile-toolbar";
import { BlockHandle } from "./toolbar/block-handle";

export function GuideEditor({
  guideId,
  userId,
  initialTitle,
  initialContent,
  initialSummary,
  initialTags,
  initialIsPublished,
  initialCoverImageUrl,
  authorSlug,
  guideSlug,
}: GuideEditorProps) {
  // ── 本文・メタ状態 ──────────────────────────
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [summary, setSummary] = useState(initialSummary);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initialCoverImageUrl);

  // ── ダイアログ状態 ──────────────────────────
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
    onUpdate: setContent,
    onImagePaste: (file) => imageUploadRef.current(file),
  });

  const imageInputRef = useRef<HTMLInputElement>(null);

  // ── オートセーブ ──────────────────────────
  const { status, lastSavedAt, saveNow } = useAutoSave({
    title,
    content,
    summary,
    tags,
    isPublished,
    coverImageUrl,
  });

  // 公開トグルは即時保存
  const publishInit = useRef(true);
  useEffect(() => {
    if (publishInit.current) {
      publishInit.current = false;
      return;
    }
    saveNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublished]);

  // 未保存離脱警告
  const blocker = useUnsavedWarning(status !== "saved");

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
        buildInlineImagePath(userId, guideId, file),
        file,
        "画像のアップロードに失敗しました",
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

  const handleCoverUpload = useCallback(
    async (file: File) => {
      const url = await coverUpload.uploadTo(
        buildCoverImagePath(userId, guideId, file),
        file,
        "サムネイルのアップロードに失敗しました",
      );
      if (url) setCoverImageUrl(url);
    },
    [userId, guideId, coverUpload],
  );

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

  const previewUrl = `/guides/${authorSlug}/${guideSlug}`;

  return (
    <div className="flex flex-col">
      {editor && (
        <DesktopToolbar
          editor={editor}
          saveStatus={status}
          lastSavedAt={lastSavedAt}
          onSave={saveNow}
          isPublished={isPublished}
          onTogglePublish={setIsPublished}
          previewUrl={previewUrl}
        />
      )}

      <div className="mx-auto w-full max-w-3xl px-4">
        <Link
          to="/my-guides"
          className="inline-flex items-center gap-1.5 mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("guideEditor.back")}
        </Link>

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
          isUploadingCover={coverUpload.isUploading}
          uploadError={coverUpload.error ?? imageUpload.error}
        />

        <div className="py-3 min-h-100">
          <div className="guide-content prose prose-neutral dark:prose-invert max-w-none">
            {editor && !isTouch && (
              <EditorBubbleMenu editor={editor} onLink={handleLinkInsert} enabled={!isTouch} />
            )}
            {editor && <BlockHandle editor={editor} touch={isTouch} />}
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
