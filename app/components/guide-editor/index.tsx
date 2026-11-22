// ガイドエディタのエントリ。メタ欄 + ツールバー + Tiptap 本文を組み立てる薄い宿主。
// 旧 2993 行の単一実装を責務分割し、extensions/ node-views/ slash-command/ panels/
// toolbar/ hooks/ へ移譲した結果のコンポジション層。
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent } from "@tiptap/react";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useT } from "@/hooks/use-locale";
import type { GuideEditorProps, SlashCommandContext, GuideMediaContext } from "./types";
import type { SlashCommandStorage } from "./extensions/slash-command";
import { setImageMediaContext } from "./extensions/image";
import { setEmbedEditContext } from "./lib/embed-edit-context";
import { cropImageFromUrl, isAnimatedImageUrl, ImageLoadError } from "./lib/image-processing";
import { cropAnimatedGifFromUrl } from "./lib/gif-crop";
import { GifTooLargeError } from "./lib/gif-encode";
import type { CropRect } from "./lib/image-crop";
import { useGuideEditor } from "./hooks/use-guide-editor";
import {
  useGuideSave,
  getPublishAction,
  getShortcutSaveMode,
  hasDraftSave,
  isSettingsChanged,
  PUBLISH_ACTION_MESSAGES,
} from "./hooks/use-guide-save";
import {
  useImageUpload,
  buildInlineImagePath,
  buildCoverImagePath,
  COVER_IMAGE_PREPARE,
  INLINE_IMAGE_PREPARE,
  MAX_UPLOAD_BYTES,
} from "./hooks/use-image-upload";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { insertEmbed, insertGuideLink, insertTemplateEmbed } from "./lib/block-commands";
import { SettingsDialog, type GuideSettingsValues } from "./panels/settings-dialog";
import { PublishDialog } from "./panels/publish-dialog";
import { EmbedDialog, type EmbedKind } from "./panels/embed-dialog";
import { TemplateEmbedDialog } from "./panels/template-embed-dialog";
import { primeTemplateEmbedMeta, type TemplateEmbedMeta } from "./lib/template-embed-meta";
import { YoutubeDialog } from "./panels/youtube-dialog";
import { LinkDialog } from "./panels/link-dialog";
import { VideoToGifDialog } from "./panels/video-to-gif-dialog";
import { GuideLinkSearch, type GuideSearchResult } from "./panels/guide-link-search";
import { DialogReturnFocusEditorContext } from "./lib/dialog-return-focus";
import { LeadingTitleHeadingNote } from "./panels/leading-title-heading-note";
import { DesktopToolbar } from "./toolbar/desktop-toolbar";
import { EditorBubbleMenu } from "./toolbar/bubble-menu";
import { TableCellBubbleMenu } from "./toolbar/table-cell-bubble-menu";
import { MobileToolbar } from "./toolbar/mobile-toolbar";
import { BlockHandle } from "./toolbar/block-handle";
import { TableHandles } from "./toolbar/table-handles";
import { NoticeBanner } from "@/components/notice-banner";

export function GuideEditor({
  guideId,
  userId,
  initialTitle,
  initialContent,
  initialSummary,
  initialTags,
  initialIsPublished,
  initialAllowAutoTranslation,
  translationEnabled,
  initialCoverImageUrl,
  initialHasDraft,
  publishedSnapshot,
  authorSlug,
  guideSlug,
}: GuideEditorProps) {
  const t = useT();
  // ── 本文・メタ状態 ──────────────────────────
  // 本文(content)は editor を真実源とし React state に持たない（毎キー再レンダリング回避）。
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  // 自動翻訳の許可はライブ列（スラッグと同様、ドラフト対象外・ロールバックの対象外）
  const [allowAutoTranslation, setAllowAutoTranslation] = useState(initialAllowAutoTranslation);
  // 機能無効時は保存で allowAutoTranslation を送らない（サーバーは保存済みの値のまま残す）
  const allowAutoTranslationToSend = translationEnabled ? allowAutoTranslation : undefined;
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initialCoverImageUrl);
  // 編集中のURLスラッグ（初期値は現在のコミット済みスラッグ）。
  const [slug, setSlug] = useState(guideSlug);
  // 未保存変更フラグ。本文とメタ（設定モーダルの値）を分けて持つ。同値 setState は React がバイパスするため
  // 毎キー再レンダリングしない。本文は保存済みの doc と比べて判定する（「元に戻す」で保存時の状態へ戻れば
  // 未保存でなくなる。HTML を毎キー作らず、構造の比較 doc.eq だけで済ませる）
  const [contentDirty, setContentDirty] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);
  const dirty = contentDirty || metaDirty;
  const savedDocRef = useRef<ProseMirrorNode | null>(null);
  // DB にコミット済みドラフトが存在するか（下書き保存で true、保存/破棄で false）。
  const [draftActive, setDraftActive] = useState(initialHasDraft);

  // ── ダイアログ状態 ──────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 設定ダイアログを「公開する」スイッチへフォーカスして開くか（ツールバーの「公開…」から開いたときだけ）
  const [publishOpen, setPublishOpen] = useState(false);
  const [embedKind, setEmbedKind] = useState<EmbedKind | null>(null);
  const [templateEmbedOpen, setTemplateEmbedOpen] = useState(false);
  // 埋め込み NodeView の「変更」から開いたときの初期値と書き戻し先（null なら挿入として開く）
  const [embedEdit, setEmbedEdit] = useState<{
    initial: { userSlug: string; presetName: string | null };
    apply: (userSlug: string, presetName: string | null) => void;
  } | null>(null);
  const [templateEmbedApply, setTemplateEmbedApply] = useState<((templateId: string) => void) | null>(null);
  const openEmbedInsert = useCallback((kind: EmbedKind) => {
    setEmbedEdit(null);
    setEmbedKind(kind);
  }, []);
  const openTemplateEmbedInsert = useCallback(() => {
    setTemplateEmbedApply(null);
    setTemplateEmbedOpen(true);
  }, []);
  const [guideLinkOpen, setGuideLinkOpen] = useState(false);
  const [videoToGifOpen, setVideoToGifOpen] = useState(false);
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  // リンクダイアログを開いた時点の選択範囲が空か（空ならダイアログにテキスト欄を出す）
  const [linkSelectionEmpty, setLinkSelectionEmpty] = useState(true);

  const isTouch = useMediaQuery("(hover: none)");

  // ── アップロード ──────────────────────────
  const imageUpload = useImageUpload();
  const coverUpload = useImageUpload();
  // paste ハンドラから最新の画像アップロードを呼ぶための ref（editor 生成前に渡す）
  const imageUploadRef = useRef<(file: File) => void>(() => {});

  const editor = useGuideEditor({
    initialContent,
    onUpdate: (ed) => setContentDirty(savedDocRef.current ? !ed.state.doc.eq(savedDocRef.current) : true),
    onImagePaste: (file) => imageUploadRef.current(file),
  });

  const imageInputRef = useRef<HTMLInputElement>(null);

  // 保存済み（初期・保存直後・ロールバック直後）の本文を基準として覚える。初回は編集の前に一度だけ取る
  useEffect(() => {
    if (editor && !savedDocRef.current) savedDocRef.current = editor.state.doc;
  }, [editor]);

  // ── 手動保存（自動セーブ廃止） ──────────────
  const { submit, saving, lastSaved, data: saveResult } = useGuideSave();
  const navigate = useNavigate();
  const prevResultRef = useRef<typeof saveResult>(undefined);

  // メタ情報はラベル付きハンドラ側でダーティを立てる（ロールバック時の一括リセットと
  // 衝突しないよう、effect ではなく明示的にマークする）。本文は editor.onUpdate が立てる。
  const markDirty = useCallback(() => setMetaDirty(true), []);

  // override: 設定モーダルの「公開する」が、適用した値でそのまま保存するときに渡す（state の更新を待たない）
  const save = useCallback(
    (mode: "draft" | "publish", override?: GuideSettingsValues) => {
      if (!editor) return;
      submit(mode, {
        title: override?.title ?? title,
        content: editor.getHTML(),
        summary: override?.summary ?? summary,
        tags: override?.tags ?? tags,
        isPublished: override?.isPublished ?? isPublished,
        coverImageUrl: override ? override.coverImageUrl : coverImageUrl,
        slug: override?.slug ?? slug,
        allowAutoTranslation: translationEnabled
          ? (override?.allowAutoTranslation ?? allowAutoTranslation)
          : undefined,
      });
      savedDocRef.current = editor.state.doc;
      setContentDirty(false);
      setMetaDirty(false);
      setDraftActive(mode === "draft");
    },
    [editor, submit, title, summary, tags, isPublished, coverImageUrl, slug, allowAutoTranslation, translationEnabled],
  );

  // 公開の確認の「公開する」で保存中か。保存が成功するまで確認は閉じず、失敗したら開いたままエラーを出す
  const [settingsPublishing, setSettingsPublishing] = useState(false);

  // 設定モーダルの値を全体 State へ反映する（保存はしない）
  const applySettings = (v: GuideSettingsValues) => {
    // モーダル内 State を全体 State へ反映（保存はしない）。値が実際に変わったときだけダーティにする
    // （開いて「適用」しただけで未保存扱いにしない）
    const changed = isSettingsChanged(
      { title, summary, tags, coverImageUrl, isPublished, slug, allowAutoTranslation },
      v,
    );
    setTitle(v.title);
    setSummary(v.summary);
    setTags(v.tags);
    setCoverImageUrl(v.coverImageUrl);
    setIsPublished(v.isPublished);
    setSlug(v.slug);
    setAllowAutoTranslation(v.allowAutoTranslation);
    if (changed) markDirty();
  };

  // 保存結果の監視: エラーはトースト、スラッグ変更時は新しい編集URLへ差し替える。
  // 同一ルートなのでエディタは再マウントされず、本文・メタ状態は保持される。
  useEffect(() => {
    if (!saveResult || saveResult === prevResultRef.current) return;
    prevResultRef.current = saveResult;
    if (saveResult.error) {
      toast.error(saveResult.error);
      setSettingsPublishing(false);
      // save() は送信の時点で未保存を解消しているので、失敗したら未保存に戻す（保存ボタンは変更が無いと
      // 押せない状態になるため、戻さないと編集し直すまで保存し直せない。離脱確認も効かせ直す）
      setMetaDirty(true);
      return;
    }
    if (settingsPublishing) {
      setSettingsPublishing(false);
      setPublishOpen(false);
    }
    if (saveResult.slug && saveResult.slug !== guideSlug) {
      navigate(`/my-guides/${saveResult.slug}/edit`, { replace: true });
    }
  }, [saveResult, guideSlug, navigate, settingsPublishing]);

  // ドラフトを破棄して公開版へロールバック（エディタ・メタを公開版へ戻し、ドラフト列を null に）
  const handleRollback = useCallback(() => {
    if (!editor) return;
    // setContent は onUpdate→setContentDirty を発火するが、同一ハンドラ内の
    // 後続 setContentDirty(false) が最終値になる（React のバッチ処理）。
    // setContent はエディタの parseOptions を継承しないため、useGuideEditor と同じ
    // preserveWhitespace を明示（インライン code 内スペースの消失防止）
    editor.commands.setContent(publishedSnapshot.content, {
      parseOptions: { preserveWhitespace: "full" },
    });
    setTitle(publishedSnapshot.title);
    setSummary(publishedSnapshot.summary);
    setTags(publishedSnapshot.tags);
    setCoverImageUrl(publishedSnapshot.coverImageUrl);
    setIsPublished(publishedSnapshot.isPublished);
    // スラッグはドラフト対象外（ライブ列）。編集中の未保存スラッグはコミット済み値へ戻す。
    setSlug(guideSlug);
    submit("discard", {
      title: publishedSnapshot.title,
      content: publishedSnapshot.content,
      summary: publishedSnapshot.summary,
      tags: publishedSnapshot.tags,
      isPublished: publishedSnapshot.isPublished,
      coverImageUrl: publishedSnapshot.coverImageUrl,
      slug: guideSlug,
      allowAutoTranslation: allowAutoTranslationToSend,
    });
    savedDocRef.current = editor.state.doc;
    setContentDirty(false);
    setMetaDirty(false);
    setDraftActive(false);
  }, [editor, publishedSnapshot, submit, guideSlug, allowAutoTranslationToSend]);

  // 未保存離脱警告
  const blocker = useUnsavedWarning(dirty);

  // 公開状態。保存済みの値は loader の公開版スナップショット（保存のたびに再検証で更新される）を正とする。
  // 下書き保存は isPublished を変えないので、保存ボタンの文言とピルはこの値と設定の組で決める
  const livePublished = publishedSnapshot.isPublished;
  const publishAction = getPublishAction(livePublished, isPublished);
  // 下書き保存は「公開版を変えずに保存する」ためのもの。読者に見える版が無い（一度も公開していない・
  // 公開を取り下げた）ガイドでは意味が無いので、保存ボタンは1つ（publish モード）だけにする（hasDraftSave）
  const draftSaveAvailable = hasDraftSave(livePublished);

  // Ctrl/⌘+S で保存（ブラウザの「ページを保存」は止める）。Ctrl+Shift+S は打ち消し線なので除く。
  // 公開中のガイドは下書き保存、公開版が無いガイドは唯一の保存ボタンと同じ保存（getShortcutSaveMode）。
  // 保存しないとき: 保存中・未保存の変更が無いとき（押すたびに中身の同じ保存をしない）・設定モーダルが
  // 開いているとき（モーダルは「適用」前の値を持つため、保存すると表示と食い違う）
  // ただし、読者に初めて公開することになる保存（publishAction === "publish"）はショートカットでは行わない。
  // 習慣で押した Ctrl+S で公開されないよう、ボタンから明示的に公開させる
  const shortcutStateRef = useRef({ save, saving, dirty, settingsOpen, livePublished, publishAction, t });
  shortcutStateRef.current = { save, saving, dirty, settingsOpen, livePublished, publishAction, t };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "s" || e.isComposing) return;
      e.preventDefault();
      const state = shortcutStateRef.current;
      if (e.repeat || state.saving || !state.dirty || state.settingsOpen) return;
      const mode = getShortcutSaveMode(state.livePublished);
      if (mode === "publish" && state.publishAction === "publish") {
        toast.info(state.t("guideEditor.toolbar.shortcutWontPublish"));
        return;
      }
      state.save(mode);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── ハンドラ ──────────────────────────────
  // リンク挿入はダイアログ（panels/link-dialog.tsx）で URL / テキストを受け取る。
  // 開いた時点の選択範囲の有無をここで確定し、確定処理（handleInsertLink）に引き渡す。
  const handleLinkInsert = useCallback(() => {
    if (!editor) return;
    setLinkSelectionEmpty(editor.state.selection.empty);
    setLinkDialogOpen(true);
  }, [editor]);

  const handleInsertLink = useCallback(
    (href: string, text: string) => {
      if (!editor) return;
      if (linkSelectionEmpty) {
        // 生 HTML 文字列の組み立てではなく JSON 形式で渡すことで、テキストに
        // `<` や `"` が含まれてもエスケープ不要で安全に挿入できる。
        editor
          .chain()
          .focus()
          .insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] })
          .run();
      } else {
        editor.chain().focus().setLink({ href }).run();
      }
    },
    [editor, linkSelectionEmpty],
  );

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (!editor) return;
      const url = await imageUpload.uploadTo(
        buildInlineImagePath(userId, guideId),
        file,
        { ...INLINE_IMAGE_PREPARE, errorMessage: t("guideEditor.ui.imageUploadFailed") },
      );
      if (url) {
        editor
          .chain()
          .focus()
          .setImage({ src: url, alt: "" })
          .run();
      }
    },
    [editor, userId, guideId, imageUpload],
  );
  imageUploadRef.current = handleImageUpload;

  // 画像 NodeView からのトリミング要求。取得 → 切り出し → 新しい Blob として再アップロードし、
  // 新 URL を返す（元の Blob はそのまま残る＝ 他ガイドからの参照や取り消し操作を壊さない）。
  const handleCropImage = useCallback(
    async (src: string, rect: CropRect): Promise<string | null> => {
      let cropped: File;
      try {
        // GIF は canvas を通すと 1 フレーム目の静止画になるため、
        // 全フレームをデコードして切り出し、アニメーションを保ったまま書き戻す。
        // 出力は image/gif で、アップロード経路（prepareImageForUpload）は GIF を素通しする
        cropped = isAnimatedImageUrl(src)
          ? await cropAnimatedGifFromUrl(src, rect, "cropped.gif", {
              maxBytes: MAX_UPLOAD_BYTES,
            })
          : await cropImageFromUrl(src, rect, "cropped.png");
      } catch (e) {
        if (e instanceof ImageLoadError) toast.error(t("guideEditor.cropLoadError"));
        else if (e instanceof GifTooLargeError) {
          toast.error(
            t("guideEditor.cropGifTooLarge", {
              size: (e.actualBytes / 1024 / 1024).toFixed(1),
              max: (MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(1),
            }),
          );
        } else toast.error(t("guideEditor.cropFailed"));
        return null;
      }
      const url = await imageUpload.uploadTo(buildInlineImagePath(userId, guideId), cropped, {
        ...INLINE_IMAGE_PREPARE,
        errorMessage: t("guideEditor.cropFailed"),
      });
      if (!url) toast.error(t("guideEditor.cropFailed"));
      return url;
    },
    [userId, guideId, imageUpload],
  );

  // ── スラッシュコマンドのコンテキスト注入 ──────
  const slashContext: SlashCommandContext = useMemo(
    () => ({
      openImagePicker: () => imageInputRef.current?.click(),
      insertYoutube: () => setYoutubeDialogOpen(true),
      insertLink: handleLinkInsert,
      openEmbedDialog: openEmbedInsert,
      openTemplateEmbedDialog: openTemplateEmbedInsert,
      openGuideLinkSearch: () => setGuideLinkOpen(true),
      openVideoToGif: () => setVideoToGifOpen(true),
    }),
    [editor, handleLinkInsert, openEmbedInsert, openTemplateEmbedInsert],
  );

  useEffect(() => {
    if (!editor) return;
    const storage = (editor.storage as unknown as Record<string, unknown>).slashCommand as
      | SlashCommandStorage
      | undefined;
    if (storage) {
      storage.ctx = slashContext;
      storage.t = t;
    }
  }, [editor, slashContext, t]);

  // ── 画像 NodeView のコンテキスト注入 ──────────
  const mediaContext: GuideMediaContext = useMemo(
    () => ({ cropImage: handleCropImage }),
    [handleCropImage],
  );

  useEffect(() => {
    if (editor) setImageMediaContext(editor, mediaContext);
  }, [editor, mediaContext]);

  // ── 埋め込み NodeView の「変更」の注入 ──────────
  useEffect(() => {
    if (!editor) return;
    setEmbedEditContext(editor, {
      editEmbed: (kind, initial, apply) => {
        setEmbedEdit({ initial, apply });
        setEmbedKind(kind);
      },
      editTemplateEmbed: (apply) => {
        // 関数を state に入れるため、更新関数として解釈されないよう包む
        setTemplateEmbedApply(() => apply);
        setTemplateEmbedOpen(true);
      },
    });
  }, [editor]);

  const handleInsertEmbed = (kind: EmbedKind, slug: string, preset: string) => {
    // 「変更」から開いたときは、そのノードの属性を書き換える（挿入はしない）
    if (embedEdit) {
      embedEdit.apply(slug, preset || null);
      return;
    }
    if (editor) insertEmbed(editor, kind, slug, preset || null);
  };

  const handleInsertTemplateEmbed = (template: TemplateEmbedMeta) => {
    // 編集中表示がタイトルを再取得しなくて済むよう、選択結果を先にキャッシュへ入れる
    primeTemplateEmbedMeta(template);
    if (templateEmbedApply) {
      templateEmbedApply(template.id);
      return;
    }
    if (editor) insertTemplateEmbed(editor, template.id);
  };

  const handleInsertGuideLink = (guide: GuideSearchResult) => {
    if (editor) insertGuideLink(editor, guide);
  };

  const handleInsertYoutube = (url: string) => {
    if (editor) editor.commands.setYoutubeVideo({ src: url });
  };

  // プレビューは下書き保存した内容を表示（著者本人のみ。下書きが無ければ公開版）。未保存の変更は含まれない
  const previewUrl = `/guides/${authorSlug}/${guideSlug}?draft=1`;

  return (
    // エディタのダイアログ（トリガーなしで開く）が、閉じたあと body に落ちたフォーカスをエディタへ戻せるように配る
    <DialogReturnFocusEditorContext.Provider value={editor}>
      <div className="flex flex-col">
        {editor && (
          <DesktopToolbar
            editor={editor}
            isDirty={dirty}
            saving={saving}
            lastSaved={lastSaved}
            livePublished={livePublished}
            publishSetting={isPublished}
            draftSaveAvailable={draftSaveAvailable}
            hasSavedDraft={draftActive}
            onSaveDraft={() => save("draft")}
            onSavePublish={() => save("publish")}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenPublishSettings={() => setPublishOpen(true)}
            previewUrl={previewUrl}
            onImagePicker={() => imageInputRef.current?.click()}
            onYoutube={slashContext.insertYoutube}
            onVideoToGif={() => setVideoToGifOpen(true)}
            onLink={handleLinkInsert}
            onEmbed={openEmbedInsert}
            onTemplateEmbed={openTemplateEmbedInsert}
            onGuideLink={() => setGuideLinkOpen(true)}
          />
        )}

        {/* コンテンツ幅は公開ビュー（guides/view.tsx の article）と一致させ WYSIWYG にする */}
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-2 mt-4">
            <Button variant="ghost" size="sm" asChild className="-ml-2">
              <Link to="/my-guides">
                <ArrowLeft className="h-4 w-4 mr-1" />
                {/* 戻り先（/my-guides）の見出しの名前で呼ぶ（新規作成ページの戻るリンクと同じ文言） */}
                {t("meGuides.backToManagement")}
              </Link>
            </Button>
          </div>

          {/* 未公開ドラフト編集中の通知 + 公開版へのロールバック */}
          {draftActive && (
            <NoticeBanner tone="warning" className="mt-3 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
              <span>
                {draftSaveAvailable
                  ? t("guideEditor.ui.draftBanner", { action: t(PUBLISH_ACTION_MESSAGES[publishAction].label) })
                  : // 公開版が無いのに下書きが残っている（下書き保存が非公開のガイドにも出ていた頃に作ったもの）
                    t("guideEditor.ui.draftBannerUnpublished", { action: t(PUBLISH_ACTION_MESSAGES[publishAction].label) })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handleRollback}
                disabled={saving}
              >
                <Undo2 className="h-3.5 w-3.5" />
                {draftSaveAvailable ? t("guideEditor.ui.revertToPublished") : t("guideEditor.ui.revertToSaved")}
              </Button>
              </div>
            </NoticeBanner>
          )}

          {/* タイトルと概要（読み取り専用の表示。編集は設定モーダル。押すとモーダルが開く）。
              「適用」した未保存の値もここに出る。見た目は公開ビュー（guides/view.tsx）のタイトル・概要に合わせる。
              押せる範囲は概要まで広げる（タイトルのボタンの after で全面を覆う。ui.md 9 章「オーバーレイリンク」） */}
          <div className="group relative mt-4 -mx-3 rounded-xl px-3 py-2 transition-colors hover:bg-muted/50 focus-within:bg-muted/50">
            <h1 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight">
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="w-full pr-6 text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
              >
                {title.trim() ? title : <span className="text-muted-foreground">{t("guideEditor.ui.titleEmpty")}</span>}
                <span className="sr-only"> {t("guideEditor.ui.editInSettings")}</span>
              </button>
            </h1>
            {summary.trim() && (
              <p className="mt-3 text-lg text-muted-foreground leading-relaxed">{summary}</p>
            )}
            <Pencil
              aria-hidden
              className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            />
          </div>

          {/* 本文の先頭の見出しがタイトル（「適用」した未保存の値）と同じ間だけ、公開ページでは出さないことを知らせる */}
          {editor && <LeadingTitleHeadingNote editor={editor} title={title} />}

          <div className="py-3 min-h-100">
            <div className="guide-content prose max-w-none">
              {editor && !isTouch && (
                <EditorBubbleMenu editor={editor} onLink={handleLinkInsert} enabled={!isTouch} />
              )}
              {/* セル跨ぎ選択（CellSelection）にはテーブル編集用のバブルを出す */}
              {editor && !isTouch && <TableCellBubbleMenu editor={editor} enabled={!isTouch} />}
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
          initialValues={{ title, summary, tags, coverImageUrl, isPublished, slug, allowAutoTranslation }}
          authorSlug={authorSlug}
          translationEnabled={translationEnabled}
          livePublished={livePublished}
          uploadCover={(file) =>
            coverUpload.uploadTo(
              buildCoverImagePath(userId, guideId),
              file,
              { ...COVER_IMAGE_PREPARE, errorMessage: t("guideEditor.ui.coverUploadFailed") },
            )
          }
          isUploadingCover={coverUpload.isUploading}
          uploadError={coverUpload.error ?? imageUpload.error}
          onApply={applySettings}
        />

        <PublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          title={title}
          slug={slug}
          authorSlug={authorSlug}
          coverImageUrl={coverImageUrl}
          saving={saving}
          onPublish={() => {
            // 公開版の無いガイドを公開として保存する。保存の結果が返るまで確認は閉じない（保存結果の effect）
            const v: GuideSettingsValues = { title, summary, tags, coverImageUrl, isPublished: true, slug, allowAutoTranslation };
            applySettings(v);
            setSettingsPublishing(true);
            save("publish", v);
          }}
          onEditSettings={() => {
            setPublishOpen(false);
            setSettingsOpen(true);
          }}
        />

        <EmbedDialog
          kind={embedKind}
          onOpenChange={(open) => !open && setEmbedKind(null)}
          onInsert={handleInsertEmbed}
          defaultUserSlug={authorSlug}
          initial={embedEdit?.initial ?? null}
        />
        <TemplateEmbedDialog
          open={templateEmbedOpen}
          onOpenChange={setTemplateEmbedOpen}
          onInsert={handleInsertTemplateEmbed}
          editing={templateEmbedApply !== null}
        />
        <GuideLinkSearch
          open={guideLinkOpen}
          onOpenChange={setGuideLinkOpen}
          onInsert={handleInsertGuideLink}
        />
        <YoutubeDialog
          open={youtubeDialogOpen}
          onOpenChange={setYoutubeDialogOpen}
          onInsert={handleInsertYoutube}
        />
        <LinkDialog
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          selectionEmpty={linkSelectionEmpty}
          onInsert={handleInsertLink}
        />
        <VideoToGifDialog
          open={videoToGifOpen}
          onOpenChange={setVideoToGifOpen}
          onInsert={(gif) => {
            // 先に閉じてから挿入する（開いたままだと Dialog のフォーカストラップが
            // editor.chain().focus() と競合し、挿入位置が復元されない）
            setVideoToGifOpen(false);
            void handleImageUpload(gif);
          }}
        />

        {/* 未保存離脱の確認 */}
        <UnsavedChangesDialog blocker={blocker} />
      </div>
    </DialogReturnFocusEditorContext.Provider>
  );
}
