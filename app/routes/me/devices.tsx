import { createTranslator, type MessageKey } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import type { Route } from "./+types/devices";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, playerConfigs, configPresets } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { cn } from "@/lib/utils";
import { NoticeBanner } from "@/components/notice-banner";
import { PageSection } from "@/components/page-section";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Keyboard,
  Mouse,
  Gamepad2,
  AlertCircle,
  Smartphone,
} from "lucide-react";
import {
  type ControllerSettings,
  DEFAULT_CONTROLLER_SETTINGS,
  KEYBOARD_LAYOUT_OPTIONS,
} from "@/lib/keybindings";
import {
  fromSensitivityPercent,
  parseMouseSettingsInput,
  toSensitivityPercent,
  validateMouseSettings,
  type MouseSettingsField,
} from "@/lib/mouse-settings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useT, useLocale } from "@/hooks/use-locale";
import { jsonEqual } from "@/lib/loader-synced-draft";
import { useLoaderSyncedDraft, successfulSaveToken } from "@/hooks/use-loader-synced-draft";
import { gameLanguageOptions, normalizeGameLanguage } from "@/lib/game-languages";
import { SAVE_LIMITS, formString, isValidFov, isValidGuiScale } from "@/lib/save-limits";
import { syncActivePresetSnapshot, assertPresetIsActive, PresetMismatchError } from "@/lib/preset-utils";
import { configHistory } from "@/lib/schema";
import { resolveActivePublicPresetId } from "@/lib/config-history";
import { encodeHistoryDescription } from "@/lib/history-description";
import { createId } from "@paralleldrive/cuid2";
import { PresetSelector } from "@/components/preset-selector";
import { PresetSwitchLock } from "@/components/preset-switch-lock";
import { MeErrorBoundary } from "@/components/me/me-error-boundary";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
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
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      playerConfig: true,
      configPresets: {
        columns: {
          id: true,
          name: true,
          isActive: true,
          isMain: true,
          playerConfigData: true,
        },
      },
    },
  });

  if (!user) {
    throw new Response(t("meDevices.userNotFound"), { status: 404 });
  }

  // 全プリセットを取得（コピー機能用）
  const allPresets = user.configPresets;

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
      isMain: p.isMain,
      hasDeviceConfig: !!p.playerConfigData,
      playerConfigData: p.playerConfigData,
    })),
  };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  return (
    <div className="space-y-7 sm:space-y-8 animate-in fade-in duration-200" aria-hidden="true">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-5 w-56" />
        </div>
        <Skeleton className="h-9 w-20" />
      </div>

      {/* 欄（上罫線＋見出し＋中身） */}
      <div className="space-y-4 border-t border-foreground/15 pt-6">
        <Skeleton className="h-7 w-32" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
      <div className="space-y-4 border-t border-foreground/15 pt-6">
        <Skeleton className="h-7 w-24" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
      <div className="space-y-4 border-t border-foreground/15 pt-6">
        <Skeleton className="h-7 w-40" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </div>
    </div>
  );
}

export async function action({ request }: Route.ActionArgs) {
  const t = createTranslator(resolveLocale(request));
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
  const presetId = formString(formData, "presetId") || null;

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
  // 入力方法（users.inputMethod）の編集は /me/playstyle に一本化した（ここでは受け付けない）。
  const activePresetRow = await db.query.configPresets.findFirst({
    where: and(eq(configPresets.userId, user.id), eq(configPresets.isActive, true)),
    columns: { id: true },
  });
  if (!activePresetRow) {
    return { error: t("meDevices.presetRequired") };
  }

  // マウス設定の範囲チェック（フォーム外からの POST でも異常値が DB に入らないようにする）。
  // NaN（"abc" のパース結果など）は各バリデーションがいずれも false になり拒否される。
  const mouseDpiStr = formString(formData, "mouseDpi");
  const gameSensitivityStr = formString(formData, "gameSensitivity");
  const windowsSpeedStr = formString(formData, "windowsSpeed");
  const windowsSpeedMultiplierStr = formString(formData, "windowsSpeedMultiplier");

  const parsed = parseMouseSettingsInput({
    mouseDpi: mouseDpiStr ?? "",
    gameSensitivity: gameSensitivityStr ?? "",
    windowsSpeed: windowsSpeedStr ?? "",
    windowsSpeedMultiplier: windowsSpeedMultiplierStr ?? "",
  });
  const { mouseDpi, gameSensitivity, windowsSpeed, windowsSpeedMultiplier } = parsed;

  // エラーはどの欄が弾かれたかを field で返す（クライアントが該当欄を強調・スクロールする）
  const validationError = validateMouseSettings(parsed);
  if (validationError) {
    return { error: t(validationError.messageKey), field: validationError.field };
  }

  // fov / guiScale の範囲チェック。
  // parseInt は "70.9" や "70abc" を先頭だけ読んで 70 として黙って受理してしまい、
  // 「整数で入力してください」というメッセージと矛盾するため Number() + Number.isInteger で検証する
  // （NaN は isInteger が false を返すため個別の Number.isFinite チェックは不要）。
  // （/me/import の Minecraft 設定取り込みと同じ検証関数 isValidFov / isValidGuiScale を使う）
  const fovStr = formString(formData, "fov");
  const guiScaleStr = formString(formData, "guiScale");
  const fov = fovStr ? Number(fovStr) : null;
  const guiScale = guiScaleStr ? Number(guiScaleStr) : null;
  if (fov !== null && !isValidFov(fov)) {
    return { error: t("meDevices.fovInvalid"), field: "fov" };
  }
  if (guiScale !== null && !isValidGuiScale(guiScale)) {
    return { error: t("meDevices.guiScaleInvalid"), field: "guiScale" };
  }

  // keyboardLayout: DBの text({enum}) は CHECK 制約を作らないため、action 側で allowlist
  // （@/lib/keybindings の KEYBOARD_LAYOUT_OPTIONS）検証する。
  // 不正値（allowlist 外）は null 上書きにせず configData から除外し、DB の既存値を保持する。
  // 有効値・明示的な未設定（空文字→null）は従来どおり書き込む。
  const keyboardLayoutRaw = formString(formData, "keyboardLayout") || null;
  const keyboardLayoutIsValid =
    keyboardLayoutRaw === null ||
    (KEYBOARD_LAYOUT_OPTIONS as readonly string[]).includes(keyboardLayoutRaw);
  const keyboardLayout = keyboardLayoutIsValid
    ? (keyboardLayoutRaw as (typeof KEYBOARD_LAYOUT_OPTIONS)[number] | null)
    : null;
  const keyboardModel = formString(formData, "keyboardModel")?.trim() || null;
  const mouseModel = formString(formData, "mouseModel")?.trim() || null;
  const toggleSprint = formData.get("toggleSprint") === "true";
  const toggleSneak = formData.get("toggleSneak") === "true";
  const autoJump = formData.get("autoJump") === "true";
  const rawInput = formData.get("rawInput") === "true";
  const mouseAcceleration = formData.get("mouseAcceleration") === "true";
  const notes = formString(formData, "notes")?.trim() || null;

  // 長さの上限（超過は何も書かずにエラー）
  if (
    (keyboardModel?.length ?? 0) > SAVE_LIMITS.keyboardModel ||
    (mouseModel?.length ?? 0) > SAVE_LIMITS.mouseModel ||
    (notes?.length ?? 0) > SAVE_LIMITS.deviceNotes
  ) {
    return { error: t("meDevices.limitExceeded") };
  }

  // ゲーム言語は許可リスト（game-languages の単一情報源）で検証する。小文字に正規化して保存する。
  // 保存済みの値と同一なら通す（import や旧データ由来で許可リスト外の値を持つ人が、以後ほかの欄を保存できなくなるのを避ける）。
  // 空は「未設定」。許可リスト外の新しい値はエラー（null で上書きしない）
  const gameLanguageRaw = formString(formData, "gameLanguage")?.trim() || null;
  let gameLanguage: string | null = null;
  if (gameLanguageRaw !== null) {
    const normalized = normalizeGameLanguage(gameLanguageRaw);
    if (normalized !== null) {
      gameLanguage = normalized;
    } else if (gameLanguageRaw === user.playerConfig?.gameLanguage) {
      gameLanguage = gameLanguageRaw;
    } else {
      return { error: t("meDevices.gameLanguageInvalid") };
    }
  }

  // コントローラー設定（JSON文字列としてそのまま保存する）。
  // JSON.parse が通るだけでなくオブジェクト（配列・null を除く）であることまで検証し、
  // "123" や "\"x\"" のような非オブジェクト JSON を弾く。
  // 不正時は null 上書きにせず configData から除外し、DB の既存値を保持する（keyboardLayout と同方針）。
  const controllerSettingsJson = formString(formData, "controllerSettings");
  let controllerSettingsIsValid = true;
  let controllerSettings: string | null = null;
  if (controllerSettingsJson) {
    if (controllerSettingsJson.length > SAVE_LIMITS.shortText * 2) {
      return { error: t("meDevices.limitExceeded") };
    }
    try {
      const parsed = JSON.parse(controllerSettingsJson);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const model = parsed.controllerModel;
        if (typeof model === "string" && model.length > SAVE_LIMITS.controllerModel) {
          return { error: t("meDevices.limitExceeded") };
        }
        // 既知の4フィールドだけを再シリアライズする（未知のキーは保存しない）。
        // 型が合わない場合は保存せず既存値を保持する
        const lookSensitivity = parsed.lookSensitivity;
        if (
          (model === null || model === undefined || typeof model === "string") &&
          (lookSensitivity === null || lookSensitivity === undefined || typeof lookSensitivity === "number") &&
          (parsed.invertYAxis === undefined || typeof parsed.invertYAxis === "boolean") &&
          (parsed.vibration === undefined || typeof parsed.vibration === "boolean")
        ) {
          controllerSettings = JSON.stringify({
            controllerModel: model ?? null,
            lookSensitivity: lookSensitivity ?? null,
            invertYAxis: parsed.invertYAxis ?? false,
            vibration: parsed.vibration ?? true,
          });
        } else {
          controllerSettingsIsValid = false;
        }
      } else {
        controllerSettingsIsValid = false;
      }
    } catch {
      controllerSettingsIsValid = false;
    }
  }

  const configData: Partial<typeof playerConfigs.$inferInsert> = {
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
    updatedAt: new Date(),
  };
  if (keyboardLayoutIsValid) {
    configData.keyboardLayout = keyboardLayout;
  }
  if (controllerSettingsIsValid) {
    configData.controllerSettings = controllerSettings;
  }

  // 設定の更新と変更履歴の記録は 1 トランザクションにする（片方だけ残らない）。
  // スナップショット同期はトランザクションの外（docs/presets.md の既知の制限）
  await db.transaction(async (tx) => {
    // upsert: ライブの playerConfig 行が無い場合は insert する
    // （update のみだと保存が無言で失われ、直後の sync がスナップショットを null で上書きする）
    if (user.playerConfig) {
      await tx
        .update(playerConfigs)
        .set(configData)
        .where(eq(playerConfigs.id, user.playerConfig.id));
    } else {
      await tx.insert(playerConfigs).values({
        id: createId(),
        userId: user.id,
        ...configData,
        createdAt: new Date(),
      });
    }

    // 変更履歴を記録
    await tx.insert(configHistory).values({
      id: createId(),
      userId: user.id,
      changeType: "device",
      changeDescription: encodeHistoryDescription("devices.update"),
      presetId: await resolveActivePublicPresetId(tx, user.id),
      createdAt: new Date(),
    });
  });

  // アクティブプリセットスナップショット同期
  await syncActivePresetSnapshot(db, user.id, ["playerConfig", "fingers"]);

  return { success: true };
}

/** 欄の下にエラーを出す欄（マウス設定の4欄＋ゲーム内設定の FOV・GUI スケール） */
type DevicesField = MouseSettingsField | "fov" | "guiScale";
type FieldErrorState = { field: DevicesField; message: string };

/** 保存時に最初の欄へ案内するための、画面上の並び順（上から） */
const DEVICES_FIELD_ORDER: readonly DevicesField[] = [
  "mouseDpi",
  "gameSensitivity",
  "windowsSpeed",
  "windowsSpeedMultiplier",
  "fov",
  "guiScale",
];

/**
 * action が返す field は他の欄も含みうるため、
 * インライン表示・スクロール対象（fieldRefs で ref を持つ欄）だけに絞り込む。
 */
function isDevicesField(field: string): field is DevicesField {
  return (DEVICES_FIELD_ORDER as readonly string[]).includes(field);
}

type DevicesFieldValues = Record<MouseSettingsField | "fov" | "guiScale", string>;

/**
 * 1欄だけを保存時（action）と同じ規則で検証し、エラーの翻訳キーを返す（問題なければ null）。
 * マウス設定は他の欄を空扱いにして validateMouseSettings に通す（その欄のエラーだけが出る）。
 * FOV・GUI スケールは action と同じ Number() + isValidFov / isValidGuiScale
 */
function validateDevicesField(field: DevicesField, values: DevicesFieldValues): MessageKey | null {
  if (field === "fov" || field === "guiScale") {
    const raw = values[field];
    if (!raw) return null;
    const n = Number(raw);
    if (field === "fov") return isValidFov(n) ? null : "meDevices.fovInvalid";
    return isValidGuiScale(n) ? null : "meDevices.guiScaleInvalid";
  }
  const parsed = parseMouseSettingsInput({
    mouseDpi: "",
    gameSensitivity: "",
    windowsSpeed: "",
    windowsSpeedMultiplier: "",
    [field]: values[field],
  });
  return validateMouseSettings(parsed)?.messageKey ?? null;
}

/** 入力欄の直下に出すインラインエラー（aria-describedby から参照する） */
function FieldErrorText({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  );
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
 * 入力方法（users.inputMethod・プリセット非依存）は /me/playstyle で編集する（この画面は表示とリンクだけ）。
 */
function PresetRequiredNotice() {
  const t = useT();
  return (
    <NoticeBanner tone="info" icon={AlertCircle}>
      <span className="flex flex-wrap items-center gap-1">
        <span>{t("meDevices.presetRequiredNotice")}</span>
        <Link to="/me/presets" className="underline underline-offset-2">
          {t("meDevices.presetRequiredLink")}
        </Link>
      </span>
    </NoticeBanner>
  );
}

export default function DevicesPage() {
  const t = useT();
  const locale = useLocale();
  const { config, inputMethod, activePreset, hasPresets, presets } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);

  // 保存後の loader 再取得（loading）が終わるまでを保存中に含める。終わった時点で下書きの基準値が保存値へ進むので、
  // 保存バーの「未保存」がちらつかず、離脱確認の「保存して移動」も再取得の完了を待ってから判定できる
  const isSubmitting = fetcher.state !== "idle";
  const data = fetcher.data;

  // コントローラー設定の初期値
  // loaderデータからフォーム値を構築するヘルパー
  const sourceFormValues = useMemo(() => {
    const ics = parseControllerSettings(config?.controllerSettings);
    return {
      inputMethod: inputMethod ?? "",
      keyboardLayout: config?.keyboardLayout ?? "",
      keyboardModel: config?.keyboardModel ?? "",
      mouseModel: config?.mouseModel ?? "",
      mouseDpi: config?.mouseDpi?.toString() ?? "",
      gameSensitivity: config?.gameSensitivity?.toString() ?? "",
      gameSensitivityPercent: config?.gameSensitivity != null ? (toSensitivityPercent(config.gameSensitivity)?.toString() ?? "") : "",
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

  // フォームの値をトラッキング。loader の値が変わったとき（プリセット切替・保存後・タブ復帰の再検証）は、
  // 未変更の間だけ新しい値へ置き換える（入力中の編集を黙って消さない）
  const {
    draft: formValues,
    setDraft: setFormValues,
    base: initialFormValues,
  } = useLoaderSyncedDraft(sourceFormValues, {
    resetKey: activePreset?.id ?? null,
    // 成功した保存の結果。次の loader 更新では編集済みでも保存値（サーバーで正規化された値）へ揃える
    syncToken: successfulSaveToken(data),
  });

  // バリデーションエラー（クライアント側検証・action の field どちらも同じ形で扱う）
  // 欄ごとに持つ（2つの欄が範囲外なら両方に出す）
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DevicesField, string>>>({});
  const fieldRefs = useRef<Partial<Record<DevicesField, HTMLDivElement | null>>>({});
  const errorFor = (field: DevicesField) => fieldErrors[field] ?? null;

  // エラー箇所を表示して該当欄までスクロールする（コントローラー表示中など、
  // 対象欄が描画されていない場合はスクロールだけスキップする）。
  // others は同時に見つかった他の欄のエラー（スクロールは error の欄だけ）
  const showFieldError = useCallback((error: FieldErrorState, others: FieldErrorState[] = []) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const e of [error, ...others]) next[e.field] = e.message;
      return next;
    });
    requestAnimationFrame(() => {
      fieldRefs.current[error.field]?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
  }, []);

  // コピー元プリセット選択ダイアログ
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  // プリセット切替（apply-preset）中は入力欄をロックする
  const [presetSwitching, setPresetSwitching] = useState(false);

  // 変更チェック
  const hasChanges = JSON.stringify(formValues) !== JSON.stringify(initialFormValues);

  // 入力変更ハンドラ
  const handleChange = useCallback(<K extends keyof typeof formValues>(field: K, value: typeof formValues[K]) => {
    // 該当欄を編集したらインラインエラーを消す（感度は 0-1 / % のどちらの入力でも解消扱い）
    setFieldErrors((prev) => {
      const target: string = field === "gameSensitivityPercent" ? "gameSensitivity" : field;
      if (!isDevicesField(target) || prev[target] == null) return prev;
      const next = { ...prev };
      delete next[target];
      return next;
    });
    setFormValues((prev) => {
      const newValues = { ...prev, [field]: value };

      // 感度の相互変換
      if (field === "gameSensitivity" && typeof value === "string") {
        const numVal = parseFloat(value);
        if (!isNaN(numVal)) {
          newValues.gameSensitivityPercent = toSensitivityPercent(numVal)?.toString() ?? "";
        } else if (value === "") {
          newValues.gameSensitivityPercent = "";
        }
      } else if (field === "gameSensitivityPercent" && typeof value === "string") {
        const numVal = parseInt(value);
        if (!isNaN(numVal)) {
          newValues.gameSensitivity = fromSensitivityPercent(numVal);
        } else if (value === "") {
          newValues.gameSensitivity = "";
        }
      }

      return newValues;
    });
  }, []);

  // 欄から離れたとき（blur）に、その欄だけ保存時と同じ検証を走らせる。
  // - 触っていない欄（保存済みの値のまま）は検証しない（古い範囲外の値を開いただけで出さない）
  // - 他の欄を検証対象に含めない（空扱い）ので、blur した欄のエラーだけが出る
  // - エラーは欄ごとに持つ。別の欄の blur で既存のエラーは消さない
  const handleBlurValidate = useCallback(
    (field: DevicesField) => {
      const keys =
        field === "gameSensitivity"
          ? (["gameSensitivity", "gameSensitivityPercent"] as const)
          : ([field] as const);
      if (keys.every((k) => formValues[k] === initialFormValues[k])) return;
      const messageKey = validateDevicesField(field, formValues);
      setFieldErrors((prev) => {
        if (messageKey) return { ...prev, [field]: t(messageKey) };
        if (prev[field] == null) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    [formValues, initialFormValues, t],
  );

  // フォームリセット
  // 「元に戻す」の押下時点の基準値（loader の再検証で進んでいれば古い下書きを被せない）
  const latestBaseRef = useRef(initialFormValues);
  latestBaseRef.current = initialFormValues;

  const handleReset = useCallback(() => {
    const prev = formValues; // 破棄の前の下書き（フィールドエラーは再検証で出し直す）
    const baseAtReset = initialFormValues;
    setFormValues(initialFormValues);
    setFieldErrors({});
    return () => {
      if (!jsonEqual(latestBaseRef.current, baseAtReset)) return false;
      setFormValues(prev);
      return true;
    };
  }, [formValues, initialFormValues, setFormValues]);

  // 保存処理
  const handleSave = useCallback(() => {
    const formData = new FormData();

    // プリセット未作成時は保存できる項目が無い（入力方法は /me/playstyle で編集する）
    if (!hasPresets) return;

    // 範囲外の値は送信せず、その場で該当欄すべてにインライン表示する（トーストは補助）。
    // スクロールとトーストは画面上で最初の欄
    const errors: FieldErrorState[] = [];
    for (const field of DEVICES_FIELD_ORDER) {
      const messageKey = validateDevicesField(field, formValues);
      if (messageKey) errors.push({ field, message: t(messageKey) });
    }
    if (errors.length > 0) {
      const [first, ...others] = errors;
      setFieldErrors({});
      showFieldError(first, others);
      toast.error(first.message);
      return;
    }
    setFieldErrors({});

    if (activePreset) {
      formData.set("presetId", activePreset.id);
    }
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
  }, [fetcher, formValues, activePreset, hasPresets, t, showFieldError]);

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
        gameSensitivityPercent: configData.gameSensitivity != null ? (toSensitivityPercent(configData.gameSensitivity)?.toString() ?? "") : "",
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
      setFieldErrors({});
    } else if ("error" in data) {
      toast.error(data.error);
      // どの欄が弾かれたか分かるエラーはインライン表示＋該当欄へスクロール
      // （fieldRefs に ref を持たない欄はトーストのみで通知する）
      if ("field" in data && data.field && isDevicesField(data.field)) {
        showFieldError({ field: data.field, message: data.error });
      }
    }
  }, [data, showFieldError]);

  return (
    <div className="space-y-7 sm:space-y-8 pb-24">
      <div>
        <h1 className="text-2xl font-bold">{t("meDevices.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("meDevices.pageDescription")}</p>
      </div>

      {/* プリセットセレクター */}
      <PresetSelector
        presets={presets.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive, isMain: p.isMain }))}
        activePresetId={activePreset?.id ?? null}
        hasChanges={hasChanges}
        onSwitchingChange={setPresetSwitching}
        onCopyFromOther={presets.length > 1 ? () => setCopyDialogOpen(true) : undefined}
      />

      {/* 入力方法（編集は /me/playstyle。ここは今の値の表示とリンクだけ） */}
      <PageSection id="devices-input-method" title={t("meDevices.inputMethod")}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm font-medium">
            {formValues.inputMethod === "keyboard_mouse" ? (
              <Keyboard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            ) : formValues.inputMethod === "controller" ? (
              <Gamepad2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            ) : formValues.inputMethod === "touch" ? (
              <Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            ) : null}
            {formValues.inputMethod === "keyboard_mouse"
              ? t("meDevices.keyboardMouse")
              : formValues.inputMethod === "controller"
                ? t("meDevices.controller")
                : formValues.inputMethod === "touch"
                  ? t("meDevices.touch")
                  : <span className="text-muted-foreground">{t("meDevices.inputMethodUnset")}</span>}
          </p>
          <p className="text-sm text-muted-foreground">
            <Link to="/me/playstyle" className="text-primary underline underline-offset-2">
              {t("meDevices.inputMethodEditLink")}
            </Link>
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{t("meDevices.inputMethodDescription")}</p>
      </PageSection>

      {/* プリセット未作成時の案内（リンクを押せるようゲート外に置く） */}
      {!hasPresets && <PresetRequiredNotice />}

      {/* プリセット切替中はロックする */}
      <PresetSwitchLock locked={presetSwitching}>
      <div
        className={cn("space-y-7 sm:space-y-8", !hasPresets && "pointer-events-none opacity-50")}
        inert={!hasPresets}
      >
        {/* コントローラー設定（inputMethod === "controller" の場合） */}
        {formValues.inputMethod === "controller" && (
          <PageSection
            id="devices-controller"
            title={t("meDevices.controller")}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="controllerModel">{t("meDevices.model")}</Label>
                  <Input
                    id="controllerModel"
                    aria-label={t("meDevices.controllerModelAria")}
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
                    placeholder={t("meDevices.exampleValue", { value: "50" })}
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
                  <Label htmlFor="invertYAxis" className="min-h-11 flex-1 cursor-pointer sm:min-h-0">{t("meDevices.invertYAxis")}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="vibration"
                    checked={formValues.vibration}
                    onCheckedChange={(checked) => handleChange("vibration", checked)}
                  />
                  <Label htmlFor="vibration" className="min-h-11 flex-1 cursor-pointer sm:min-h-0">{t("meDevices.vibration")}</Label>
                </div>
              </div>
            </div>
          </PageSection>
        )}

        {/* キーボード/マウス設定（inputMethod !== "controller" の場合） */}
        {formValues.inputMethod !== "controller" && (
          <>
        {/* Keyboard */}
        <PageSection
          id="devices-keyboard"
          title={t("meDevices.keyboard")}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="keyboardModel">{t("meDevices.model")}</Label>
                <Input
                  id="keyboardModel"
                  aria-label={t("meDevices.keyboardModelAria")}
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
                  <SelectTrigger id="keyboardLayout" className="w-full">
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
          </div>
        </PageSection>

        {/* Mouse */}
        <PageSection
          id="devices-mouse"
          title={t("meDevices.mouse")}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mouseModel">{t("meDevices.model")}</Label>
                <Input
                  id="mouseModel"
                  aria-label={t("meDevices.mouseModelAria")}
                  value={formValues.mouseModel}
                  onChange={(e) => handleChange("mouseModel", e.target.value)}
                  placeholder={t("meDevices.modelExampleMouse")}
                />
              </div>
              <div
                className="space-y-2"
                ref={(el) => {
                  fieldRefs.current.mouseDpi = el;
                }}
              >
                <Label htmlFor="mouseDpi">DPI</Label>
                <Input
                  id="mouseDpi"
                  type="number"
                  min="1"
                  step="1"
                  value={formValues.mouseDpi}
                  onChange={(e) => handleChange("mouseDpi", e.target.value)}
                  onBlur={() => handleBlurValidate("mouseDpi")}
                  placeholder={t("meDevices.dpiExample")}
                  aria-invalid={errorFor("mouseDpi") != null || undefined}
                  aria-describedby={errorFor("mouseDpi") ? "mouseDpi-error" : undefined}
                />
                <FieldErrorText id="mouseDpi-error" message={errorFor("mouseDpi")} />
              </div>
              <div
                className="space-y-2"
                ref={(el) => {
                  fieldRefs.current.gameSensitivity = el;
                }}
              >
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
                      onBlur={() => handleBlurValidate("gameSensitivity")}
                      placeholder={t("meDevices.exampleValue", { value: "0.50" })}
                      aria-invalid={errorFor("gameSensitivity") != null || undefined}
                      aria-describedby={
                        errorFor("gameSensitivity")
                          ? "gameSensitivity-error gameSensitivity-range"
                          : "gameSensitivity-range"
                      }
                    />
                    <p id="gameSensitivity-range" className="text-xs text-muted-foreground mt-1">{t("meDevices.rangeHint", { min: "0.0", max: "1.0" })}</p>
                  </div>
                  <div className="flex-1">
                    <div className="relative">
                      <Label htmlFor="gameSensitivityPercent" className="sr-only">
                        {t("meDevices.inGameSensitivityPercent")}
                      </Label>
                      <Input
                        id="gameSensitivityPercent"
                        type="number"
                        step="1"
                        min="0"
                        max="200"
                        value={formValues.gameSensitivityPercent}
                        onChange={(e) => handleChange("gameSensitivityPercent", e.target.value)}
                        onBlur={() => handleBlurValidate("gameSensitivity")}
                        placeholder={t("meDevices.exampleValue", { value: "100" })}
                        className="pr-8"
                        aria-invalid={errorFor("gameSensitivity") != null || undefined}
                        aria-describedby={
                          errorFor("gameSensitivity")
                            ? "gameSensitivity-error gameSensitivityPercent-range"
                            : "gameSensitivityPercent-range"
                        }
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                    </div>
                    <p id="gameSensitivityPercent-range" className="text-xs text-muted-foreground mt-1">{t("meDevices.rangeHint", { min: "0", max: "200%" })}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{t("meDevices.sensitivityLinkedHint")}</p>
                <FieldErrorText
                  id="gameSensitivity-error"
                  message={errorFor("gameSensitivity")}
                />
              </div>
              <div
                className="space-y-2"
                ref={(el) => {
                  fieldRefs.current.windowsSpeed = el;
                }}
              >
                <Label htmlFor="windowsSpeed">{t("meDevices.windowsPointerSpeed")}</Label>
                <Select
                  value={formValues.windowsSpeed}
                  onValueChange={(value) => handleChange("windowsSpeed", value)}
                >
                  <SelectTrigger
                    id="windowsSpeed"
                    className="w-full"
                    aria-invalid={errorFor("windowsSpeed") != null || undefined}
                    aria-describedby={
                      errorFor("windowsSpeed") ? "windowsSpeed-error" : undefined
                    }
                  >
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
                <FieldErrorText id="windowsSpeed-error" message={errorFor("windowsSpeed")} />
              </div>
              <div
                className="space-y-2"
                ref={(el) => {
                  fieldRefs.current.windowsSpeedMultiplier = el;
                }}
              >
                <Label htmlFor="windowsSpeedMultiplier">{t("meDevices.customMultiplier")}</Label>
                <Input
                  id="windowsSpeedMultiplier"
                  type="number"
                  step="0.001"
                  min="0"
                  value={formValues.windowsSpeedMultiplier}
                  onChange={(e) => handleChange("windowsSpeedMultiplier", e.target.value)}
                  onBlur={() => handleBlurValidate("windowsSpeedMultiplier")}
                  placeholder={t("meDevices.customMultiplierPlaceholder")}
                  aria-invalid={errorFor("windowsSpeedMultiplier") != null || undefined}
                  aria-describedby={
                    errorFor("windowsSpeedMultiplier")
                      ? "windowsSpeedMultiplier-error windowsSpeedMultiplier-hint"
                      : "windowsSpeedMultiplier-hint"
                  }
                />
                <FieldErrorText
                  id="windowsSpeedMultiplier-error"
                  message={errorFor("windowsSpeedMultiplier")}
                />
                <p id="windowsSpeedMultiplier-hint" className="text-xs text-muted-foreground">
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
                <Label htmlFor="rawInput" className="min-h-11 flex-1 cursor-pointer sm:min-h-0">Raw Input</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="mouseAcceleration"
                  checked={formValues.mouseAcceleration}
                  onCheckedChange={(checked) => handleChange("mouseAcceleration", checked)}
                />
                <Label htmlFor="mouseAcceleration" className="min-h-11 flex-1 cursor-pointer sm:min-h-0">{t("meDevices.mouseAcceleration")}</Label>
              </div>
            </div>
          </div>
        </PageSection>
          </>
        )}

        {/* In-Game Settings */}
        <PageSection id="devices-game" title={t("meDevices.gameSettings")}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="toggleSprint"
                  checked={formValues.toggleSprint}
                  onCheckedChange={(checked) => handleChange("toggleSprint", checked)}
                />
                <Label htmlFor="toggleSprint" className="min-h-11 flex-1 cursor-pointer sm:min-h-0">{t("meDevices.toggleSprint")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="toggleSneak"
                  checked={formValues.toggleSneak}
                  onCheckedChange={(checked) => handleChange("toggleSneak", checked)}
                />
                <Label htmlFor="toggleSneak" className="min-h-11 flex-1 cursor-pointer sm:min-h-0">{t("meDevices.toggleSneak")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="autoJump"
                  checked={formValues.autoJump}
                  onCheckedChange={(checked) => handleChange("autoJump", checked)}
                />
                <Label htmlFor="autoJump" className="min-h-11 flex-1 cursor-pointer sm:min-h-0">{t("meDevices.autoJump")}</Label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gameLanguage">{t("meDevices.gameLanguage")}</Label>
                <Combobox
                  id="gameLanguage"
                  options={gameLanguageOptions(t, locale)}
                  value={formValues.gameLanguage}
                  onValueChange={(value) => handleChange("gameLanguage", value)}
                  placeholder={t("meDevices.chooseLanguage")}
                  searchPlaceholder={t("meDevices.search")}
                  emptyText={t("meDevices.notFound")}
                  allowCustomValue={true}
                />
              </div>
              <div
                className="space-y-2"
                ref={(el) => {
                  fieldRefs.current.fov = el;
                }}
              >
                <Label htmlFor="fov">FOV</Label>
                <Input
                  id="fov"
                  type="number"
                  min="30"
                  max="110"
                  step="1"
                  value={formValues.fov}
                  onChange={(e) => handleChange("fov", e.target.value)}
                  onBlur={() => handleBlurValidate("fov")}
                  placeholder={t("meDevices.fovExample")}
                  aria-invalid={errorFor("fov") != null || undefined}
                  aria-describedby={errorFor("fov") ? "fov-error fov-range" : "fov-range"}
                />
                {/* 範囲は action の isValidFov と同じ（save-limits.ts） */}
                <p id="fov-range" className="text-xs text-muted-foreground">{t("meDevices.rangeHint", { min: "30", max: "110" })}</p>
                <FieldErrorText id="fov-error" message={errorFor("fov")} />
              </div>
              <div
                className="space-y-2"
                ref={(el) => {
                  fieldRefs.current.guiScale = el;
                }}
              >
                <Label htmlFor="guiScale">{t("meDevices.guiScale")}</Label>
                <Input
                  id="guiScale"
                  type="number"
                  min="0"
                  max="10"
                  step="1"
                  value={formValues.guiScale}
                  onChange={(e) => handleChange("guiScale", e.target.value)}
                  onBlur={() => handleBlurValidate("guiScale")}
                  placeholder={t("meDevices.guiScaleExample")}
                  aria-invalid={errorFor("guiScale") != null || undefined}
                  aria-describedby={
                    errorFor("guiScale") ? "guiScale-error guiScale-range" : "guiScale-range"
                  }
                />
                {/* 範囲は action の isValidGuiScale と同じ（save-limits.ts） */}
                <p id="guiScale-range" className="text-xs text-muted-foreground">{t("meDevices.rangeHint", { min: "0", max: "10" })}</p>
                <FieldErrorText id="guiScale-error" message={errorFor("guiScale")} />
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
          </div>
        </PageSection>
      </div>
      </PresetSwitchLock>

      {/* Floating Save Bar（プリセット未作成時は入力欄が inert で編集できず、保存も行えないので出さない） */}
      <FloatingSaveBar
        hasChanges={hasChanges && hasPresets}
        isSubmitting={isSubmitting}
        onSave={handleSave}
        onReset={handleReset}
        saveResult={fetcher.data}
        saveSucceeded={fetcher.data != null && "success" in fetcher.data && fetcher.data.success === true}
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
  return <MeErrorBoundary />;
}
