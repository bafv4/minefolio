import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Download, Loader2, Save, X } from "lucide-react";

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

export function TemplateEditorForm({
  initial,
  currentSettings,
  keyboardLayout,
  isSubmitting,
  onSubmit,
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
  onSubmit: (data: TemplateEditorData) => void;
  /** 確定ボタンの文言（省略時は「保存」） */
  submitLabel?: string;
  /** 直近の保存結果（fetcher.data をそのまま渡す。送信のたびに新しい参照になる） */
  saveResult?: unknown;
  /** saveResult が成功を表すか */
  saveSucceeded?: boolean;
  /** 保存成功後、未保存の表示を消してから呼ぶ（遷移などはここで行う。離脱確認に止められない） */
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
  // バーチャルキーボードの表示レイアウト（初期値はユーザーの設定）
  const [layout, setLayout] = useState<KeyboardLayoutOption>(() =>
    normalizeLayout(keyboardLayout),
  );

  // 未保存判定: 現在値が基準（開いたときの値。保存に成功したらその送信内容）と違うか。表示レイアウトは含めない
  const currentKey = useMemo(
    () => JSON.stringify({ title, description, gameLanguage, crafts, remaps, loops }),
    [title, description, gameLanguage, crafts, remaps, loops],
  );
  const [baselineKey, setBaselineKey] = useState(() =>
    JSON.stringify({
      title: initial.title,
      description: initial.description,
      gameLanguage: initial.gameLanguage,
      crafts: initial.crafts,
      remaps: initial.remaps,
      loops: initial.loops,
    }),
  );
  const dirty = currentKey !== baselineKey;
  const blocker = useUnsavedWarning(dirty);
  const submittedKeyRef = useRef<string | null>(null);
  const handledResultRef = useRef<unknown>(saveResult);
  const [savedPending, setSavedPending] = useState(false);

  // 保存に成功したら、送信した内容を基準にして未保存を解消する
  useEffect(() => {
    if (saveResult === undefined || saveResult === handledResultRef.current) return;
    handledResultRef.current = saveResult;
    if (saveSucceeded && submittedKeyRef.current !== null) {
      setBaselineKey(submittedKeyRef.current);
      setSavedPending(true);
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

  const handleSave = useCallback(() => {
    if (!title.trim()) {
      toast.error(t("meTemplates.titleRequired"));
      return;
    }
    if (crafts.length === 0) {
      toast.error(t("meTemplates.noCraftsInEditor"));
      return;
    }
    if (crafts.some((c) => c.items.length === 0)) {
      toast.error(t("meSearchCraft.selectAtLeastOneItem"));
      return;
    }
    if (crafts.some((c) => c.variations.length === 0 || c.variations.some((v) => !v.str.trim()))) {
      toast.error(t("meSearchCraft.craftStringRequired"));
      return;
    }
    if (loops.some((loop) => loop.steps.length < 2)) {
      toast.error(t("meSearchCraft.loopStepsRequired"));
      return;
    }
    if (loops.some((loop) => loop.steps.some((s) => !s.craftId))) {
      toast.error(t("meSearchCraft.loopEntryRequired"));
      return;
    }
    submittedKeyRef.current = currentKey;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      gameLanguage,
      crafts,
      remaps,
      loops,
    });
  }, [crafts, currentKey, description, gameLanguage, loops, onSubmit, remaps, title]);

  return (
    <div className="space-y-6">
      {/* 操作バー */}
      <div className="flex flex-wrap items-center gap-2">
        {hasCurrentSettings && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
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
        <Button onClick={handleSave} disabled={isSubmitting} className="ml-auto">
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {submitLabel ?? t("meTemplates.save")}
        </Button>
      </div>

      {/* 基本情報 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("meTemplates.basicInfo")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-title">{t("meTemplates.templateName")}</Label>
            <Input
              id="template-title"
              value={title}
              maxLength={TEMPLATE_TITLE_MAX}
              placeholder={t("meTemplates.templateNamePlaceholder")}
              onChange={(e) => setTitle(e.target.value)}
            />
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
        </CardContent>
      </Card>

      {/* ワークベンチ（/playground と同一構成: リマップ → キーボード → タイピングテスト → サーチクラフト → Loop） */}
      <SearchCraftWorkbench
        crafts={crafts}
        onCraftsChange={setCrafts}
        loops={loops}
        onLoopsChange={setLoops}
        remaps={remaps}
        onRemapsChange={setRemaps}
        layout={layout}
        onLayoutChange={setLayout}
      />

      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
