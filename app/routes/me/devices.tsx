import { useEffect, useRef, useState, useCallback } from "react";
import { useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import type { Route } from "./+types/devices";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, playerConfigs, configPresets } from "@/lib/schema";
import { eq } from "drizzle-orm";
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

export const meta: Route.MetaFunction = () => {
  return [{ title: "デバイス - Minefolio" }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  return false;
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
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
    throw new Response("ユーザーが見つかりません", { status: 404 });
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

export async function action({ context, request }: Route.ActionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: { playerConfig: true },
  });

  if (!user) {
    return { error: "ユーザーが見つかりません" };
  }

  const formData = await request.formData();

  // 入力方法の更新
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

  if (user.playerConfig) {
    await db
      .update(playerConfigs)
      .set(configData)
      .where(eq(playerConfigs.id, user.playerConfig.id));
  }

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

export default function DevicesPage() {
  const { config, inputMethod, activePreset, hasPresets, presets } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);

  const isSubmitting = fetcher.state === "submitting";
  const data = fetcher.data;

  // Minecraft言語リスト（Combobox用）- 公式Wiki準拠
  const GAME_LANGUAGE_OPTIONS = [
    { value: "af_za", label: "Afrikaans" },
    { value: "ar_sa", label: "العربية" },
    { value: "ast_es", label: "Asturianu" },
    { value: "az_az", label: "Azərbaycanca" },
    { value: "ba_ru", label: "Башҡортса" },
    { value: "bar", label: "Boarisch" },
    { value: "be_by", label: "Беларуская" },
    { value: "bg_bg", label: "Български" },
    { value: "br_fr", label: "Brezhoneg" },
    { value: "brb", label: "Brabants" },
    { value: "bs_ba", label: "Bosanski" },
    { value: "ca_es", label: "Català" },
    { value: "cs_cz", label: "Čeština" },
    { value: "cy_gb", label: "Cymraeg" },
    { value: "da_dk", label: "Dansk" },
    { value: "de_at", label: "Österreichisches Deutsch" },
    { value: "de_ch", label: "Schwiizerdütsch" },
    { value: "de_de", label: "Deutsch" },
    { value: "el_gr", label: "Ελληνικά" },
    { value: "en_au", label: "English (Australia)" },
    { value: "en_ca", label: "English (Canada)" },
    { value: "en_gb", label: "English (UK)" },
    { value: "en_nz", label: "English (New Zealand)" },
    { value: "en_pt", label: "Pirate Speak" },
    { value: "en_ud", label: "ʇılƃuƎ (uʍop ǝpısdn)" },
    { value: "en_us", label: "English (US)" },
    { value: "enp", label: "Anglish" },
    { value: "enws", label: "Shakespearean English" },
    { value: "eo_uy", label: "Esperanto" },
    { value: "es_ar", label: "Español (Argentina)" },
    { value: "es_cl", label: "Español (Chile)" },
    { value: "es_ec", label: "Español (Ecuador)" },
    { value: "es_es", label: "Español (España)" },
    { value: "es_mx", label: "Español (México)" },
    { value: "es_uy", label: "Español (Uruguay)" },
    { value: "es_ve", label: "Español (Venezuela)" },
    { value: "esan", label: "Andaluz" },
    { value: "et_ee", label: "Eesti" },
    { value: "eu_es", label: "Euskara" },
    { value: "fa_ir", label: "فارسی" },
    { value: "fi_fi", label: "Suomi" },
    { value: "fil_ph", label: "Filipino" },
    { value: "fo_fo", label: "Føroyskt" },
    { value: "fr_ca", label: "Français (Canada)" },
    { value: "fr_fr", label: "Français" },
    { value: "fra_de", label: "Fränggisch" },
    { value: "fur_it", label: "Furlan" },
    { value: "fy_nl", label: "Frysk" },
    { value: "ga_ie", label: "Gaeilge" },
    { value: "gd_gb", label: "Gàidhlig" },
    { value: "gl_es", label: "Galego" },
    { value: "haw_us", label: "ʻŌlelo Hawaiʻi" },
    { value: "he_il", label: "עברית" },
    { value: "hi_in", label: "हिन्दी" },
    { value: "hr_hr", label: "Hrvatski" },
    { value: "hu_hu", label: "Magyar" },
    { value: "hy_am", label: "Հայdelays" },
    { value: "id_id", label: "Bahasa Indonesia" },
    { value: "ig_ng", label: "Igbo" },
    { value: "io_en", label: "Ido" },
    { value: "is_is", label: "Íslenska" },
    { value: "isv", label: "Interslavic" },
    { value: "it_it", label: "Italiano" },
    { value: "ja_jp", label: "日本語" },
    { value: "jbo_en", label: "la .lojban." },
    { value: "ka_ge", label: "ქართული" },
    { value: "kk_kz", label: "Қазақша" },
    { value: "kn_in", label: "ಕನ್ನಡ" },
    { value: "ko_kr", label: "한국어" },
    { value: "ksh", label: "Kölsch" },
    { value: "kw_gb", label: "Kernewek" },
    { value: "la_la", label: "Latina" },
    { value: "lb_lu", label: "Lëtzebuergesch" },
    { value: "li_li", label: "Limburgs" },
    { value: "lmo", label: "Lombard" },
    { value: "lo_la", label: "ລາວ" },
    { value: "lol_us", label: "LOLCAT" },
    { value: "lt_lt", label: "Lietuvių" },
    { value: "lv_lv", label: "Latviešu" },
    { value: "lzh", label: "文言" },
    { value: "mk_mk", label: "Македонски" },
    { value: "mn_mn", label: "Монгол" },
    { value: "ms_my", label: "Bahasa Melayu" },
    { value: "mt_mt", label: "Malti" },
    { value: "nah", label: "Nāhuatl" },
    { value: "nds_de", label: "Plattdüütsch" },
    { value: "nl_be", label: "Vlaams" },
    { value: "nl_nl", label: "Nederlands" },
    { value: "nn_no", label: "Norsk Nynorsk" },
    { value: "nb_no", label: "Norsk Bokmål" },
    { value: "oc_fr", label: "Occitan" },
    { value: "ovd", label: "Övdalska" },
    { value: "pl_pl", label: "Polski" },
    { value: "pt_br", label: "Português (Brasil)" },
    { value: "pt_pt", label: "Português (Portugal)" },
    { value: "qya_aa", label: "Quenya" },
    { value: "ro_ro", label: "Română" },
    { value: "rpr", label: "Русский (дореформенный)" },
    { value: "ru_ru", label: "Русский" },
    { value: "ry_ua", label: "Руси|ьскый" },
    { value: "se_no", label: "Davvisámegiella" },
    { value: "sk_sk", label: "Slovenčina" },
    { value: "sl_si", label: "Slovenščina" },
    { value: "so_so", label: "Soomaali" },
    { value: "sq_al", label: "Shqip" },
    { value: "sr_cs", label: "Srpski (latinica)" },
    { value: "sr_sp", label: "Српски" },
    { value: "sv_se", label: "Svenska" },
    { value: "sxu", label: "Säggs'sch" },
    { value: "szl", label: "Ślōnski" },
    { value: "ta_in", label: "தமிழ்" },
    { value: "th_th", label: "ไทย" },
    { value: "tl_ph", label: "Tagalog" },
    { value: "tlh_aa", label: "tlhIngan Hol" },
    { value: "tok", label: "toki pona" },
    { value: "tr_tr", label: "Türkçe" },
    { value: "tt_ru", label: "Татарча" },
    { value: "uk_ua", label: "Українська" },
    { value: "val_es", label: "Valencià" },
    { value: "vec_it", label: "Vèneto" },
    { value: "vi_vn", label: "Tiếng Việt" },
    { value: "yi_de", label: "ייִדיש" },
    { value: "yo_ng", label: "Yorùbá" },
    { value: "zh_cn", label: "简体中文" },
    { value: "zh_hk", label: "繁體中文 (香港)" },
    { value: "zh_tw", label: "繁體中文 (台灣)" },
    { value: "zlm_arab", label: "بهاس ملايو (جاوي)" },
  ];

  // コントローラー設定の初期値
  const initialControllerSettings = parseControllerSettings(config?.controllerSettings);

  // フォームの値をトラッキング
  const [formValues, setFormValues] = useState({
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
    controllerModel: initialControllerSettings.controllerModel ?? "",
    lookSensitivity: initialControllerSettings.lookSensitivity?.toString() ?? "50",
    invertYAxis: initialControllerSettings.invertYAxis ?? false,
    vibration: initialControllerSettings.vibration ?? true,
  });

  const initialFormValues = useRef({ ...formValues });

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
          newValues.gameSensitivity = (numVal / 200).toFixed(2);
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
  }, [fetcher, formValues]);

  // プリセットからコピー
  const handleCopyFromPreset = useCallback((presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || !preset.playerConfigData) {
      toast.error("コピーするデータがありません");
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

      toast.success(`${preset.name}からデバイス設定をコピーしました`);
    } catch (e) {
      console.error("Failed to parse player config data:", e);
      toast.error("データの解析に失敗しました");
    }

    setCopyDialogOpen(false);
  }, [presets]);

  // トースト通知を表示
  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success("設定を保存しました");
      initialFormValues.current = { ...formValues };
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [data, formValues]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">デバイス・設定</h1>
        <p className="text-muted-foreground">
          使用機器とゲーム内設定を管理します。
        </p>
      </div>

      {/* プリセット警告・情報 */}
      {!hasPresets && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm">
              プリセットがないため、設定を編集できません。先にプリセットを作成してください。
            </span>
            <Link to="/me/presets" className="shrink-0">
              <Button size="sm" className="w-full sm:w-auto">プリセットを作成</Button>
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {activePreset && (
        <Alert>
          <Settings className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm">
              現在編集中のプリセット: <strong>{activePreset.name}</strong>
            </span>
            <div className="flex gap-2 shrink-0">
              {presets.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => setCopyDialogOpen(true)}
                >
                  <Copy className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">他のプリセットからコピー</span>
                  <span className="sm:hidden">コピー</span>
                </Button>
              )}
              <Link to="/me/presets" className="shrink-0">
                <Button variant="outline" size="sm" className="w-full sm:w-auto">プリセット管理</Button>
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* 入力方法セレクター */}
      <Card>
        <CardHeader>
          <CardTitle>入力方法</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <p className="text-sm text-muted-foreground sm:flex-1">
              使用する入力デバイスを選択してください。選択に応じてキー配置やデバイス設定の表示が切り替わります。
            </p>
            <Select
              value={formValues.inputMethod}
              onValueChange={(value) => handleChange("inputMethod", value)}
            >
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyboard_mouse">
                  <span className="flex items-center gap-2">
                    <Keyboard className="h-4 w-4" />
                    キーボード/マウス
                  </span>
                </SelectItem>
                <SelectItem value="controller">
                  <span className="flex items-center gap-2">
                    <Gamepad2 className="h-4 w-4" />
                    コントローラー
                  </span>
                </SelectItem>
                <SelectItem value="touch">
                  <span className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4" />
                    タッチ
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6" style={{ pointerEvents: hasPresets ? "auto" : "none", opacity: hasPresets ? 1 : 0.5 }}>
        {/* コントローラー設定（inputMethod === "controller" の場合） */}
        {formValues.inputMethod === "controller" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gamepad2 className="h-5 w-5" />
                コントローラー
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="controllerModel">モデル</Label>
                  <Input
                    id="controllerModel"
                    value={formValues.controllerModel}
                    onChange={(e) => handleChange("controllerModel", e.target.value)}
                    placeholder="例: Xbox Controller"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lookSensitivity">視点感度 (0-100)</Label>
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
                  <Label htmlFor="invertYAxis">Y軸反転</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="vibration"
                    checked={formValues.vibration}
                    onCheckedChange={(checked) => handleChange("vibration", checked)}
                  />
                  <Label htmlFor="vibration">振動</Label>
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
              キーボード
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="keyboardModel">モデル</Label>
                <Input
                  id="keyboardModel"
                  value={formValues.keyboardModel}
                  onChange={(e) => handleChange("keyboardModel", e.target.value)}
                  placeholder="例: HHKB Professional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="keyboardLayout">レイアウト</Label>
                <Select
                  value={formValues.keyboardLayout}
                  onValueChange={(value) => handleChange("keyboardLayout", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="レイアウトを選択" />
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
              マウス
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mouseModel">モデル</Label>
                <Input
                  id="mouseModel"
                  value={formValues.mouseModel}
                  onChange={(e) => handleChange("mouseModel", e.target.value)}
                  placeholder="例: Logitech G Pro"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mouseDpi">DPI</Label>
                <Input
                  id="mouseDpi"
                  type="number"
                  value={formValues.mouseDpi}
                  onChange={(e) => handleChange("mouseDpi", e.target.value)}
                  placeholder="例: 800"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gameSensitivity">ゲーム内感度</Label>
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
                <Label htmlFor="windowsSpeed">Windowsポインター速度 (1-20)</Label>
                <Select
                  value={formValues.windowsSpeed}
                  onValueChange={(value) => handleChange("windowsSpeed", value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((n) => (
                      <SelectItem key={n} value={n.toString()}>
                        {n}/20 {n === 11 && "(デフォルト)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="windowsSpeedMultiplier">カスタム係数 (小数)</Label>
                <Input
                  id="windowsSpeedMultiplier"
                  type="number"
                  step="0.001"
                  min="0"
                  value={formValues.windowsSpeedMultiplier}
                  onChange={(e) => handleChange("windowsSpeedMultiplier", e.target.value)}
                  placeholder="例: 1.0（設定時はポインター速度より優先）"
                />
                <p className="text-xs text-muted-foreground">
                  設定するとWindowsポインター速度の代わりに使用されます
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
                <Label htmlFor="mouseAcceleration">マウス加速</Label>
              </div>
            </div>
          </CardContent>
        </Card>
          </>
        )}

        {/* In-Game Settings */}
        <Card>
          <CardHeader>
            <CardTitle>ゲーム内設定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="toggleSprint"
                  checked={formValues.toggleSprint}
                  onCheckedChange={(checked) => handleChange("toggleSprint", checked)}
                />
                <Label htmlFor="toggleSprint">ダッシュ切替</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="toggleSneak"
                  checked={formValues.toggleSneak}
                  onCheckedChange={(checked) => handleChange("toggleSneak", checked)}
                />
                <Label htmlFor="toggleSneak">スニーク切替</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="autoJump"
                  checked={formValues.autoJump}
                  onCheckedChange={(checked) => handleChange("autoJump", checked)}
                />
                <Label htmlFor="autoJump">自動ジャンプ</Label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gameLanguage">ゲーム言語</Label>
                <Combobox
                  options={GAME_LANGUAGE_OPTIONS}
                  value={formValues.gameLanguage}
                  onValueChange={(value) => handleChange("gameLanguage", value)}
                  placeholder="言語を選択"
                  searchPlaceholder="検索..."
                  emptyText="見つかりません"
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
                  placeholder="例: 90"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guiScale">GUIスケール</Label>
                <Input
                  id="guiScale"
                  type="number"
                  min="0"
                  max="4"
                  value={formValues.guiScale}
                  onChange={(e) => handleChange("guiScale", e.target.value)}
                  placeholder="例: 2"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">メモ</Label>
              <Textarea
                id="notes"
                value={formValues.notes}
                onChange={(e) => handleChange("notes", e.target.value)}
                placeholder="設定についての補足..."
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* Floating Save Bar */}
        <FloatingSaveBar
          hasChanges={hasChanges}
          isSubmitting={isSubmitting}
          onSave={handleSave}
          onReset={handleReset}
        />
      </div>

      {/* プリセットからコピーダイアログ */}
      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>他のプリセットからコピー</DialogTitle>
            <DialogDescription>
              コピー元のプリセットを選択してください
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
                              キーボード
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              <Mouse className="h-3 w-3 mr-1" />
                              マウス
                            </Badge>
                          </>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            データなし
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Button>
                ))}
              {presets.filter((p) => p.id !== activePreset?.id).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  他のプリセットがありません
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>
              キャンセル
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
            <h2 className="text-2xl font-bold">エラーが発生しました</h2>
            <p className="text-muted-foreground">
              ページの読み込み中にエラーが発生しました。ページをリロードしてください。
            </p>
            <Button onClick={() => window.location.reload()}>
              ページをリロード
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
