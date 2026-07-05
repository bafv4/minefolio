import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/playground";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession, getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import {
  users,
  searchCrafts as searchCraftsTable,
  configHistory,
  searchCraftTemplates,
} from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { type UiRemapInfo } from "@/lib/remap-utils";
import { serializeSearchCrafts, serializeRemaps } from "@/lib/preset-utils";
import {
  applyCraftsToExistingPreset,
  createPresetWithCrafts,
} from "@/lib/search-craft-apply.server";
import {
  parseTemplateCrafts,
  parseTemplateRemaps,
  draftId,
  MAX_TEMPLATE_CRAFTS,
  type TemplateCraft,
} from "@/lib/search-craft-templates";
import { t } from "@/lib/messages";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  SearchCraftWorkbench,
  effectiveRemapsFrom,
  normalizeLayout,
  type WorkbenchRemap,
  type KeyboardLayoutOption,
} from "@/components/search-craft-workbench";
import type { SearchCraftDraft } from "@/components/search-craft-editor";
import { cn } from "@/lib/utils";
import {
  FlaskConical,
  Loader2,
  RotateCcw,
  Save,
  User,
  X,
} from "lucide-react";

// プリセットを1件も作成していないユーザー向けに、ライブテーブルの内容をそのまま
// 選択肢として見せるための擬似プリセットID（実際のconfigPresetsの行ではない）
const LIVE_PRESET_ID = "__live__";

export const meta = ({ data }: { data: Awaited<ReturnType<typeof loader>> | undefined }) => {
  const title = t("playground.title");
  const description = t("playground.pageDesc");
  const appUrl = data?.appUrl || "https://minefolio.pages.dev";
  const ogImage = `${appUrl}/og-image?title=${encodeURIComponent(t("playground.pageTitle"))}`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

type PlaygroundData = {
  crafts: TemplateCraft[];
  remaps: UiRemapInfo[];
};

type MyPresetOption = PlaygroundData & {
  id: string;
  name: string;
  isActive: boolean;
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getOptionalSession(request, auth);
  const url = new URL(request.url);
  const templateId = url.searchParams.get("template");

  // ログイン中ユーザーのプリセット一覧（読み込み・保存ダイアログ用）
  let myPresets: MyPresetOption[] = [];
  let myKeyboardLayout: string | null = null;
  let myDiscordId: string | null = null;

  if (session) {
    myDiscordId = session.user.id;
    const me = await db.query.users.findFirst({
      where: eq(users.discordId, session.user.id),
      with: {
        searchCrafts: { orderBy: [asc(searchCraftsTable.sequence)] },
        keyRemaps: true,
        playerConfig: { columns: { keyboardLayout: true } },
        configPresets: {
          columns: { id: true, name: true, isActive: true, searchCraftsData: true, remapsData: true },
        },
      },
    });
    if (me) {
      myKeyboardLayout = me.playerConfig?.keyboardLayout ?? null;

      if (me.configPresets.length > 0) {
        myPresets = me.configPresets.map((p) => ({
          id: p.id,
          name: p.name,
          isActive: p.isActive,
          crafts: parseTemplateCrafts(p.searchCraftsData),
          remaps: parseTemplateRemaps(p.remapsData),
        }));
      } else {
        // プリセット未作成ユーザー向けフォールバック：ライブテーブルの内容をそのまま選択肢にする
        const crafts = parseTemplateCrafts(serializeSearchCrafts(me.searchCrafts));
        const remaps = parseTemplateRemaps(serializeRemaps(me.keyRemaps));
        if (crafts.length > 0 || remaps.length > 0) {
          myPresets = [
            { id: LIVE_PRESET_ID, name: t("playground.currentSettingsLabel"), isActive: true, crafts, remaps },
          ];
        }
      }
    }
  }

  // ?template= 指定時はテンプレートを初期データとして読み込む
  let templateData: (PlaygroundData & { id: string; title: string }) | null = null;
  if (templateId) {
    const template = await db.query.searchCraftTemplates.findFirst({
      where: eq(searchCraftTemplates.id, templateId),
      with: { user: { columns: { discordId: true } } },
    });
    if (
      template &&
      (template.isPublished || (myDiscordId !== null && template.user.discordId === myDiscordId))
    ) {
      templateData = {
        id: template.id,
        title: template.title,
        crafts: parseTemplateCrafts(template.craftsData),
        remaps: parseTemplateRemaps(template.remapsData),
      };
    }
  }

  const appUrl = env.APP_URL || "https://minefolio.pages.dev";

  return {
    templateData,
    myPresets,
    keyboardLayout: myKeyboardLayout,
    isLoggedIn: !!session,
    appUrl,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // 保存はログイン必須（未ログインなら getSession が /login へリダイレクト）
  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });
  if (!user) {
    return { error: t("playground.userNotFound") };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;
  const includeRemaps = formData.get("includeRemaps") === "1";

  let crafts: TemplateCraft[] = [];
  let remaps: UiRemapInfo[] = [];
  try {
    crafts = JSON.parse((formData.get("crafts") as string | null) || "[]");
    remaps = includeRemaps ? JSON.parse((formData.get("remaps") as string | null) || "[]") : [];
  } catch {
    return { error: t("playground.saveFailed") };
  }
  if (!Array.isArray(crafts) || !Array.isArray(remaps) || crafts.length > MAX_TEMPLATE_CRAFTS) {
    return { error: t("playground.saveFailed") };
  }

  const now = new Date();
  // リマップ: includeRemaps=false のときは変更しない（null）
  const remapInput = includeRemaps
    ? remaps
        .filter((r) => r.sourceKey)
        .map((r) => ({
          sourceKey: r.sourceKey,
          targetKey: r.targetKey,
          software: r.software ?? null,
          notes: r.notes ?? null,
        }))
    : null;

  if (actionType === "save-new-preset") {
    const name = ((formData.get("name") as string | null) ?? "").trim();
    const description = ((formData.get("description") as string | null) ?? "").trim();
    const basePresetId = (formData.get("basePresetId") as string | null) || null;
    if (!name) {
      return { error: t("mePresets.presetNameRequired"), action: "save-new-preset" };
    }

    const result = await createPresetWithCrafts(
      db,
      user.id,
      { name, description: description || null, basePresetId },
      { crafts, remaps: remapInput },
    );
    if (!result.ok) {
      return { error: t("mePresets.sourcePresetNotFound"), action: "save-new-preset" };
    }

    await db.insert(configHistory).values({
      id: createId(),
      userId: user.id,
      changeType: "preset_switch",
      changeDescription: t("playground.saveNewPresetHistory", { name }),
      presetId: result.presetId,
      createdAt: now,
    });

    return { success: true, action: "save-new-preset", presetName: name };
  }

  if (actionType === "save-to-preset") {
    const presetId = formData.get("presetId") as string | null;
    if (!presetId) {
      return { error: t("mePresets.presetNotFound"), action: "save-to-preset" };
    }

    const result = await applyCraftsToExistingPreset(db, user.id, presetId, {
      crafts,
      remaps: remapInput,
    });
    if (!result.ok) {
      return { error: t("mePresets.presetNotFound"), action: "save-to-preset" };
    }

    await db.insert(configHistory).values({
      id: createId(),
      userId: user.id,
      changeType: "game_setting",
      changeDescription: t("playground.saveToPresetHistory", { name: result.presetName }),
      presetId: result.presetId,
      createdAt: now,
    });

    return {
      success: true,
      action: "save-to-preset",
      presetName: result.presetName,
      wasActive: result.wasActive,
    };
  }

  return { error: t("playground.unknownAction") };
}

// ============================================
// クライアント側の状態モデル
// ============================================


function toPlaygroundRemaps(remaps: UiRemapInfo[]): WorkbenchRemap[] {
  return remaps.map((r) => ({
    id: draftId("remap"),
    sourceKey: r.sourceKey,
    targetKey: r.targetKey,
  }));
}

function toPlaygroundCrafts(crafts: TemplateCraft[]): SearchCraftDraft[] {
  return crafts.map((c) => ({
    id: draftId("craft"),
    items: c.items,
    searchStr: c.searchStr,
    comment: c.comment,
    timing: c.timing,
  }));
}

// ============================================
// ブラウザローカルストレージへの仮保存
// ============================================

const DRAFT_STORAGE_KEY = "minefolio.playground.draft.v1";

type PlaygroundDraft = {
  remaps: WorkbenchRemap[];
  crafts: SearchCraftDraft[];
  layout: KeyboardLayoutOption;
};

function loadDraftFromStorage(): PlaygroundDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlaygroundDraft> | null;
    if (!parsed || !Array.isArray(parsed.remaps) || !Array.isArray(parsed.crafts)) return null;
    return {
      remaps: parsed.remaps,
      crafts: parsed.crafts,
      layout: normalizeLayout(parsed.layout),
    };
  } catch {
    return null;
  }
}

function saveDraftToStorage(draft: PlaygroundDraft) {
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // プライベートモード・容量超過等は無視（仮保存はベストエフォート）
  }
}

// ============================================
// ページ本体
// ============================================

export default function PlaygroundPage() {
  const { templateData, myPresets, keyboardLayout, isLoggedIn } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<typeof action>();
  const prevSaveDataRef = useRef<typeof saveFetcher.data>(undefined);

  const activeMyPreset = useMemo(
    () => myPresets.find((p) => p.isActive) ?? myPresets[0] ?? null,
    [myPresets],
  );
  const realPresets = useMemo(() => myPresets.filter((p) => p.id !== LIVE_PRESET_ID), [myPresets]);

  const initialData: PlaygroundData = templateData ?? activeMyPreset ?? { crafts: [], remaps: [] };

  const [remaps, setRemaps] = useState<WorkbenchRemap[]>(() =>
    toPlaygroundRemaps(initialData.remaps),
  );
  const [crafts, setCrafts] = useState<SearchCraftDraft[]>(() =>
    toPlaygroundCrafts(initialData.crafts),
  );
  const [layout, setLayout] = useState<KeyboardLayoutOption>(() => normalizeLayout(keyboardLayout));
  const [loadedLabel, setLoadedLabel] = useState<string | null>(() =>
    templateData
      ? t("playground.loadedTemplate", { title: templateData.title })
      : activeMyPreset
        ? t("playground.loadedPreset", { name: activeMyPreset.name })
        : null,
  );

  // ブラウザの下書き復元（テンプレート指定時は優先しない）。SSRとの表示差異を避けるためマウント後に実行する。
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    if (templateData) {
      setIsHydrated(true);
      return;
    }
    const draft = loadDraftFromStorage();
    if (draft) {
      setRemaps(draft.remaps.map((r) => ({ ...r, id: draftId("remap") })));
      setCrafts(draft.crafts.map((c) => ({ ...c, id: draftId("craft") })));
      setLayout(draft.layout);
      setLoadedLabel(t("playground.loadedDraft"));
    }
    setIsHydrated(true);
    // 初回マウント時のみ実行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 変更のたびにブラウザへ仮保存する
  useEffect(() => {
    if (!isHydrated) return;
    saveDraftToStorage({ remaps, crafts, layout });
  }, [isHydrated, remaps, crafts, layout]);

  // 保存ペイロード用の有効なリマップ（ワークベンチ内の表示と同じ導出）
  const effectiveRemaps = useMemo(() => effectiveRemapsFrom(remaps), [remaps]);

  const loadData = useCallback((data: PlaygroundData, label: string) => {
    setRemaps(toPlaygroundRemaps(data.remaps));
    setCrafts(toPlaygroundCrafts(data.crafts));
    setLoadedLabel(label);
  }, []);

  // ========== 読み込み・保存ダイアログ ==========

  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState<"new" | "existing">("new");
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetDescription, setNewPresetDescription] = useState("");
  const [basePresetId, setBasePresetId] = useState("__none");
  const [targetPresetId, setTargetPresetId] = useState("");
  const [saveIncludeRemaps, setSaveIncludeRemaps] = useState(true);

  const isSaving = saveFetcher.state === "submitting";

  useEffect(() => {
    const data = saveFetcher.data;
    if (!data || data === prevSaveDataRef.current) return;
    prevSaveDataRef.current = data;

    if ("success" in data && data.success) {
      if (data.action === "save-new-preset") {
        toast.success(t("playground.saveNewSuccess", { name: data.presetName }));
      } else if (data.action === "save-to-preset") {
        toast.success(
          data.wasActive
            ? t("playground.saveExistingActiveSuccess", { name: data.presetName })
            : t("playground.saveExistingSuccess", { name: data.presetName }),
        );
      }
      setSaveDialogOpen(false);
    } else if ("error" in data && data.error) {
      toast.error(data.error);
    }
  }, [saveFetcher.data]);

  const handleSaveDialogOpenChange = useCallback((open: boolean) => {
    setSaveDialogOpen(open);
    if (!open) {
      setSaveTarget("new");
      setNewPresetName("");
      setNewPresetDescription("");
      setBasePresetId("__none");
      setTargetPresetId("");
      setSaveIncludeRemaps(true);
    }
  }, []);

  const handleSave = useCallback(() => {
    const craftsPayload: TemplateCraft[] = crafts
      .filter((c) => c.items.length > 0 || c.searchStr?.trim() || c.comment?.trim())
      .map((c) => ({
        items: c.items,
        searchStr: c.searchStr?.trim() || null,
        comment: c.comment,
        timing: c.timing,
      }));

    const formData = new FormData();
    formData.set("_action", saveTarget === "new" ? "save-new-preset" : "save-to-preset");
    formData.set("includeRemaps", saveIncludeRemaps ? "1" : "0");
    formData.set("crafts", JSON.stringify(craftsPayload));
    formData.set("remaps", JSON.stringify(effectiveRemaps));
    if (saveTarget === "new") {
      formData.set("name", newPresetName.trim());
      formData.set("description", newPresetDescription.trim());
      if (basePresetId !== "__none") {
        formData.set("basePresetId", basePresetId);
      }
    } else {
      formData.set("presetId", targetPresetId);
    }
    saveFetcher.submit(formData, { method: "post" });
  }, [basePresetId, crafts, effectiveRemaps, newPresetDescription, newPresetName, saveFetcher, saveIncludeRemaps, saveTarget, targetPresetId]);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FlaskConical className="h-6 w-6 text-primary" />
          {t("playground.pageTitle")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          {t("playground.pageDescription")}
        </p>
      </div>

      {/* データ読み込み・保存バー */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <span className="text-sm text-muted-foreground">{t("playground.dataSource")}</span>
        {loadedLabel && (
          <Badge variant="secondary" className="text-xs">
            {loadedLabel}
          </Badge>
        )}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {templateData && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                loadData(
                  templateData,
                  t("playground.loadedTemplate", { title: templateData.title }),
                )
              }
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              {t("playground.reloadTemplate")}
            </Button>
          )}

          {isLoggedIn && myPresets.length > 0 && (
            <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <User className="mr-2 h-3.5 w-3.5" />
                  {t("playground.loadMySettings")}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t("playground.loadDialogTitle")}</DialogTitle>
                  <DialogDescription>{t("playground.loadDialogDescription")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {myPresets.map((preset) => (
                    <Button
                      key={preset.id}
                      variant="outline"
                      className="w-full justify-start h-auto py-3"
                      onClick={() => {
                        loadData(preset, t("playground.loadedPreset", { name: preset.name }));
                        setLoadDialogOpen(false);
                      }}
                    >
                      <div className="flex flex-col items-start gap-1">
                        <span className="font-medium flex items-center gap-2">
                          {preset.name}
                          {preset.isActive && (
                            <Badge variant="outline" className="text-xs">
                              {t("mePresets.active")}
                            </Badge>
                          )}
                        </span>
                        <div className="flex gap-1 flex-wrap">
                          <Badge variant="secondary" className="text-xs">
                            {t("templates.craftCount", { count: preset.crafts.length })}
                          </Badge>
                          {preset.remaps.length > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              {t("templates.remapCount", { count: preset.remaps.length })}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRemaps([]);
              setCrafts([]);
              setLoadedLabel(null);
            }}
          >
            <X className="mr-2 h-3.5 w-3.5" />
            {t("playground.clearAll")}
          </Button>

          {isLoggedIn && (
            <>
              <div className="h-4 w-px bg-border mx-1" />
              <Dialog open={saveDialogOpen} onOpenChange={handleSaveDialogOpenChange}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Save className="mr-2 h-3.5 w-3.5" />
                    {t("mePresets.save")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>{t("playground.saveDialogTitle")}</DialogTitle>
                    <DialogDescription>{t("playground.saveDialogDescription")}</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <RadioGroup
                      value={saveTarget}
                      onValueChange={(v) => setSaveTarget(v as "new" | "existing")}
                      className="space-y-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="new" id="save-target-new" />
                        <Label htmlFor="save-target-new" className="cursor-pointer font-normal">
                          {t("playground.saveAsNewOption")}
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem
                          value="existing"
                          id="save-target-existing"
                          disabled={realPresets.length === 0}
                        />
                        <Label
                          htmlFor="save-target-existing"
                          className={cn(
                            "cursor-pointer font-normal",
                            realPresets.length === 0 && "text-muted-foreground",
                          )}
                        >
                          {t("playground.saveToExistingOption")}
                        </Label>
                      </div>
                    </RadioGroup>

                    {saveTarget === "new" ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="save-new-name">{t("mePresets.presetName")}</Label>
                          <Input
                            id="save-new-name"
                            value={newPresetName}
                            onChange={(e) => setNewPresetName(e.target.value)}
                            placeholder={t("mePresets.presetNamePlaceholder")}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="save-new-description">
                            {t("mePresets.descriptionOptional")}
                          </Label>
                          <Textarea
                            id="save-new-description"
                            value={newPresetDescription}
                            onChange={(e) => setNewPresetDescription(e.target.value)}
                            placeholder={t("mePresets.descriptionPlaceholder")}
                            rows={3}
                          />
                        </div>
                        {realPresets.length > 0 && (
                          <div className="space-y-2">
                            <Label htmlFor="save-base-preset">
                              {t("playground.basePresetLabel")}
                            </Label>
                            <Select value={basePresetId} onValueChange={setBasePresetId}>
                              <SelectTrigger id="save-base-preset">
                                <SelectValue placeholder={t("playground.basePresetNone")} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none">
                                  {t("playground.basePresetNone")}
                                </SelectItem>
                                {realPresets.map((preset) => (
                                  <SelectItem key={preset.id} value={preset.id}>
                                    <div className="flex items-center gap-2">
                                      {preset.name}
                                      {preset.isActive && (
                                        <Badge variant="outline" className="text-xs ml-1">
                                          {t("mePresets.active")}
                                        </Badge>
                                      )}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              {t("playground.basePresetHint")}
                            </p>
                          </div>
                        )}
                      </>
                    ) : realPresets.length > 0 ? (
                      <div className="space-y-2">
                        <Label htmlFor="save-target-preset">{t("playground.targetPresetLabel")}</Label>
                        <Select value={targetPresetId} onValueChange={setTargetPresetId}>
                          <SelectTrigger id="save-target-preset">
                            <SelectValue placeholder={t("mePresets.selectPreset")} />
                          </SelectTrigger>
                          <SelectContent>
                            {realPresets.map((preset) => (
                              <SelectItem key={preset.id} value={preset.id}>
                                <div className="flex items-center gap-2">
                                  {preset.name}
                                  {preset.isActive && (
                                    <Badge variant="outline" className="text-xs ml-1">
                                      {t("mePresets.active")}
                                    </Badge>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("playground.noPresetsToOverwrite")}
                      </p>
                    )}

                    {effectiveRemaps.length > 0 && (
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="save-include-remaps"
                          checked={saveIncludeRemaps}
                          onCheckedChange={(checked) => setSaveIncludeRemaps(checked === true)}
                        />
                        <div className="grid gap-1 leading-none">
                          <Label htmlFor="save-include-remaps" className="text-sm">
                            {t("playground.saveIncludeRemapsLabel", { count: effectiveRemaps.length })}
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            {t("playground.saveIncludeRemapsHint")}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
                      {t("templates.cancel")}
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={
                        isSaving ||
                        (saveTarget === "new" && !newPresetName.trim()) ||
                        (saveTarget === "existing" && !targetPresetId)
                      }
                    >
                      {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {t("mePresets.save")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-6">{t("playground.autosaveHint")}</p>

      {/* ワークベンチ（リマップ → キーボード → タイピングテスト → サーチクラフト） */}
      <SearchCraftWorkbench
        crafts={crafts}
        onCraftsChange={setCrafts}
        remaps={remaps}
        onRemapsChange={setRemaps}
        layout={layout}
        onLayoutChange={setLayout}
      />

      {/* 保存への導線 */}
      <div className="rounded-lg border border-dashed bg-secondary/30 p-4 text-sm text-muted-foreground">
        {isLoggedIn ? (
          <>
            {t("playground.saveHintLoggedIn")}{" "}
            <Link to="/me/keybindings" className="text-primary hover:underline">
              {t("playground.goToKeybindings")}
            </Link>
            {" / "}
            <Link to="/me/search-craft" className="text-primary hover:underline">
              {t("playground.goToSearchCraft")}
            </Link>
          </>
        ) : (
          <>
            {t("playground.saveHintLoggedOut")}{" "}
            <Link to="/login" className="text-primary hover:underline">
              {t("playground.loginLink")}
            </Link>
          </>
        )}
        {" · "}
        <Link to="/guides/templates" className="text-primary hover:underline">
          {t("playground.backToTemplates")}
        </Link>
      </div>
    </div>
  );
}
