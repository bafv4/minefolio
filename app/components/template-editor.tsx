import { useState, useCallback } from "react";
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
    if (crafts.some((c) => !c.searchStr)) {
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
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      gameLanguage,
      crafts,
      remaps,
      loops,
    });
  }, [crafts, description, gameLanguage, loops, onSubmit, remaps, title]);

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
          {t("meTemplates.save")}
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
                  onClick={() => setGameLanguage("")}
                >
                  <X className="h-4 w-4" />
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
    </div>
  );
}
