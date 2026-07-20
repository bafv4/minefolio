import { useEffect, useRef, useState, useCallback } from "react";
import { useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import type { Route } from "./+types/devices";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, playerConfigs, configPresets } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { toast } from "sonner";
import {
  Keyboard,
  Mouse,
  Gamepad2,
  AlertCircle,
  Settings,
  Copy,
  Smartphone,
} from "lucide-react";
import { type ControllerSettings, DEFAULT_CONTROLLER_SETTINGS } from "@/lib/keybindings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { t } from "@/lib/messages";
import { GAME_LANGUAGE_OPTIONS } from "@/lib/game-languages";
import { syncActivePresetSnapshot, assertPresetIsActive, PresetMismatchError } from "@/lib/preset-utils";
import { configHistory } from "@/lib/schema";
import { createId } from "@paralleldrive/cuid2";
import { PresetSelector } from "@/components/preset-selector";

export const meta: Route.MetaFunction = () => {
  return [{ title: t("meDevices.title") }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate, formAction, currentUrl, nextUrl }: ShouldRevalidateFunctionArgs) {
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  // /me/presets でのアクション（プリセット切替・作成・削除）の後は再検証する
  if (formAction === "/me/presets") {
    return true;
  }
  // PresetSelector の focus 再検証（別タブでのプリセット切替検知）を通すため、
  // revalidator 起点（アクション無し・URL 不変）の再検証は既定の判断に任せる
  if (!formAction && currentUrl.href === nextUrl.href) {
    return defaultShouldRevalidate;
  }
  return false;
}

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      playerConfig: true,
    },
  });

  if (!user) {
    throw new Response(t("meDevices.userNotFound"), { status: 404 });
  }

  // 全プリセットを取得（コピー機能用）
  const allPresets = await db.query.configPresets.findMany({
    where: eq(configPresets.userId, user.id),
    columns: {
      id: true,
      name: true,
      isActive: true,
      playerConfigData: true,
    },
  });

  // アクティブなプリセットを取得
  const activePreset = allPresets.find((p) => p.isActive);

  return {
    config: user.playerConfig,
    inputMethod: user.inputMethod,
    activePreset: activePreset ? { id: activePreset.id, name: activePreset.name } : null,
    hasPresets: allPresets.length > 0,
    presets: allPresets.map((p) => ({
      id: p.id,
      name: p.name,
      isActive: p.isActive,
      hasDeviceConfig: !!p.playerConfigData,
      playerConfigData: p.playerConfigData,
    })),
  };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-8 w-24 bg-muted rounded animate-pulse" />
          <div className="h-5 w-56 bg-muted rounded animate-pulse" />
        </div>
        <div className="h-9 w-20 bg-muted rounded animate-pulse" />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-6 space-y-4">
          <div className="h-6 w-32 bg-muted rounded animate-pulse" />
          <div className="space-y-3">
            <div className="h-10 w-full bg-muted rounded animate-pulse" />
            <div className="h-10 w-full bg-muted rounded animate-pulse" />
          </div>
        </div>
        <div className="border rounded-lg p-6 space-y-4">
          <div className="h-6 w-24 bg-muted rounded animate-pulse" />
          <div className="space-y-3">
            <div className="h-10 w-full bg-muted rounded animate-pulse" />
            <div className="h-10 w-full bg-muted rounded animate-pulse" />
            <div className="h-10 w-full bg-muted rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Settings Card */}
      <div className="border rounded-lg p-6 space-y-4">
        <div className="h-6 w-40 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="h-10 bg-muted rounded animate-pulse" />
          <div className="h-10 bg-muted rounded animate-pulse" />
          <div className="h-10 bg-muted rounded animate-pulse" />
          <div className="h-10 bg-muted rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export async function action({ request }: Route.ActionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: { playerConfig: true },
  });

  if (!user) {
    return { error: t("meDevices.userNotFound") };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string | null;
  const presetId = (formData.get("presetId") as string | null) || null;

  try {
    await assertPresetIsActive(db, user.id, presetId);
  } catch (e) {
    if (e instanceof PresetMismatchError) {
      return { error: t("mePresets.staleSession") };
    }
    throw e;
  }

  // playerConfig はプリセットのスナップショットに含まれるデータのため、
  // アクティブなプリセットが無い状態では保存できない（UIのグレーアウトだけでなくサーバー側でも拒否）。
  // プリセットが無いまま書き込むと syncActivePresetSnapshot が無言でスキップされ、
  // どのプリセットにも属さないデータになってしまう。
  // 入力方法のみの保存（saveInputMethod）は users.inputMethod（プリセット非依存）だけを
  // 更新するため、プリセットが無くても許可する。
  if (actionType !== "saveInputMethod") {
    const activePresetRow = await db.query.configPresets.findFirst({
      where: and(eq(configPresets.userId, user.id), eq(configPresets.isActive, true)),
      columns: { id: true },
    });
    if (!activePresetRow) {
      return { error: t("meDevices.presetRequired") };
    }
  }

  // 入力方法の更新（users.inputMethod はプリセット非依存）
  const inputMethodValue = formData.get("inputMethod") as string | null;
  if (inputMethodValue !== null) {
    const validInputMethods = ["keyboard_mouse", "controller", "touch", ""] as const;
    if (validInputMethods.includes(inputMethodValue as typeof validInputMethods[number])) {
      const typedInputMethod = inputMethodValue === "" ? null : inputMethodValue as "keyboard_mouse" | "controller" | "touch";
      await db
        .update(users)
        .set({ inputMethod: typedInputMethod })
        .where(eq(users.id, user.id));
    }
  }

  // 入力方法のみの保存はここで完了（playerConfig 系は書き込まない）
  if (actionType === "saveInputMethod") {
    return { success: true };
  }

  const keyboardLayout = (formData.get("keyboardLayout") as string) || null;
  const keyboardModel = (formData.get("keyboardModel") as string)?.trim() || null;
  const mouseModel = (formData.get("mouseModel") as string)?.trim() || null;
  const mouseDpiStr = formData.get("mouseDpi") as string;
  const gameSensitivityStr = formData.get("gameSensitivity") as string;
  const windowsSpeedStr = formData.get("windowsSpeed") as string;
  const windowsSpeedMultiplierStr = formData.get("windowsSpeedMultiplier") as string;
  const toggleSprint = formData.get("toggleSprint") === "true";
  const toggleSneak = formData.get("toggleSneak") === "true";
  const autoJump = formData.get("autoJump") === "true";
  const rawInput = formData.get("rawInput") === "true";
  const mouseAcceleration = formData.get("mouseAcceleration") === "true";
  const gameLanguage = (formData.get("gameLanguage") as string)?.trim() || null;
  const fovStr = formData.get("fov") as string;
  const guiScaleStr = formData.get("guiScale") as string;
  const notes = (formData.get("notes") as string)?.trim() || null;

  // コントローラー設定
  const controllerSettingsJson = formData.get("controllerSettings") as string;
  const controllerSettings = controllerSettingsJson ? controllerSettingsJson : null;

  const mouseDpi = mouseDpiStr ? parseInt(mouseDpiStr) : null;
  const gameSensitivity = gameSensitivityStr ? parseFloat(gameSensitivityStr) : null;
  const windowsSpeed = windowsSpeedStr ? parseInt(windowsSpeedStr) : null;
  const windowsSpeedMultiplier = windowsSpeedMultiplierStr ? parseFloat(windowsSpeedMultiplierStr) : null;
  const fov = fovStr ? parseInt(fovStr) : null;
  const guiScale = guiScaleStr ? parseInt(guiScaleStr) : null;

  const configData = {
    keyboardLayout: keyboardLayout as "JIS" | "US" | "JIS_TKL" | "US_TKL" | null,
    keyboardModel,
    mouseModel,
    mouseDpi,
    gameSensitivity,
    windowsSpeed,
    windowsSpeedMultiplier,
    toggleSprint,
    toggleSneak,
    autoJump,
    rawInput,
    mouseAcceleration,
    gameLanguage,
    fov,
    guiScale,
    notes,
    controllerSettings,
    updatedAt: new Date(),
  };

  // upsert: ライブの playerConfig 行が無い場合は insert する
  // （update のみだと保存が無言で失われ、直後の sync がスナップショットを null で上書きする）
  if (user.playerConfig) {
    await db
      .update(playerConfigs)
      .set(configData)
      .where(eq(playerConfigs.id, user.playerConfig.id));
  } else {
    await db.insert(playerConfigs).values({
      id: createId(),
      userId: user.id,
      ...configData,
      createdAt: new Date(),
    });
  }

  // アクティブプリセットスナップショット同期
  await syncActivePresetSnapshot(db, user.id, ["playerConfig", "fingers"]);

  // 変更履歴を記録
  await db.insert(configHistory).values({
    id: createId(),
    userId: user.id,
    changeType: "device",
    changeDescription: t("meDevices.deviceChangeHistory"),
    createdAt: new Date(),
  });

  return { success: true };
}

// コントローラー設定をパース
function parseControllerSettings(json: string | null | undefined): ControllerSettings {
  if (!json) return DEFAULT_CONTROLLER_SETTINGS;
  try {
    const parsed = JSON.parse(json);
    return {
      controllerModel: parsed.controllerModel ?? null,
      lookSensitivity: parsed.lookSensitivity ?? 50,
      invertYAxis: parsed.invertYAxis ?? false,
      vibration: parsed.vibration ?? true,
    };
  } catch {
    return DEFAULT_CONTROLLER_SETTINGS;
  }
}

/**
 * プリセット未作成時に、デバイス・ゲーム内設定が編集できない旨を案内する。
 * 入力方法（users.inputMethod・プリセット非依存）はプリセットが無くても変更・保存できる。
 */
function PresetRequiredNotice() {
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="flex flex-wrap items-center gap-1">
        <span>{t("meDevices.presetRequiredNotice")}</span>
        <Link to="/me/presets" className="underline underline-offset-2">
          {t("meDevices.presetRequiredLink")}
        </Link>
      </AlertDescription>
    </Alert>
  );
}

export default function DevicesPage() {
  const { config, inputMethod, activePreset, hasPresets, presets } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);

  const isSubmitting = fetcher.state === "submitting";
  const data = fetcher.data;

  // コントローラー設定の初期値
  // loaderデータからフォーム値を構築するヘルパー
  const buildFormValues = useCallback(() => {
    const ics = parseControllerSettings(config?.controllerSettings);
    return {
      inputMethod: inputMethod ?? "",
      keyboardLayout: config?.keyboardLayout ?? "",
      keyboardModel: config?.keyboardModel ?? "",
      mouseModel: config?.mouseModel ?? "",
      mouseDpi: config?.mouseDpi?.toString() ?? "",
      gameSensitivity: config?.gameSensitivity?.toString() ?? "",
      gameSensitivityPercent: config?.gameSensitivity != null ? Math.round(config.gameSensitivity * 200).toString() : "",
      windowsSpeed: config?.windowsSpeed?.toString() ?? "",
      windowsSpeedMultiplier: config?.windowsSpeedMultiplier?.toString() ?? "",
      toggleSprint: config?.toggleSprint ?? false,
      toggleSneak: config?.toggleSneak ?? false,
      autoJump: config?.autoJump ?? false,
      rawInput: config?.rawInput ?? true,
      mouseAcceleration: config?.mouseAcceleration ?? false,
      gameLanguage: config?.gameLanguage ?? "",
      fov: config?.fov?.toString() ?? "",
      guiScale: config?.guiScale?.toString() ?? "",
      notes: config?.notes ?? "",
      // コントローラー設定
      controllerModel: ics.controllerModel ?? "",
      lookSensitivity: ics.lookSensitivity?.toString() ?? "50",
      invertYAxis: ics.invertYAxis ?? false,
      vibration: ics.vibration ?? true,
    };
  }, [config, inputMethod]);

  // フォームの値をトラッキング
  const [formValues, setFormValues] = useState(buildFormValues);

  const initialFormValues = useRef(formValues);

  // loaderデータが変わったらフォーム値と基準値を再同期（プリセット切替時など）
  useEffect(() => {
    const next = buildFormValues();
    setFormValues(next);
    initialFormValues.current = next;
  }, [buildFormValues]);

  // コピー元プリセット選択ダイアログ
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);

  // 変更チェック
  const hasChanges = JSON.stringify(formValues) !== JSON.stringify(initialFormValues.current);

  // 入力変更ハンドラ
  const handleChange = useCallback(<K extends keyof typeof formValues>(field: K, value: typeof formValues[K]) => {
    setFormValues((prev) => {
      const newValues = { ...prev, [field]: value };

      // 感度の相互変換
      if (field === "gameSensitivity" && typeof value === "string") {
        const numVal = parseFloat(value);
        if (!isNaN(numVal)) {
          newValues.gameSensitivityPercent = Math.round(numVal * 200).toString();
        } else if (value === "") {
          newValues.gameSensitivityPercent = "";
        }
      } else if (field === "gameSensitivityPercent" && typeof value === "string") {
        const numVal = parseInt(value);
        if (!isNaN(numVal)) {
          newValues.gameSensitivity = (numVal / 200).toFixed(4);
        } else if (value === "") {
          newValues.gameSensitivity = "";
        }
      }

      return newValues;
    });
  }, []);

  // フォームリセット
  const handleReset = useCallback(() => {
    setFormValues(initialFormValues.current);
  }, []);

  // 保存処理
  const handleSave = useCallback(() => {
    const formData = new FormData();

    // プリセット未作成時は入力方法（プリセット非依存）のみ保存できる
    if (!hasPresets) {
      formData.set("_action", "saveInputMethod");
      formData.set("inputMethod", formValues.inputMethod);
      fetcher.submit(formData, { method: "post" });
      return;
    }

    if (activePreset) {
      formData.set("presetId", activePreset.id);
    }
    formData.set("inputMethod", formValues.inputMethod);
    formData.set("keyboardLayout", formValues.keyboardLayout);
    formData.set("keyboardModel", formValues.keyboardModel);
    formData.set("mouseModel", formValues.mouseModel);
    formData.set("mouseDpi", formValues.mouseDpi);
    formData.set("gameSensitivity", formValues.gameSensitivity);
    formData.set("windowsSpeed", formValues.windowsSpeed);
    formData.set("windowsSpeedMultiplier", formValues.windowsSpeedMultiplier);
    formData.set("toggleSprint", formValues.toggleSprint ? "true" : "false");
    formData.set("toggleSneak", formValues.toggleSneak ? "true" : "false");
    formData.set("autoJump", formValues.autoJump ? "true" : "false");
    formData.set("rawInput", formValues.rawInput ? "true" : "false");
    formData.set("mouseAcceleration", formValues.mouseAcceleration ? "true" : "false");
    formData.set("gameLanguage", formValues.gameLanguage);
    formData.set("fov", formValues.fov);
    formData.set("guiScale", formValues.guiScale);
    formData.set("notes", formValues.notes);
    // コントローラー設定をJSON形式で保存
    formData.set("controllerSettings", JSON.stringify({
      controllerModel: formValues.controllerModel || null,
      lookSensitivity: formValues.lookSensitivity ? parseInt(formValues.lookSensitivity) : 50,
      invertYAxis: formValues.invertYAxis,
      vibration: formValues.vibration,
    }));
    fetcher.submit(formData, { method: "post" });
  }, [fetcher, formValues, activePreset, hasPresets]);

  // プリセットからコピー
  const handleCopyFromPreset = useCallback((presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || !preset.playerConfigData) {
      toast.error(t("meDevices.copyNoData"));
      return;
    }

    try {
      const configData = JSON.parse(preset.playerConfigData) as {
        keyboardLayout?: string;
        keyboardModel?: string;
        mouseModel?: string;
        mouseDpi?: number;
        gameSensitivity?: number;
        windowsSpeed?: number;
        windowsSpeedMultiplier?: number;
        toggleSprint?: boolean;
        toggleSneak?: boolean;
        autoJump?: boolean;
        rawInput?: boolean;
        mouseAcceleration?: boolean;
        gameLanguage?: string;
        fov?: number;
        guiScale?: number;
        notes?: string;
      };

      setFormValues((prev) => ({
        ...prev,
        keyboardLayout: configData.keyboardLayout ?? "",
        keyboardModel: configData.keyboardModel ?? "",
        mouseModel: configData.mouseModel ?? "",
        mouseDpi: configData.mouseDpi?.toString() ?? "",
        gameSensitivity: configData.gameSensitivity?.toString() ?? "",
        gameSensitivityPercent: configData.gameSensitivity != null ? Math.round(configData.gameSensitivity * 200).toString() : "",
        windowsSpeed: configData.windowsSpeed?.toString() ?? "",
        windowsSpeedMultiplier: configData.windowsSpeedMultiplier?.toString() ?? "",
        toggleSprint: configData.toggleSprint ?? false,
        toggleSneak: configData.toggleSneak ?? false,
        autoJump: configData.autoJump ?? false,
        rawInput: configData.rawInput ?? true,
        mouseAcceleration: configData.mouseAcceleration ?? false,
        gameLanguage: configData.gameLanguage ?? "",
        fov: configData.fov?.toString() ?? "",
        guiScale: configData.guiScale?.toString() ?? "",
        notes: configData.notes ?? "",
      }));

      toast.success(t("meDevices.copiedFromPreset", { name: preset.name }));
    } catch (e) {
      console.error("Failed to parse player config data:", e);
      toast.error(t("meDevices.parseFailed"));
    }

    setCopyDialogOpen(false);
  }, [presets]);

  // トースト通知を表示
  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(t("meDevices.saveSuccess"));
      initialFormValues.current = { ...formValues };
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [data, formValues]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("meDevices.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("meDevices.pageDescription")}</p>
      </div>

      {/* プリセットセレクター */}
      <PresetSelector
        presets={presets.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive }))}
        activePresetId={activePreset?.id ?? null}
        hasChanges={hasChanges}
        onCopyFromOther={presets.length > 1 ? () => setCopyDialogOpen(true) : undefined}
      />

      {/* 入力方法セレクター */}
      <Card>
        <CardHeader>
          <CardTitle>{t("meDevices.inputMethod")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <p className="text-sm text-muted-foreground sm:flex-1">{t("meDevices.inputMethodDescription")}</p>
            <Select
              value={formValues.inputMethod}
              onValueChange={(value) => handleChange("inputMethod", value)}
            >
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder={t("meDevices.selectPlease")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyboard_mouse">
                  <span className="flex items-center gap-2">
                    <Keyboard className="h-4 w-4" />
                    {t("meDevices.keyboardMouse")}
                  </span>
                </SelectItem>
                <SelectItem value="controller">
                  <span className="flex items-center gap-2">
                    <Gamepad2 className="h-4 w-4" />
                    {t("meDevices.controller")}
                  </span>
                </SelectItem>
                <SelectItem value="touch">
                  <span className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4" />
                    {t("meDevices.touch")}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* プリセット未作成時の案内（リンクを押せるようゲート外に置く） */}
      {!hasPresets && <PresetRequiredNotice />}

      <div className="space-y-6" style={{ pointerEvents: hasPresets ? "auto" : "none", opacity: hasPresets ? 1 : 0.5 }}>
        {/* コントローラー設定（inputMethod === "controller" の場合） */}
        {formValues.inputMethod === "controller" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gamepad2 className="h-5 w-5" />
                {t("meDevices.controller")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="controllerModel">{t("meDevices.model")}</Label>
                  <Input
                    id="controllerModel"
                    value={formValues.controllerModel}
                    onChange={(e) => handleChange("controllerModel", e.target.value)}
                    placeholder={t("meDevices.modelExampleController")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lookSensitivity">{t("meDevices.lookSensitivity")}</Label>
                  <Input
                    id="lookSensitivity"
                    type="number"
                    min="0"
                    max="100"
                    value={formValues.lookSensitivity}
                    onChange={(e) => handleChange("lookSensitivity", e.target.value)}
                    placeholder="50"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-6 pt-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="invertYAxis"
                    checked={formValues.invertYAxis}
                    onCheckedChange={(checked) => handleChange("invertYAxis", checked)}
                  />
                  <Label htmlFor="invertYAxis">{t("meDevices.invertYAxis")}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="vibration"
                    checked={formValues.vibration}
                    onCheckedChange={(checked) => handleChange("vibration", checked)}
                  />
                  <Label htmlFor="vibration">{t("meDevices.vibration")}</Label>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* キーボード/マウス設定（inputMethod !== "controller" の場合） */}
        {formValues.inputMethod !== "controller" && (
          <>
        {/* Keyboard */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              {t("meDevices.keyboard")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="keyboardModel">{t("meDevices.model")}</Label>
                <Input
                  id="keyboardModel"
                  value={formValues.keyboardModel}
                  onChange={(e) => handleChange("keyboardModel", e.target.value)}
                  placeholder={t("meDevices.modelExampleKeyboard")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="keyboardLayout">{t("meDevices.layout")}</Label>
                <Select
                  value={formValues.keyboardLayout}
                  onValueChange={(value) => handleChange("keyboardLayout", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("meDevices.chooseLayout")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">US</SelectItem>
                    <SelectItem value="JIS">JIS</SelectItem>
                    <SelectItem value="US_TKL">US TKL</SelectItem>
                    <SelectItem value="JIS_TKL">JIS TKL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Mouse */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mouse className="h-5 w-5" />
              {t("meDevices.mouse")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mouseModel">{t("meDevices.model")}</Label>
                <Input
                  id="mouseModel"
                  value={formValues.mouseModel}
                  onChange={(e) => handleChange("mouseModel", e.target.value)}
                  placeholder={t("meDevices.modelExampleMouse")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mouseDpi">DPI</Label>
                <Input
                  id="mouseDpi"
                  type="number"
                  value={formValues.mouseDpi}
                  onChange={(e) => handleChange("mouseDpi", e.target.value)}
                  placeholder={t("meDevices.dpiExample")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gameSensitivity">{t("meDevices.inGameSensitivity")}</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      id="gameSensitivity"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={formValues.gameSensitivity}
                      onChange={(e) => handleChange("gameSensitivity", e.target.value)}
                      placeholder="0.50"
                    />
                    <p className="text-xs text-muted-foreground mt-1">0.0~1.0</p>
                  </div>
                  <div className="flex-1">
                    <div className="relative">
                      <Input
                        id="gameSensitivityPercent"
                        type="number"
                        step="1"
                        min="0"
                        max="200"
                        value={formValues.gameSensitivityPercent}
                        onChange={(e) => handleChange("gameSensitivityPercent", e.target.value)}
                        placeholder="100"
                        className="pr-8"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">0~200%</p>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="windowsSpeed">{t("meDevices.windowsPointerSpeed")}</Label>
                <Select
                  value={formValues.windowsSpeed}
                  onValueChange={(value) => handleChange("windowsSpeed", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("meDevices.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((n) => (
                      <SelectItem key={n} value={n.toString()}>
                        {n}/20 {n === 11 && t("meDevices.defaultSuffix")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="windowsSpeedMultiplier">{t("meDevices.customMultiplier")}</Label>
                <Input
                  id="windowsSpeedMultiplier"
                  type="number"
                  step="0.001"
                  min="0"
                  value={formValues.windowsSpeedMultiplier}
                  onChange={(e) => handleChange("windowsSpeedMultiplier", e.target.value)}
                  placeholder={t("meDevices.customMultiplierPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("meDevices.customMultiplierHint")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-6 pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="rawInput"
                  checked={formValues.rawInput}
                  onCheckedChange={(checked) => handleChange("rawInput", checked)}
                />
                <Label htmlFor="rawInput">Raw Input</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="mouseAcceleration"
                  checked={formValues.mouseAcceleration}
                  onCheckedChange={(checked) => handleChange("mouseAcceleration", checked)}
                />
                <Label htmlFor="mouseAcceleration">{t("meDevices.mouseAcceleration")}</Label>
              </div>
            </div>
          </CardContent>
        </Card>
          </>
        )}

        {/* In-Game Settings */}
        <Card>
          <CardHeader>
            <CardTitle>{t("meDevices.gameSettings")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="toggleSprint"
                  checked={formValues.toggleSprint}
                  onCheckedChange={(checked) => handleChange("toggleSprint", checked)}
                />
                <Label htmlFor="toggleSprint">{t("meDevices.toggleSprint")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="toggleSneak"
                  checked={formValues.toggleSneak}
                  onCheckedChange={(checked) => handleChange("toggleSneak", checked)}
                />
                <Label htmlFor="toggleSneak">{t("meDevices.toggleSneak")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="autoJump"
                  checked={formValues.autoJump}
                  onCheckedChange={(checked) => handleChange("autoJump", checked)}
                />
                <Label htmlFor="autoJump">{t("meDevices.autoJump")}</Label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gameLanguage">{t("meDevices.gameLanguage")}</Label>
                <Combobox
                  options={GAME_LANGUAGE_OPTIONS}
                  value={formValues.gameLanguage}
                  onValueChange={(value) => handleChange("gameLanguage", value)}
                  placeholder={t("meDevices.chooseLanguage")}
                  searchPlaceholder={t("meDevices.search")}
                  emptyText={t("meDevices.notFound")}
                  allowCustomValue={true}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fov">FOV</Label>
                <Input
                  id="fov"
                  type="number"
                  min="30"
                  max="110"
                  value={formValues.fov}
                  onChange={(e) => handleChange("fov", e.target.value)}
                  placeholder={t("meDevices.fovExample")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guiScale">{t("meDevices.guiScale")}</Label>
                <Input
                  id="guiScale"
                  type="number"
                  min="0"
                  max="4"
                  value={formValues.guiScale}
                  onChange={(e) => handleChange("guiScale", e.target.value)}
                  placeholder={t("meDevices.guiScaleExample")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">{t("meDevices.notes")}</Label>
              <Textarea
                id="notes"
                value={formValues.notes}
                onChange={(e) => handleChange("notes", e.target.value)}
                placeholder={t("meDevices.notesPlaceholder")}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Floating Save Bar（プリセット未作成時でも入力方法の保存/取消ができるようゲート外に置く） */}
      <FloatingSaveBar
        hasChanges={hasChanges}
        isSubmitting={isSubmitting}
        onSave={handleSave}
        onReset={handleReset}
      />

      {/* プリセットからコピーダイアログ */}
      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("meDevices.copyDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("meDevices.copyDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {presets
                .filter((p) => p.id !== activePreset?.id)
                .map((preset) => (
                  <Button
                    key={preset.id}
                    variant="outline"
                    className="w-full justify-start h-auto py-3"
                    disabled={!preset.hasDeviceConfig}
                    onClick={() => handleCopyFromPreset(preset.id)}
                  >
                    <div className="flex flex-col items-start gap-1">
                      <span className="font-medium">{preset.name}</span>
                      <div className="flex gap-1 flex-wrap">
                        {preset.hasDeviceConfig ? (
                          <>
                            <Badge variant="secondary" className="text-xs">
                              <Keyboard className="h-3 w-3 mr-1" />
                              {t("meDevices.keyboard")}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              <Mouse className="h-3 w-3 mr-1" />
                              {t("meDevices.mouse")}
                            </Badge>
                          </>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {t("meDevices.noData")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Button>
                ))}
              {presets.filter((p) => p.id !== activePreset?.id).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("meDevices.noOtherPresets")}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>
              {t("meDevices.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Card>
        <CardContent className="p-6">
          <div className="text-center space-y-4">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
            <h2 className="text-2xl font-bold">{t("meDevices.errorTitle")}</h2>
            <p className="text-muted-foreground">
              {t("meDevices.errorDescription")}
            </p>
            <Button onClick={() => window.location.reload()}>
              {t("meDevices.reloadPage")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
