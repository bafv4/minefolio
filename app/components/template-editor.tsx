import { useState, useCallback, useEffect, useId, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/page-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NoticeBanner } from "@/components/notice-banner";
import { getPublishAction, hasDraftSave, type PublishAction } from "@/components/guide-editor/hooks/use-guide-save";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { SearchCraftDraft } from "@/components/search-craft-editor";
import type { SearchCraftLoopDraft } from "@/components/search-craft-loop-editor";
import {
  SearchCraftWorkbench,
  normalizeLayout,
  type KeyboardLayoutOption,
} from "@/components/search-craft-workbench";
import { gameLanguageOptions } from "@/lib/game-languages";
import {
  TEMPLATE_TITLE_MAX,
  TEMPLATE_DESCRIPTION_MAX,
  draftId,
} from "@/lib/search-craft-templates";
import { remapLoopSteps } from "@/lib/search-craft-loops";
import { useT, useLocale } from "@/hooks/use-locale";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { toast } from "sonner";
import { Download, Loader2, Save, Send, Undo2, X } from "lucide-react";

/**
 * サーチクラフトテンプレートの編集フォーム（作成・編集ページで共通）。
 * プリセットや現在の設定を経由せず、テンプレートの内容そのものを直接編集できる。
 */

export type TemplateRemapDraft = {
  id: string;
  sourceKey: string;
  targetKey: string | null;
};

export type TemplateEditorData = {
  title: string;
  description: string;
  gameLanguage: string; // "" = 未設定
  crafts: SearchCraftDraft[];
  remaps: TemplateRemapDraft[];
  loops: SearchCraftLoopDraft[];
};

/** 保存の種類。draft＝下書き保存（公開版を変えない）、publish＝フォームの値を公開版へ書く（公開スイッチの値も送る） */
export type TemplateSaveMode = "draft" | "publish";

/** 編集画面だけが渡す、公開・下書きの状態。省略（新規作成）なら公開スイッチも下書き保存も出さない */
export type TemplatePublishState = {
  /** 保存済みの isPublished（いま読者に公開されているか） */
  livePublished: boolean;
  /** 未公開の下書きがあるか */
  hasDraft: boolean;
  /** 「公開版に戻す」（下書きを破棄する） */
  onDiscard: () => void;
  isDiscarding: boolean;
};

export function TemplateEditorForm({
  initial,
  currentSettings,
  keyboardLayout,
  isSubmitting,
  onSubmit,
  publishState,
  initialPublished = false,
  submitLabel,
  saveResult,
  saveSucceeded,
  onSaved,
}: {
  initial: TemplateEditorData;
  /** 「現在の設定を読み込む」用のライブ設定（空なら非表示） */
  currentSettings: {
    crafts: SearchCraftDraft[];
    remaps: TemplateRemapDraft[];
    loops: SearchCraftLoopDraft[];
  } | null;
  keyboardLayout: string | null;
  isSubmitting: boolean;
  onSubmit: (data: TemplateEditorData, mode: TemplateSaveMode, isPublished: boolean) => void;
  publishState?: TemplatePublishState;
  /** 公開スイッチの初期値（保存済みの isPublished） */
  initialPublished?: boolean;
  /** 確定ボタンの文言（省略時は「保存」） */
  submitLabel?: string;
  /** 直近の保存結果（fetcher.data をそのまま渡す。送信のたびに新しい参照になる） */
  saveResult?: unknown;
  /** saveResult が成功を表すか */
  saveSucceeded?: boolean;
  /** 保存成功後、未保存の表示を消してから呼ぶ（遷移などはここで行う。離脱確認に止められない）。
   *  下書き保存では呼ばない（編集を続けるため） */
  onSaved?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [gameLanguage, setGameLanguage] = useState(initial.gameLanguage);
  const [crafts, setCrafts] = useState<SearchCraftDraft[]>(initial.crafts);
  const [remaps, setRemaps] = useState<TemplateRemapDraft[]>(initial.remaps);
  const [loops, setLoops] = useState<SearchCraftLoopDraft[]>(initial.loops);
  const [publishSetting, setPublishSetting] = useState(initialPublished);
  // バーチャルキーボードの表示レイアウト（初期値はユーザーの設定）
  const [layout, setLayout] = useState<KeyboardLayoutOption>(() =>
    normalizeLayout(keyboardLayout),
  );

  // 未保存判定: 現在値が基準（開いたときの値。保存に成功したらその送信内容）と違うか。表示レイアウトは含めない
  const currentKey = useMemo(
    () =>
      JSON.stringify({ title, description, gameLanguage, crafts, remaps, loops, publishSetting }),
    [title, description, gameLanguage, crafts, remaps, loops, publishSetting],
  );
  const [baselineKey, setBaselineKey] = useState(() =>
    JSON.stringify({
      title: initial.title,
      description: initial.description,
      gameLanguage: initial.gameLanguage,
      crafts: initial.crafts,
      remaps: initial.remaps,
      loops: initial.loops,
      publishSetting: initialPublished,
    }),
  );
  const dirty = currentKey !== baselineKey;
  const blocker = useUnsavedWarning(dirty);
  const submittedKeyRef = useRef<string | null>(null);
  const submittedModeRef = useRef<TemplateSaveMode>("publish");
  const handledResultRef = useRef<unknown>(saveResult);
  const [savedPending, setSavedPending] = useState(false);

  // 保存に成功したら、送信した内容を基準にして未保存を解消する
  useEffect(() => {
    if (saveResult === undefined || saveResult === handledResultRef.current) return;
    handledResultRef.current = saveResult;
    if (saveSucceeded && submittedKeyRef.current !== null) {
      setBaselineKey(submittedKeyRef.current);
      // 下書き保存は編集を続ける。公開版への保存だけ、保存後の遷移（onSaved）へ進む
      if (submittedModeRef.current === "publish") setSavedPending(true);
    }
  }, [saveResult, saveSucceeded]);

  // 未保存が解消された後のレンダーで onSaved を呼ぶ（useUnsavedWarning の blocker が更新された後なので止められない）
  useEffect(() => {
    if (savedPending && !dirty) {
      setSavedPending(false);
      onSaved?.();
    }
  }, [savedPending, dirty, onSaved]);

  const hasCurrentSettings =
    !!currentSettings &&
    (currentSettings.crafts.length > 0 || currentSettings.remaps.length > 0);

  const loadCurrentSettings = useCallback(() => {
    if (!currentSettings) return;
    // crafts の draft id を振り直すため、Loop の craftId 参照も新しい id へ再解決する
    // （旧id→新id の identity でない写像を remapLoopSteps に通し、<2 になった Loop は自動除去）
    const idMap = new Map<string, string>();
    setCrafts(
      currentSettings.crafts.map((c) => {
        const newId = draftId("craft");
        idMap.set(c.id, newId);
        return { ...c, id: newId };
      }),
    );
    setRemaps(currentSettings.remaps.map((r) => ({ ...r, id: draftId("remap") })));
    setLoops(
      currentSettings.loops
        .map((loop) => {
          const steps = remapLoopSteps(loop.steps, idMap);
          return steps ? { ...loop, id: draftId("loop"), steps } : null;
        })
        .filter((loop): loop is SearchCraftLoopDraft => loop !== null),
    );
    toast.success(t("meTemplates.loadedFromCurrent"));
  }, [currentSettings]);

  // 検証エラー。テンプレート名は欄に aria-invalid と欄の下の文を出す。サーチクラフト・Loop の誤りは
  // ワークベンチの中の個々の欄までは指せないので、ワークベンチの直前に文を出す（どちらもトーストは補助として残す）
  const [titleError, setTitleError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const contentErrorId = useId();
  // 直した内容が変わったら、その欄のエラーを消す（次の保存で改めて検証する）
  useEffect(() => {
    setContentError(null);
  }, [crafts, loops]);

  const handleSave = useCallback((mode: TemplateSaveMode) => {
    const nextTitleError = title.trim() ? null : t("meTemplates.titleRequired");
    let nextContentError: string | null = null;
    if (crafts.length === 0) {
      nextContentError = t("meTemplates.noCraftsInEditor");
    } else if (crafts.some((c) => c.items.length === 0)) {
      nextContentError = t("meSearchCraft.selectAtLeastOneItem");
    } else if (crafts.some((c) => c.variations.length === 0 || c.variations.some((v) => !v.str.trim()))) {
      nextContentError = t("meSearchCraft.craftStringRequired");
    } else if (loops.some((loop) => loop.steps.length < 2)) {
      nextContentError = t("meSearchCraft.loopStepsRequired");
    } else if (loops.some((loop) => loop.steps.some((s) => !s.craftId))) {
      nextContentError = t("meSearchCraft.loopEntryRequired");
    }
    setTitleError(nextTitleError);
    setContentError(nextContentError);
    if (nextTitleError || nextContentError) {
      toast.error(nextTitleError ?? nextContentError);
      // 最初の誤りへフォーカスを移す（文書順でテンプレート名が先）。文は描画後に出るので次のフレームで移す
      requestAnimationFrame(() => {
        if (nextTitleError) titleInputRef.current?.focus();
        else document.getElementById(contentErrorId)?.focus();
      });
      return;
    }
    submittedKeyRef.current = currentKey;
    submittedModeRef.current = mode;
    onSubmit(
      {
        title: title.trim(),
        description: description.trim(),
        gameLanguage,
        crafts,
        remaps,
        loops,
      },
      mode,
      publishSetting,
    );
  }, [crafts, currentKey, description, gameLanguage, loops, onSubmit, publishSetting, remaps, title]);

  // 送信ボタン（上端の操作バーと文書の末尾に同じものを置く。文書が長く、上へ戻らずに送れるように）
  // 公開中は「下書き保存」（公開版を変えない）＋主ボタン。主ボタンの名前は公開スイッチと保存済みの公開状態で決まる（ガイドと同じ）
  const publishAction: PublishAction | null = publishState
    ? getPublishAction(publishState.livePublished, publishSetting)
    : null;
  const publishLabels: Record<PublishAction, string> = {
    publish: t("meTemplates.publish"),
    publishUpdate: t("meTemplates.publishUpdate"),
    unpublish: t("meTemplates.unpublish"),
    saveUnpublished: t("meTemplates.save"),
  };
  const showDraftSave = !!publishState && hasDraftSave(publishState.livePublished);
  const busy = isSubmitting || !!publishState?.isDiscarding;
  const submitButton = (
    <div className="flex flex-wrap items-center gap-2">
      {showDraftSave && (
        <Button
          variant="outline"
          onClick={() => handleSave("draft")}
          disabled={busy}
          className="h-11 sm:h-9"
        >
          <Save className="mr-2 h-4 w-4" aria-hidden />
          {t("meTemplates.saveDraft")}
        </Button>
      )}
      <Button onClick={() => handleSave("publish")} disabled={busy} className="h-11 sm:h-9">
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : publishAction && publishAction !== "saveUnpublished" ? (
          <Send className="mr-2 h-4 w-4" aria-hidden />
        ) : (
          <Save className="mr-2 h-4 w-4" aria-hidden />
        )}
        {publishAction ? publishLabels[publishAction] : (submitLabel ?? t("meTemplates.save"))}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* 下書きがあるとき: 公開版との差があることを知らせ、公開版へ戻せる（破棄は取り消せないので確認する） */}
      {publishState?.hasDraft && (
        <NoticeBanner tone="warning">
         <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{t("meTemplates.draftBanner", { action: publishAction ? publishLabels[publishAction] : t("meTemplates.save") })}</span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>
                <Undo2 className="mr-2 h-4 w-4" aria-hidden />
                {t("meTemplates.revertToPublished")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("meTemplates.revertConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("meTemplates.revertConfirmDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("meTemplates.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={publishState.onDiscard}>
                  {t("meTemplates.revertToPublished")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
         </div>
        </NoticeBanner>
      )}

      {/* 操作バー */}
      <div className="flex flex-wrap items-center gap-2">
        {hasCurrentSettings && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8">
                <Download className="mr-2 h-4 w-4" />
                {t("meTemplates.loadFromCurrent")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("meTemplates.loadFromCurrentConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("meTemplates.loadFromCurrentConfirmDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("meTemplates.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={loadCurrentSettings}>
                  {t("meTemplates.loadFromCurrent")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {publishState && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
            <Switch checked={publishSetting} onCheckedChange={setPublishSetting} />
            {t("meTemplates.publishSwitch")}
          </label>
        )}
        <div className="ml-auto">{submitButton}</div>
      </div>

      {/* 基本情報（欄名はページの h1 の下の h2。ワークベンチの欄名も同じ段） */}
      <PageSection id="template-basic-info" title={t("meTemplates.basicInfo")}>
          <div className="space-y-2">
            <Label htmlFor="template-title">
              {t("meTemplates.templateName")}
              <span className="font-normal text-muted-foreground">{t("meTemplates.requiredMark")}</span>
            </Label>
            <Input
              ref={titleInputRef}
              id="template-title"
              value={title}
              aria-required
              maxLength={TEMPLATE_TITLE_MAX}
              placeholder={t("meTemplates.templateNamePlaceholder")}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? "template-title-error" : undefined}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError && e.target.value.trim()) setTitleError(null);
              }}
            />
            {titleError && (
              <p id="template-title-error" className="text-sm text-destructive">
                {titleError}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-description">{t("meTemplates.descriptionOptional")}</Label>
            <Textarea
              id="template-description"
              value={description}
              maxLength={TEMPLATE_DESCRIPTION_MAX}
              rows={3}
              placeholder={t("meTemplates.descriptionPlaceholder")}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-language">{t("meTemplates.languageLabel")}</Label>
            <div className="flex items-center gap-2">
              <Combobox
                options={gameLanguageOptions(t, locale)}
                value={gameLanguage}
                onValueChange={setGameLanguage}
                placeholder={t("meTemplates.languageNone")}
                searchPlaceholder={t("meDevices.search")}
                emptyText={t("meDevices.notFound")}
                className="w-full sm:w-80"
              />
              {gameLanguage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0 shrink-0"
                  aria-label={t("meTemplates.languageClear")}
                  title={t("meTemplates.languageClear")}
                  onClick={() => setGameLanguage("")}
                >
                  <X aria-hidden />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("meTemplates.languageHint")}</p>
          </div>
      </PageSection>

      {/* サーチクラフト・Loop の検証エラー（ワークベンチの中の個々の欄は指せないので、ワークベンチの直前に出し、ここへフォーカスを移す） */}
      {contentError && (
        <NoticeBanner
          tone="error"
          role="status"
          id={contentErrorId}
          tabIndex={-1}
          className="px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {contentError}
        </NoticeBanner>
      )}

      {/* ワークベンチ（/playground と同じ部品。craftFirst で、主作業のサーチクラフトを先頭にする: サーチクラフト → キーボード → リマップ） */}
      <SearchCraftWorkbench
        crafts={crafts}
        onCraftsChange={setCrafts}
        loops={loops}
        onLoopsChange={setLoops}
        remaps={remaps}
        onRemapsChange={setRemaps}
        layout={layout}
        onLayoutChange={setLayout}
        sectionHeadingLevel="h2"
        craftFirst
      />

      {/* 末尾の送信ボタン（上端と同じ。文書が長いので、編集を終えた位置から送れるようにする） */}
      <div className="flex justify-end border-t border-border/60 pt-4">{submitButton}</div>

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
