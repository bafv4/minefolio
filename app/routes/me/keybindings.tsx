import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useLoaderData, useFetcher, useRevalidator, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/keybindings";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, keybindings, playerConfigs, keyRemaps, customKeys, configHistory, configPresets, customActions } from "@/lib/schema";
import { eq, asc, and, or } from "drizzle-orm";
import { getActionLabel, getKeyLabel, normalizeKeyCode, normalizeKeyCombination, getKeyCombinationLabel, parseKeyCombination, isSingleKey, FINGER_LABELS, UNBOUND_KEY, isUnbound, type FingerType, CONTROLLER_ACTIONS, KEYBOARD_MOUSE_ACTIONS, isControllerKeyCode } from "@/lib/keybindings";
import { importFromLegacy } from "@/lib/legacy-import";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Keyboard, X, Plus, Trash2, ArrowRight, RefreshCw, Bug, Download, Save, Loader2, AlertCircle, Settings, Copy, Gamepad2 } from "lucide-react";
import { Link } from "react-router";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import { VirtualKeyboard, VirtualMouse, VirtualNumpad, FingerLegend, keybindingsToMap } from "@/components/virtual-keyboard";
import { createId } from "@paralleldrive/cuid2";
import { t } from "@/lib/messages";
import { isKeyRemapTarget } from "@/lib/remap-utils";

export const meta: Route.MetaFunction = () => {
  return [{ title: t("meKeybindings.title") }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  // actionがある場合はデフォルトの動作に従う
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  // それ以外（ナビゲーションなど）では再検証しない
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
      keybindings: {
        orderBy: [asc(keybindings.category), asc(keybindings.action)],
      },
      playerConfig: true,
      keyRemaps: true,
      customKeys: {
        orderBy: [asc(customKeys.category), asc(customKeys.keyName)],
      },
      customActions: {
        orderBy: [asc(customActions.displayOrder)],
      },
    },
  });

  if (!user) {
    throw new Response(t("meKeybindings.userNotFound"), { status: 404 });
  }

  // 全プリセットを取得（コピー機能用）
  const allPresets = await db.query.configPresets.findMany({
    where: eq(configPresets.userId, user.id),
    columns: {
      id: true,
      name: true,
      isActive: true,
      keybindingsData: true,
      remapsData: true,
      fingerAssignmentsData: true,
    },
  });

  // アクティブなプリセットを取得
  const activePreset = allPresets.find((p) => p.isActive);

  return {
    userId: user.id,
    mcid: user.mcid,
    inputMethod: user.inputMethod,
    keybindings: user.keybindings,
    playerConfig: user.playerConfig,
    keyRemaps: user.keyRemaps,
    customKeys: user.customKeys,
    customActions: user.customActions,
    legacyApiUrl: env.LEGACY_API_URL,
    activePreset: activePreset ? { id: activePreset.id, name: activePreset.name } : null,
    hasPresets: allPresets.length > 0,
    presets: allPresets.map((p) => ({
      id: p.id,
      name: p.name,
      isActive: p.isActive,
      hasKeybindings: !!p.keybindingsData,
      hasRemaps: !!p.remapsData,
      hasFingerAssignments: !!p.fingerAssignmentsData,
      keybindingsData: p.keybindingsData,
      remapsData: p.remapsData,
      fingerAssignmentsData: p.fingerAssignmentsData,
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
          <div className="h-8 w-32 bg-muted rounded animate-pulse" />
          <div className="h-5 w-64 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 bg-muted rounded animate-pulse" />
          <div className="h-9 w-24 bg-muted rounded animate-pulse" />
        </div>
      </div>

      {/* Virtual Keyboard Card */}
      <div className="border rounded-lg p-6 space-y-4">
        <div className="h-6 w-40 bg-muted rounded animate-pulse" />
        <div className="h-80 w-full bg-muted rounded-lg animate-pulse" />
      </div>

      {/* Tabs */}
      <div className="h-10 w-96 bg-muted rounded animate-pulse" />

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-48 bg-muted rounded-lg animate-pulse" />
        <div className="h-48 bg-muted rounded-lg animate-pulse" />
        <div className="h-48 bg-muted rounded-lg animate-pulse" />
        <div className="h-48 bg-muted rounded-lg animate-pulse" />
      </div>
    </div>
  );
}

type RemapMutationInput = {
  id?: string;
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
  _delete?: boolean;
};

type KeybindingUpdateInput = { id: string; keyCode: string };
type RemapType = "none" | "keyboard" | "special" | "disabled";
type PersistedRemapPayload = {
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
};

function getRemapTypeFromTargetKey(targetKey: string | null | undefined): RemapType {
  if (targetKey == null || targetKey === "") return "disabled";
  return isKeyRemapTarget(targetKey) ? "keyboard" : "special";
}

function sanitizeRemapTargetKey(targetKey: string | null | undefined): string | null {
  if (targetKey == null) return null;
  if (targetKey === "" || /^__.*__$/.test(targetKey)) return null;
  return targetKey;
}

type CustomActionMutationInput = {
  id?: string;
  actionName: string;
  description?: string | null;
  category: "other" | "macro" | "tool";
  triggerKey: string;
  displayOrder?: number;
  _delete?: boolean;
};

type CustomKeyMutationInput = {
  id?: string;
  keyCode: string;
  keyName: string;
  category: "mouse" | "keyboard";
  _delete?: boolean;
};

async function persistRemaps(
  db: ReturnType<typeof createDb>,
  userId: string,
  remapsData: RemapMutationInput[],
  now: Date
) {
  for (const remap of remapsData) {
    if (remap._delete && remap.id) {
      await db.delete(keyRemaps).where(eq(keyRemaps.id, remap.id));
    }
  }

  for (const remap of remapsData) {
    if (remap._delete) continue;
    if (!remap.sourceKey) continue;

    const sourceKeyNormalized = normalizeKeyCombination(remap.sourceKey);
    const sourceKeyUpper = remap.sourceKey.toUpperCase();
    const targetKey = sanitizeRemapTargetKey(remap.targetKey);
    const targetKeyNormalized = targetKey
      ? (isKeyRemapTarget(targetKey) ? normalizeKeyCode(targetKey) : targetKey)
      : null;
    const payload: PersistedRemapPayload = {
      sourceKey: sourceKeyNormalized,
      targetKey: targetKeyNormalized,
      software: remap.software || null,
      notes: remap.notes || null,
    };

    if (remap.id) {
      await db
        .update(keyRemaps)
        .set({ ...payload, updatedAt: now })
        .where(eq(keyRemaps.id, remap.id));
      continue;
    }

    const existing = await db.query.keyRemaps.findFirst({
      where: and(
        eq(keyRemaps.userId, userId),
        or(
          eq(keyRemaps.sourceKey, sourceKeyNormalized),
          eq(keyRemaps.sourceKey, sourceKeyUpper)
        )
      ),
    });

    if (existing) {
      await db
        .update(keyRemaps)
        .set({ ...payload, updatedAt: now })
        .where(eq(keyRemaps.id, existing.id));
      continue;
    }

    await db.insert(keyRemaps).values({
      id: createId(),
      userId,
      ...payload,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function persistKeybindingUpdates(
  db: ReturnType<typeof createDb>,
  updates: KeybindingUpdateInput[],
  now: Date,
  options: { normalizeEmptyToUnbound: boolean }
) {
  for (const update of updates) {
    if (options.normalizeEmptyToUnbound) {
      const keyCode = update.keyCode || "_UNBOUND";
      await db
        .update(keybindings)
        .set({ keyCode, updatedAt: now })
        .where(eq(keybindings.id, update.id));
      continue;
    }

    if (!update.keyCode) continue;
    await db
      .update(keybindings)
      .set({ keyCode: update.keyCode, updatedAt: now })
      .where(eq(keybindings.id, update.id));
  }
}

async function upsertFingerAssignments(
  db: ReturnType<typeof createDb>,
  userId: string,
  fingerAssignmentsJson: string,
  now: Date
) {
  const existingConfig = await db.query.playerConfigs.findFirst({
    where: eq(playerConfigs.userId, userId),
  });

  if (existingConfig) {
    await db
      .update(playerConfigs)
      .set({ fingerAssignments: fingerAssignmentsJson, updatedAt: now })
      .where(eq(playerConfigs.userId, userId));
    return;
  }

  await db.insert(playerConfigs).values({
    id: createId(),
    userId,
    fingerAssignments: fingerAssignmentsJson,
    createdAt: now,
    updatedAt: now,
  });
}

async function persistCustomActions(
  db: ReturnType<typeof createDb>,
  userId: string,
  actionsData: CustomActionMutationInput[],
  now: Date
) {
  for (const action of actionsData) {
    if (action._delete && action.id) {
      await db.delete(customActions).where(eq(customActions.id, action.id));
    }
  }

  let order = 0;
  for (const action of actionsData) {
    if (action._delete) continue;
    if (!action.actionName || !action.triggerKey) continue;

    const triggerKeyNormalized = normalizeKeyCombination(action.triggerKey);

    if (action.id) {
      await db
        .update(customActions)
        .set({
          actionName: action.actionName,
          description: action.description || null,
          category: action.category,
          triggerKey: triggerKeyNormalized,
          displayOrder: order++,
          updatedAt: now,
        })
        .where(eq(customActions.id, action.id));
      continue;
    }

    await db.insert(customActions).values({
      id: createId(),
      userId,
      actionName: action.actionName,
      description: action.description || null,
      category: action.category,
      triggerKey: triggerKeyNormalized,
      displayOrder: order++,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return { error: t("meKeybindings.userNotFound") };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // キーバインド保存
  if (intent === "save-keybindings") {
    const keybindingsJson = formData.get("keybindings") as string;
    const updates = JSON.parse(keybindingsJson) as KeybindingUpdateInput[];
    await persistKeybindingUpdates(db, updates, new Date(), {
      normalizeEmptyToUnbound: true,
    });

    return { success: true, message: t("meKeybindings.saveKeybindings") };
  }

  // リマップ保存
  if (intent === "save-remaps") {
    const remapsJson = formData.get("remaps") as string;
    const remapsData = JSON.parse(remapsJson) as RemapMutationInput[];

    const now = new Date();
    await persistRemaps(db, user.id, remapsData, now);

    return { success: true, message: t("meKeybindings.saveRemaps") };
  }

  // 指割り当て保存
  if (intent === "save-fingers") {
    const fingerAssignmentsJson = formData.get("fingerAssignments") as string;
    const now = new Date();
    await upsertFingerAssignments(db, user.id, fingerAssignmentsJson, now);

    return { success: true, message: t("meKeybindings.saveFingers") };
  }

  // 全て保存
  if (intent === "save-all") {
    const keybindingsJson = formData.get("keybindings") as string;
    const remapsJson = formData.get("remaps") as string;
    const fingerAssignmentsJson = formData.get("fingerAssignments") as string;

    const now = new Date();

    // キーバインド
    if (keybindingsJson) {
      const updates = JSON.parse(keybindingsJson) as KeybindingUpdateInput[];
      await persistKeybindingUpdates(db, updates, now, {
        normalizeEmptyToUnbound: false,
      });
    }

    // リマップ
    if (remapsJson) {
      const remapsData = JSON.parse(remapsJson) as RemapMutationInput[];
      await persistRemaps(db, user.id, remapsData, now);
    }

    // 指割り当て
    if (fingerAssignmentsJson) {
      await upsertFingerAssignments(db, user.id, fingerAssignmentsJson, now);
    }

    // カスタムアクション
    const customActionsJson = formData.get("customActions") as string;
    if (customActionsJson) {
      const customActionsData = JSON.parse(customActionsJson) as CustomActionMutationInput[];
      await persistCustomActions(db, user.id, customActionsData, now);
    }

    // 変更履歴を記録
    const changes: string[] = [];
    if (keybindingsJson) changes.push(t("meKeybindings.tabActions"));
    if (remapsJson) changes.push(t("meKeybindings.tabRemaps"));
    if (fingerAssignmentsJson) changes.push(t("meKeybindings.tabFingers"));
    if (customActionsJson) changes.push(t("meKeybindings.tabCustomActions"));

    if (changes.length > 0) {
      await db.insert(configHistory).values({
        id: createId(),
        userId: user.id,
        changeType: "keybinding",
        changeDescription: t("meKeybindings.updatedChanges", { changes: changes.join("・") }),
        newData: JSON.stringify({ keybindings: keybindingsJson, remaps: remapsJson, fingerAssignments: fingerAssignmentsJson, customActions: customActionsJson }),
        createdAt: now,
      });
    }

    return { success: true, message: t("meKeybindings.saveSettings") };
  }

  // レガシーインポート
  if (intent === "import-legacy") {
    const legacyApiUrl = env.LEGACY_API_URL;
    if (!legacyApiUrl) {
      return { error: t("meKeybindings.legacyApiNotConfigured") };
    }

    if (!user.mcid) {
      return { error: t("meKeybindings.mcidNotSetForImport") };
    }

    const result = await importFromLegacy(db, user.id, legacyApiUrl, user.mcid);
    if (result.success) {
      return {
        success: true,
        message: t("meKeybindings.importSummary", {
          kb: result.keybindingsImported,
          ck: result.customKeysImported,
          rm: result.remapsImported,
          fa: result.fingerAssignmentsImported ? t("meKeybindings.yes") : t("meKeybindings.no"),
          st: result.settingsImported ? t("meKeybindings.yes") : t("meKeybindings.no"),
        }),
        importResult: result,
      };
    } else {
      return { error: result.error ?? t("meKeybindings.importFailed") };
    }
  }

  // カスタムキー保存
  if (intent === "save-custom-keys") {
    const customKeysJson = formData.get("customKeys") as string;
    const customKeysData = JSON.parse(customKeysJson) as CustomKeyMutationInput[];

    const now = new Date();

    for (const ck of customKeysData) {
      if (ck._delete && ck.id) {
        await db.delete(customKeys).where(eq(customKeys.id, ck.id));
      } else if (ck.id) {
        await db.update(customKeys)
          .set({
            keyCode: ck.keyCode,
            keyName: ck.keyName,
            category: ck.category,
            updatedAt: now,
          })
          .where(eq(customKeys.id, ck.id));
      } else if (ck.keyCode && ck.keyName) {
        await db.insert(customKeys).values({
          id: createId(),
          userId: user.id,
          keyCode: ck.keyCode,
          keyName: ck.keyName,
          category: ck.category,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return { success: true, message: t("meKeybindings.saveCustomKeys") };
  }

  // カスタムアクション保存
  if (intent === "save-custom-actions") {
    const customActionsJson = formData.get("customActions") as string;
    const customActionsData = JSON.parse(customActionsJson) as CustomActionMutationInput[];

    const now = new Date();
    await persistCustomActions(db, user.id, customActionsData, now);

    return { success: true, message: t("meKeybindings.saveCustomActions") };
  }

  return { error: t("meKeybindings.unknownAction") };
}

const categoryLabels: Record<string, string> = {
  movement: t("meKeybindings.categoryMovement"),
  combat: t("meKeybindings.categoryCombat"),
  inventory: t("meKeybindings.categoryInventory"),
  ui: t("meKeybindings.categoryUi"),
};

const categoryColors: Record<string, string> = {
  movement: "text-category-movement",
  combat: "text-category-combat",
  inventory: "text-category-inventory",
  ui: "text-category-ui",
};

const FINGER_OPTIONS: FingerType[] = [
  "left-pinky",
  "left-ring",
  "left-middle",
  "left-index",
  "left-thumb",
  "right-thumb",
  "right-index",
  "right-middle",
  "right-ring",
  "right-pinky",
];

const FINGER_COLOR_CLASSES: Record<FingerType, string> = {
  "left-pinky": "bg-finger-pinky",
  "left-ring": "bg-finger-ring",
  "left-middle": "bg-finger-middle",
  "left-index": "bg-finger-index",
  "left-thumb": "bg-finger-thumb",
  "right-thumb": "bg-finger-thumb",
  "right-index": "bg-finger-index",
  "right-middle": "bg-finger-middle",
  "right-ring": "bg-finger-ring",
  "right-pinky": "bg-finger-pinky",
};

// =====================================
// リマップ関連の型定義
// =====================================

/** UI用リマップエントリ（フロントエンドで使用） */
type RemapEntry = {
  id?: string;
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
  _delete?: boolean;
  _isNew?: boolean;
};

/** DB用リマップデータ（サーバーから/へ送受信） */
type DbRemapData = {
  id?: string;
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
};

// =====================================
// リマップ変換関数
// =====================================

/** DBデータからUI用エントリに変換 */
function dbRemapToUiRemap(db: DbRemapData): RemapEntry {
  const targetKey = sanitizeRemapTargetKey(db.targetKey);
  return {
    id: db.id,
    sourceKey: db.sourceKey,
    targetKey,
    software: db.software ?? null,
    notes: db.notes ?? null,
  };
}

function dbRemapsToUiRemaps(remaps: DbRemapData[], markAsNew = false): RemapEntry[] {
  return remaps.map((remap) => {
    const uiRemap = dbRemapToUiRemap(remap);
    return markAsNew ? { ...uiRemap, _isNew: true } : uiRemap;
  });
}

// =====================================
// その他の型定義
// =====================================

// カスタムアクションのエントリ
type CustomActionEntry = {
  id?: string;
  actionName: string;
  description: string | null;
  category: "other" | "macro" | "tool";
  triggerKey: string;
  displayOrder: number;
  _delete?: boolean;
  _isNew?: boolean;
};

type FingerAssignmentMap = Record<string, FingerType[]>;

// カスタムキーのエントリ型
type CustomKeyEntry = {
  id?: string;
  keyCode: string;
  keyName: string;
  category: "mouse" | "keyboard";
  _delete?: boolean;
  _isNew?: boolean;
};

// =====================================
// リマップ行コンポーネント
// =====================================

/** キーキャプチャボタン（リマップ元/先で共通化） */
function KeyCaptureButton({
  value,
  placeholder,
  keyboardLayout,
  isCapturing,
  setIsCapturing,
  onCapture,
  allowModifiers = false,
  className,
}: {
  value: string;
  placeholder: string;
  keyboardLayout: string | null;
  isCapturing: boolean;
  setIsCapturing: (v: boolean) => void;
  onCapture: (keyCode: string) => void;
  allowModifiers?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onFocus={() => setIsCapturing(true)}
      onBlur={() => setIsCapturing(false)}
      onKeyDown={(e) => {
        if (!isCapturing) return;
        e.preventDefault();

        if (allowModifiers) {
          // 修飾キー単独の場合
          const modifierKeyCodes = [
            "ShiftLeft", "ShiftRight",
            "ControlLeft", "ControlRight",
            "AltLeft", "AltRight",
            "MetaLeft", "MetaRight",
          ];
          if (modifierKeyCodes.includes(e.code)) {
            onCapture(e.code);
            (e.target as HTMLElement).blur();
            return;
          }

          // 修飾キー組み合わせを構築
          const modifiers: string[] = [];
          if (e.ctrlKey) modifiers.push("Ctrl");
          if (e.shiftKey) modifiers.push("Shift");
          if (e.altKey) modifiers.push("Alt");
          if (e.metaKey) modifiers.push("Meta");
          const combo = modifiers.length > 0
            ? [...modifiers, e.code].join("+")
            : e.code;
          onCapture(combo);
        } else {
          // 修飾キーは無視（リマップ先用）
          if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
          onCapture(e.code);
        }
        (e.target as HTMLElement).blur();
      }}
      className={cn(
        "min-w-28 h-9 px-3 rounded-md border text-sm font-mono transition-colors",
        "bg-secondary/50 hover:bg-secondary/70",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
        isCapturing ? "border-primary" : "border-input",
        className
      )}
    >
      {isCapturing ? (
        <span className="text-muted-foreground">{t("meKeybindings.pressKey")}</span>
      ) : value ? (
        <span>
          {allowModifiers
            ? getKeyCombinationLabel(value, keyboardLayout)
            : getKeyLabel(value, keyboardLayout)}
        </span>
      ) : (
        <span className="text-muted-foreground">{placeholder}</span>
      )}
    </button>
  );
}

// リマップ行コンポーネント
function RemapRow({
  remap,
  index,
  keyboardLayout,
  onUpdate,
  onDelete,
}: {
  remap: RemapEntry;
  index: number;
  keyboardLayout: string | null;
  onUpdate: (index: number, updates: Partial<RemapEntry>) => void;
  onDelete: (index: number) => void;
}) {
  const [isCapturingSource, setIsCapturingSource] = useState(false);
  const [isCapturingTarget, setIsCapturingTarget] = useState(false);
  const remapType = getRemapTypeFromTargetKey(remap.targetKey);
  const [selectedRemapType, setSelectedRemapType] = useState<RemapType>(remapType);

  useEffect(() => {
    if (selectedRemapType === "special" && (remap.targetKey === "" || remap.targetKey === null)) {
      return;
    }
    setSelectedRemapType(remapType);
  }, [remapType, selectedRemapType, remap.targetKey]);

  const handleRemapTypeChange = (newType: RemapType) => {
    setSelectedRemapType(newType);
    switch (newType) {
      case "disabled":
        onUpdate(index, { targetKey: null });
        break;
      case "special":
        onUpdate(index, { targetKey: remapType === "special" ? remap.targetKey : "" });
        break;
      case "keyboard":
        onUpdate(index, { targetKey: remapType === "keyboard" && remap.targetKey ? remap.targetKey : "" });
        break;
    }
  };

  return (
    <div className="p-3 rounded-lg border bg-secondary/20 space-y-3">
      {/* キー変換行 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* リマップ元（修飾キー対応） */}
        <KeyCaptureButton
          value={remap.sourceKey}
          placeholder={t("meKeybindings.source")}
          keyboardLayout={keyboardLayout}
          isCapturing={isCapturingSource}
          setIsCapturing={setIsCapturingSource}
          onCapture={(key) => onUpdate(index, { sourceKey: key })}
          allowModifiers={true}
        />

        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

        <Select
          value={selectedRemapType}
          onValueChange={(value: RemapType) => handleRemapTypeChange(value)}
        >
          <SelectTrigger className="w-24 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keyboard">{t("meKeybindings.outputTypeKey")}</SelectItem>
            <SelectItem value="special">{t("meKeybindings.outputTypeCharacter")}</SelectItem>
            <SelectItem value="disabled">{t("meKeybindings.outputTypeDisabled")}</SelectItem>
          </SelectContent>
        </Select>

        {selectedRemapType === "special" ? (
          <Input
            value={remapType === "special" ? (remap.targetKey ?? "") : ""}
            onChange={(e) => onUpdate(index, { targetKey: e.target.value })}
            placeholder={t("meKeybindings.enterCharacter")}
            className="w-40 h-9 font-mono text-center text-sm"
          />
        ) : selectedRemapType === "keyboard" ? (
          <KeyCaptureButton
            value={remap.targetKey || ""}
            placeholder={t("meKeybindings.target")}
            keyboardLayout={keyboardLayout}
            isCapturing={isCapturingTarget}
            setIsCapturing={setIsCapturingTarget}
            onCapture={(key) => onUpdate(index, { targetKey: key })}
            allowModifiers={false}
            className="w-40"
          />
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 text-destructive hover:text-destructive ml-auto"
          onClick={() => onDelete(index)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

    </div>
  );
}

// ダイアログ内リマップ行コンポーネント（修飾キー組み合わせ対応）
function DialogRemapRow({
  remap,
  index,
  baseKeyCode,
  keyboardLayout,
  onUpdate,
  onDelete,
}: {
  remap: RemapEntry & { _index: number };
  index: number;
  baseKeyCode: string;
  keyboardLayout: string | null;
  onUpdate: (index: number, updates: Partial<RemapEntry>) => void;
  onDelete: (index: number) => void;
}) {
  const [isCapturingTarget, setIsCapturingTarget] = useState(false);

  // 現在のsourceKeyから修飾キーを抽出
  const parsed = parseKeyCombination(remap.sourceKey);
  const currentModifiers = parsed.modifiers;

  // 修飾キーのトグル
  const toggleModifier = (mod: "Ctrl" | "Shift" | "Alt" | "Meta") => {
    const newModifiers = currentModifiers.includes(mod)
      ? currentModifiers.filter((m) => m !== mod)
      : [...currentModifiers, mod];

    // 新しいsourceKeyを構築
    const newSourceKey = newModifiers.length > 0
      ? [...newModifiers.sort((a, b) => ["Ctrl", "Shift", "Alt", "Meta"].indexOf(a) - ["Ctrl", "Shift", "Alt", "Meta"].indexOf(b)), baseKeyCode].join("+")
      : baseKeyCode;

    onUpdate(index, { sourceKey: newSourceKey });
  };

  const remapType = getRemapTypeFromTargetKey(remap.targetKey);
  const [selectedRemapType, setSelectedRemapType] = useState<RemapType>(remapType);

  useEffect(() => {
    if (selectedRemapType === "special" && (remap.targetKey === "" || remap.targetKey === null)) {
      return;
    }
    setSelectedRemapType(remapType);
  }, [remapType, selectedRemapType, remap.targetKey]);

  const handleRemapTypeChange = (newType: RemapType) => {
    setSelectedRemapType(newType);
    switch (newType) {
      case "disabled":
        onUpdate(index, { targetKey: null });
        break;
      case "special":
        onUpdate(index, { targetKey: remapType === "special" ? remap.targetKey : "" });
        break;
      case "keyboard":
        onUpdate(index, { targetKey: remapType === "keyboard" && remap.targetKey ? remap.targetKey : "" });
        break;
    }
  };

  return (
    <div className="p-3 rounded-lg border bg-secondary/20 space-y-3">
      {/* 修飾キー選択行 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{t("meKeybindings.from")}</span>
        <div className="flex gap-1">
          {(["Ctrl", "Shift", "Alt", "Meta"] as const).map((mod) => (
            <Button
              key={mod}
              type="button"
              variant={currentModifiers.includes(mod) ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => toggleModifier(mod)}
            >
              {mod === "Meta" ? "Win" : mod}
            </Button>
          ))}
        </div>
        <span className="text-muted-foreground">+</span>
        <Badge variant="secondary" className="font-mono text-sm px-2 py-1">
          {getKeyLabel(baseKeyCode, keyboardLayout)}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive ml-auto"
          onClick={() => onDelete(index)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* 出力設定行 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{t("meKeybindings.to")}</span>

        {/* 出力タイプ選択 */}
        <Select
          value={selectedRemapType}
          onValueChange={(value: RemapType) => handleRemapTypeChange(value)}
        >
          <SelectTrigger className="w-24 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keyboard">{t("meKeybindings.outputTypeKey")}</SelectItem>
            <SelectItem value="special">{t("meKeybindings.outputTypeCharacter")}</SelectItem>
            <SelectItem value="disabled">{t("meKeybindings.outputTypeDisabled")}</SelectItem>
          </SelectContent>
        </Select>

        {selectedRemapType === "special" ? (
          <Input
            value={remapType === "special" ? (remap.targetKey ?? "") : ""}
            onChange={(e) => {
              onUpdate(index, { targetKey: e.target.value });
            }}
            placeholder={t("meKeybindings.enterCharacter")}
            className="w-40 h-8 font-mono text-center text-sm"
          />
        ) : selectedRemapType === "keyboard" ? (
          <button
            type="button"
            onFocus={() => setIsCapturingTarget(true)}
            onBlur={() => setIsCapturingTarget(false)}
            onKeyDown={(e) => {
              if (!isCapturingTarget) return;
              e.preventDefault();
              if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
              onUpdate(index, { targetKey: e.code });
              (e.target as HTMLElement).blur();
            }}
            className={cn(
              "w-40 h-8 px-3 rounded-md border text-sm font-mono transition-colors",
              "bg-secondary/50 hover:bg-secondary/70",
              "focus:outline-none focus:ring-2 focus:ring-primary",
              isCapturingTarget ? "border-primary" : "border-input"
            )}
          >
            {isCapturingTarget ? (
              <span className="text-muted-foreground">{t("meKeybindings.pressKey")}</span>
            ) : remap.targetKey ? (
              getKeyLabel(remap.targetKey, keyboardLayout)
            ) : (
              <span className="text-muted-foreground">{t("meKeybindings.target")}</span>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// カスタムアクション行コンポーネント（useStateを安全に使用するため分離）
function CustomActionRow({
  action,
  index,
  keyboardLayout,
  onUpdate,
  onDelete,
}: {
  action: CustomActionEntry;
  index: number;
  keyboardLayout: string;
  onUpdate: (index: number, updates: Partial<CustomActionEntry>) => void;
  onDelete: (index: number) => void;
}) {
  const [isCapturingTrigger, setIsCapturingTrigger] = useState(false);

  return (
    <div className="p-3 rounded-lg border bg-secondary/20 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <Input
            value={action.actionName}
            onChange={(e) => onUpdate(index, { actionName: e.target.value })}
            placeholder={t("meKeybindings.actionNamePlaceholder")}
            className="text-sm"
          />
        </div>
        <Select
          value={action.category}
          onValueChange={(value: "other" | "macro" | "tool") => onUpdate(index, { category: value })}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="other">{t("meKeybindings.categoryOther")}</SelectItem>
            <SelectItem value="macro">{t("meKeybindings.categoryMacro")}</SelectItem>
            <SelectItem value="tool">{t("meKeybindings.categoryTool")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDelete(index)}
          className="text-destructive hover:text-destructive shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs text-muted-foreground shrink-0">{t("meKeybindings.triggerKey")}</Label>
        <button
          type="button"
          onFocus={() => setIsCapturingTrigger(true)}
          onBlur={() => setIsCapturingTrigger(false)}
          onKeyDown={(e) => {
            if (!isCapturingTrigger) return;
            e.preventDefault();

            // 修飾キー単独の場合（ShiftLeft, ControlRight など）
            const modifierKeyMap: Record<string, string> = {
              ShiftLeft: "ShiftLeft",
              ShiftRight: "ShiftRight",
              ControlLeft: "ControlLeft",
              ControlRight: "ControlRight",
              AltLeft: "AltLeft",
              AltRight: "AltRight",
              MetaLeft: "MetaLeft",
              MetaRight: "MetaRight",
            };

            if (modifierKeyMap[e.code]) {
              // 修飾キー単独で登録
              onUpdate(index, { triggerKey: e.code });
              (e.target as HTMLElement).blur();
              return;
            }

            // 修飾キー組み合わせを構築
            const modifiers: string[] = [];
            if (e.ctrlKey) modifiers.push("Ctrl");
            if (e.shiftKey) modifiers.push("Shift");
            if (e.altKey) modifiers.push("Alt");
            if (e.metaKey) modifiers.push("Meta");
            const combo = modifiers.length > 0
              ? [...modifiers, e.code].join("+")
              : e.code;
            onUpdate(index, { triggerKey: combo });
            (e.target as HTMLElement).blur();
          }}
          className={cn(
            "min-w-40 h-8 px-3 rounded-md border text-sm transition-colors",
            "bg-secondary/50 hover:bg-secondary/70",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
            isCapturingTrigger ? "border-primary" : "border-input"
          )}
        >
          {isCapturingTrigger ? (
            <span className="text-muted-foreground text-xs">{t("meKeybindings.pressKeyWithModifiers")}</span>
          ) : action.triggerKey ? (
            <span className="font-medium font-mono">{getKeyCombinationLabel(action.triggerKey, keyboardLayout)}</span>
          ) : (
            <span className="text-muted-foreground">{t("meKeybindings.unassigned")}</span>
          )}
        </button>
      </div>
      <div>
        <Input
          value={action.description || ""}
          onChange={(e) => onUpdate(index, { description: e.target.value || null })}
          placeholder={t("meKeybindings.descriptionOptional")}
          className="text-sm"
        />
      </div>
    </div>
  );
}

export default function KeybindingsPage() {
  const { keybindings: kbs, playerConfig, keyRemaps: initialRemaps, customKeys: initialCustomKeys, customActions: initialCustomActions, mcid, legacyApiUrl, activePreset, hasPresets, presets, inputMethod } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const importFetcher = useFetcher<typeof action>();
  const customKeyFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const prevImportDataRef = useRef<typeof importFetcher.data>(undefined);
  const prevCustomKeyDataRef = useRef<typeof customKeyFetcher.data>(undefined);
  const isInitializedRef = useRef(false);

  // ========== State ==========
  // キーバインドのローカル変更
  const [keybindingChanges, setKeybindingChanges] = useState<Record<string, string>>({});
  // リマップのローカル状態
  const [localRemaps, setLocalRemaps] = useState<RemapEntry[]>(() => dbRemapsToUiRemaps(initialRemaps));
  // 指割り当てのローカル状態
  const [localFingerAssignments, setLocalFingerAssignments] = useState<FingerAssignmentMap>(() =>
    playerConfig?.fingerAssignments ? JSON.parse(playerConfig.fingerAssignments) : {}
  );
  // カスタムキーのローカル状態
  const [localCustomKeys, setLocalCustomKeys] = useState<CustomKeyEntry[]>(() =>
    initialCustomKeys.map((ck) => ({
      id: ck.id,
      keyCode: ck.keyCode,
      keyName: ck.keyName,
      category: ck.category as "mouse" | "keyboard",
    }))
  );
  // カスタムアクションのローカル状態
  const [localCustomActions, setLocalCustomActions] = useState<CustomActionEntry[]>(() =>
    initialCustomActions.map((ca) => ({
      id: ca.id,
      actionName: ca.actionName,
      description: ca.description,
      category: ca.category as "other" | "macro" | "tool",
      triggerKey: ca.triggerKey,
      displayOrder: ca.displayOrder,
    }))
  );

  // ダイアログ関連
  const [editingKeyCode, setEditingKeyCode] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [modalDraftKeybindingChanges, setModalDraftKeybindingChanges] = useState<Record<string, string> | null>(null);
  const [modalDraftRemaps, setModalDraftRemaps] = useState<RemapEntry[] | null>(null);
  const [modalDraftFingerAssignments, setModalDraftFingerAssignments] = useState<FingerAssignmentMap | null>(null);
  const [modalDraftCustomActions, setModalDraftCustomActions] = useState<CustomActionEntry[] | null>(null);

  // タブの状態
  const [activeTab, setActiveTab] = useState("keybindings");

  // コピー元プリセット選択ダイアログ
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<"keybindings" | "remaps" | "fingers" | "all">("all");

  const isSubmitting = fetcher.state === "submitting";
  const data = fetcher.data;

  // 初期化済みフラグを設定（初回レンダリング後）
  useEffect(() => {
    isInitializedRef.current = true;
  }, []);

  // トースト通知
  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(data.message);
      setKeybindingChanges({});
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [data]);

  // ========== Computed Values ==========
  const deprecatedActions = ["toggleHud"];
  const isControllerMode = inputMethod === "controller";

  // 入力方法に応じたアクションをフィルタリング
  const allowedActions = isControllerMode
    ? (CONTROLLER_ACTIONS as readonly string[])
    : (KEYBOARD_MOUSE_ACTIONS as readonly string[]);

  const validKeybindings = kbs.filter((kb) =>
    !deprecatedActions.includes(kb.action) && allowedActions.includes(kb.action)
  );

  // ローカル変更を適用したキーバインドリスト
  const keybindingsWithLocalChanges = useMemo(() =>
    validKeybindings.map((kb) => ({
      ...kb,
      keyCode: keybindingChanges[kb.id] ?? kb.keyCode,
    })),
    [validKeybindings, keybindingChanges]
  );

  // Group by category
  const byCategory = useMemo(() =>
    keybindingsWithLocalChanges.reduce(
      (acc, kb) => {
        if (!acc[kb.category]) {
          acc[kb.category] = [];
        }
        acc[kb.category].push(kb);
        return acc;
      },
      {} as Record<string, typeof keybindingsWithLocalChanges>
    ),
    [keybindingsWithLocalChanges]
  );

  const categoryOrder = ["movement", "combat", "inventory", "ui"];

  // キーボードレイアウト
  const keyboardLayout = (playerConfig?.keyboardLayout as "US" | "JIS") || "US";

  // 未保存の変更チェック
  const hasKeybindingChanges = Object.keys(keybindingChanges).length > 0;
  const hasRemapChanges = useMemo(() => {
    const originalRemapMap = new Map(initialRemaps.map((r) => [r.id, r]));
    for (const remap of localRemaps) {
      if (remap._isNew) return true;
      if (remap._delete) return true;
      if (!remap.id) return true;
      const original = originalRemapMap.get(remap.id);
      if (!original) return true;
      if (
        original.sourceKey !== remap.sourceKey ||
        original.targetKey !== remap.targetKey ||
        original.software !== remap.software ||
        original.notes !== remap.notes
      ) {
        return true;
      }
    }
    return false;
  }, [localRemaps, initialRemaps]);

  const hasFingerChanges = useMemo(() => {
    const originalJson = playerConfig?.fingerAssignments || "{}";
    const currentJson = JSON.stringify(localFingerAssignments);
    return originalJson !== currentJson;
  }, [localFingerAssignments, playerConfig?.fingerAssignments]);

  const hasCustomActionChanges = useMemo(() => {
    const originalActionMap = new Map(initialCustomActions.map((a) => [a.id, a]));
    for (const action of localCustomActions) {
      if (action._isNew) return true;
      if (action._delete) return true;
      if (!action.id) return true;
      const original = originalActionMap.get(action.id);
      if (!original) return true;
      if (
        original.actionName !== action.actionName ||
        original.description !== action.description ||
        original.category !== action.category ||
        original.triggerKey !== action.triggerKey
      ) {
        return true;
      }
    }
    return false;
  }, [localCustomActions, initialCustomActions]);

  const hasUnsavedChanges = hasKeybindingChanges || hasRemapChanges || hasFingerChanges || hasCustomActionChanges;

  // 現在選択中のキーに関するデータ
  // 複数の操作が同じキーに割り当てられている場合はすべて取得
  const selectedKeyBindings = editingKeyCode
    ? keybindingsWithLocalChanges.filter((kb) => kb.keyCode === editingKeyCode)
    : [];
  // 選択したキーに関連するすべてのリマップ（修飾キー組み合わせを含む）
  const selectedKeyRemaps = useMemo(() => {
    if (!editingKeyCode) return [];
    // editingKeyCode をベースキーとして持つすべてのリマップを検索
    // 例: editingKeyCode が "KeyA" の場合、"KeyA", "Shift+KeyA", "Ctrl+KeyA" などすべて
    return localRemaps
      .map((r, index) => ({ ...r, _index: index }))
      .filter((r) => {
        if (r._delete) return false;
        const parsed = parseKeyCombination(r.sourceKey);
        return parsed.keyCode === editingKeyCode;
      });
  }, [editingKeyCode, localRemaps]);

  const selectedFinger = editingKeyCode
    ? localFingerAssignments[editingKeyCode]?.[0]
    : undefined;
  const selectedKeyCustomActions = useMemo(() => {
    if (!editingKeyCode) return [];
    return localCustomActions
      .map((a, index) => ({ ...a, _index: index }))
      .filter((a) => {
        if (a._delete || !a.triggerKey) return false;
        const parsed = parseKeyCombination(a.triggerKey);
        return parsed.keyCode === editingKeyCode;
      });
  }, [editingKeyCode, localCustomActions]);

  // 各操作がどのキーに割り当てられているかをマップ化
  const actionToKeyMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const kb of keybindingsWithLocalChanges) {
      if (kb.keyCode) {
        map[kb.action] = kb.keyCode;
      }
    }
    return map;
  }, [keybindingsWithLocalChanges]);

  // 有効なカスタムキー（削除されていないもの）
  const activeCustomKeys = useMemo(
    () => localCustomKeys.filter((ck) => !ck._delete),
    [localCustomKeys]
  );

  // カスタムキーのキーコードを名前に変換するマップ
  const customKeyNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ck of activeCustomKeys) {
      if (ck.keyCode) {
        map[ck.keyCode] = ck.keyName;
      }
    }
    return map;
  }, [activeCustomKeys]);

  // カスタムキーを含むキー名取得関数
  const getKeyLabelWithCustom = useCallback((keyCode: string): string => {
    // カスタムキーがあればその名前を返す
    if (customKeyNameMap[keyCode]) {
      return customKeyNameMap[keyCode];
    }
    return getKeyLabel(keyCode);
  }, [customKeyNameMap]);

  // 現在選択中のキーに割り当てられている操作のIDセット
  const selectedActionIds = useMemo(() => {
    return new Set(selectedKeyBindings.map((kb) => kb.id));
  }, [selectedKeyBindings]);

  const modalKeybindingChanges = modalDraftKeybindingChanges ?? keybindingChanges;
  const modalRemaps = modalDraftRemaps ?? localRemaps;
  const modalFingerAssignments = modalDraftFingerAssignments ?? localFingerAssignments;
  const modalCustomActions = modalDraftCustomActions ?? localCustomActions;

  const modalKeybindingsWithLocalChanges = useMemo(() =>
    validKeybindings.map((kb) => ({
      ...kb,
      keyCode: modalKeybindingChanges[kb.id] ?? kb.keyCode,
    })),
    [validKeybindings, modalKeybindingChanges]
  );

  const modalByCategory = useMemo(() =>
    modalKeybindingsWithLocalChanges.reduce(
      (acc, kb) => {
        if (!acc[kb.category]) acc[kb.category] = [];
        acc[kb.category].push(kb);
        return acc;
      },
      {} as Record<string, typeof modalKeybindingsWithLocalChanges>
    ),
    [modalKeybindingsWithLocalChanges]
  );

  const modalActionToKeyMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const kb of modalKeybindingsWithLocalChanges) {
      if (kb.keyCode) map[kb.action] = kb.keyCode;
    }
    return map;
  }, [modalKeybindingsWithLocalChanges]);

  const modalSelectedKeyRemaps = useMemo(() => {
    if (!editingKeyCode) return [];
    return modalRemaps
      .map((r, index) => ({ ...r, _index: index }))
      .filter((r) => {
        if (r._delete) return false;
        const parsed = parseKeyCombination(r.sourceKey);
        return parsed.keyCode === editingKeyCode;
      });
  }, [editingKeyCode, modalRemaps]);

  const modalSelectedKeyCustomActions = useMemo(() => {
    if (!editingKeyCode) return [];
    return modalCustomActions
      .map((a, index) => ({ ...a, _index: index }))
      .filter((a) => {
        if (a._delete || !a.triggerKey) return false;
        const parsed = parseKeyCombination(a.triggerKey);
        return parsed.keyCode === editingKeyCode;
      });
  }, [editingKeyCode, modalCustomActions]);

  const closeKeyModal = useCallback(() => {
    setEditingKeyCode(null);
    setIsCapturing(false);
    setModalDraftKeybindingChanges(null);
    setModalDraftRemaps(null);
    setModalDraftFingerAssignments(null);
    setModalDraftCustomActions(null);
  }, []);

  const saveKeyModalChanges = useCallback(() => {
    if (modalDraftKeybindingChanges) setKeybindingChanges(modalDraftKeybindingChanges);
    if (modalDraftRemaps) setLocalRemaps(modalDraftRemaps);
    if (modalDraftFingerAssignments) setLocalFingerAssignments(modalDraftFingerAssignments);
    if (modalDraftCustomActions) setLocalCustomActions(modalDraftCustomActions);
    closeKeyModal();
  }, [
    closeKeyModal,
    modalDraftCustomActions,
    modalDraftFingerAssignments,
    modalDraftKeybindingChanges,
    modalDraftRemaps,
  ]);

  // ========== Event Handlers ==========

  // 仮想キーボードでキーをクリック
  const handleKeyClick = useCallback((keyCode: string) => {
    setEditingKeyCode(keyCode);
    setIsCapturing(false);
  }, []);

  // キーキャプチャ（ダイアログ内）
  const handleKeyCapture = useCallback((e: React.KeyboardEvent) => {
    if (!isCapturing) return;
    e.preventDefault();
    setEditingKeyCode(e.code);
    setIsCapturing(false);
  }, [isCapturing]);

  // マウスキャプチャ（ダイアログ内）
  const handleMouseCapture = useCallback((e: React.MouseEvent) => {
    if (!isCapturing) return;
    e.preventDefault();
    const buttonMap: Record<number, string> = {
      0: "Mouse0",
      1: "Mouse2",
      2: "Mouse1",
    };
    setEditingKeyCode(buttonMap[e.button] || `Mouse${e.button}`);
    setIsCapturing(false);
  }, [isCapturing]);

  useEffect(() => {
    if (!editingKeyCode) return;

    setModalDraftKeybindingChanges({ ...keybindingChanges });
    setModalDraftRemaps(localRemaps.map((r) => ({ ...r })));
    const clonedFingerAssignments = Object.keys(localFingerAssignments).reduce<FingerAssignmentMap>((acc, key) => {
      acc[key] = [...(localFingerAssignments[key] ?? [])];
      return acc;
    }, {});
    setModalDraftFingerAssignments(clonedFingerAssignments);
    setModalDraftCustomActions(localCustomActions.map((a) => ({ ...a })));
  }, [editingKeyCode]);

  // キーバインドを変更
  const updateKeybindingKey = useCallback((keybindingId: string, newKeyCode: string) => {
    setKeybindingChanges((prev) => ({
      ...prev,
      [keybindingId]: newKeyCode,
    }));
  }, []);

  // 操作のON/OFFを切り替え（ダイアログからの操作用）
  const toggleActionForKey = useCallback((keybindingId: string, targetKeyCode: string, isCurrentlyAssigned: boolean, previousKeyCode?: string) => {
    setKeybindingChanges((prev) => {
      const original = validKeybindings.find((kb) => kb.id === keybindingId);
      if (!original) return prev;

      if (isCurrentlyAssigned) {
        // 割り当てを解除（不使用にする）
        return {
          ...prev,
          [keybindingId]: UNBOUND_KEY,
        };
      } else {
        // このキーに割り当てる
        // 他のキーに割り当て済みの場合、そのキーから削除する処理は
        // keybindingChangesにtargetKeyCodeを設定することで自動的に上書きされる
        return {
          ...prev,
          [keybindingId]: targetKeyCode,
        };
      }
    });
  }, [validKeybindings]);

  // リマップを追加
  const addRemap = useCallback((sourceKey: string) => {
    setLocalRemaps((prev) => [
      ...prev,
      {
        sourceKey,
        targetKey: null,
        software: null,
        notes: null,
        _isNew: true,
      },
    ]);
  }, []);

  // リマップを更新
  const updateRemap = useCallback((index: number, updates: Partial<RemapEntry>) => {
    setLocalRemaps((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }, []);

  // リマップを削除
  const deleteRemap = useCallback((index: number) => {
    setLocalRemaps((prev) => {
      const updated = [...prev];
      if (updated[index].id) {
        updated[index] = { ...updated[index], _delete: true };
      } else {
        updated.splice(index, 1);
      }
      return updated;
    });
  }, []);

  // 指割り当てを更新
  const updateFingerAssignment = useCallback((keyCode: string, finger: FingerType | null) => {
    setLocalFingerAssignments((prev) => {
      const updated = { ...prev };
      if (finger === null) {
        delete updated[keyCode];
      } else {
        updated[keyCode] = [finger];
      }
      return updated;
    });
  }, []);

  // カスタムアクションを追加
  const addCustomAction = useCallback(() => {
    setLocalCustomActions((prev) => [
      ...prev,
      {
        actionName: "",
        description: null,
        category: "other" as const,
        triggerKey: "",
        displayOrder: prev.length,
        _isNew: true,
      },
    ]);
  }, []);

  const addCustomActionForKey = useCallback((keyCode: string) => {
    setLocalCustomActions((prev) => [
      ...prev,
      {
        actionName: "",
        description: null,
        category: "other" as const,
        triggerKey: keyCode,
        displayOrder: prev.length,
        _isNew: true,
      },
    ]);
  }, []);

  const modalToggleActionForKey = useCallback((keybindingId: string, targetKeyCode: string, isCurrentlyAssigned: boolean) => {
    setModalDraftKeybindingChanges((prev) => {
      const base = prev ?? keybindingChanges;
      if (isCurrentlyAssigned) {
        return { ...base, [keybindingId]: UNBOUND_KEY };
      }
      return { ...base, [keybindingId]: targetKeyCode };
    });
  }, [keybindingChanges]);

  const modalAddRemapForKey = useCallback((keyCode: string) => {
    setModalDraftRemaps((prev) => {
      const base = prev ?? localRemaps;
      return [
        ...base,
        {
          sourceKey: keyCode,
          targetKey: "",
          software: null,
          notes: null,
          _isNew: true,
        },
      ];
    });
  }, [localRemaps]);

  const modalUpdateRemap = useCallback((index: number, updates: Partial<RemapEntry>) => {
    setModalDraftRemaps((prev) => {
      const base = prev ?? localRemaps;
      const updated = [...base];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }, [localRemaps]);

  const modalDeleteRemap = useCallback((index: number) => {
    setModalDraftRemaps((prev) => {
      const base = prev ?? localRemaps;
      const updated = [...base];
      if (updated[index].id) {
        updated[index] = { ...updated[index], _delete: true };
      } else {
        updated.splice(index, 1);
      }
      return updated;
    });
  }, [localRemaps]);

  const modalUpdateFingerAssignment = useCallback((keyCode: string, finger: FingerType | null) => {
    setModalDraftFingerAssignments((prev) => {
      const base = prev ?? localFingerAssignments;
      const updated = { ...base };
      if (finger === null) {
        delete updated[keyCode];
      } else {
        updated[keyCode] = [finger];
      }
      return updated;
    });
  }, [localFingerAssignments]);

  const modalAddCustomActionForKey = useCallback((keyCode: string) => {
    setModalDraftCustomActions((prev) => {
      const base = prev ?? localCustomActions;
      return [
        ...base,
        {
          actionName: "",
          description: null,
          category: "other" as const,
          triggerKey: keyCode,
          displayOrder: base.length,
          _isNew: true,
        },
      ];
    });
  }, [localCustomActions]);

  const modalUpdateCustomAction = useCallback((index: number, updates: Partial<CustomActionEntry>) => {
    setModalDraftCustomActions((prev) => {
      const base = prev ?? localCustomActions;
      const updated = [...base];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }, [localCustomActions]);

  const modalDeleteCustomAction = useCallback((index: number) => {
    setModalDraftCustomActions((prev) => {
      const base = prev ?? localCustomActions;
      const updated = [...base];
      if (updated[index].id) {
        updated[index] = { ...updated[index], _delete: true };
      } else {
        updated.splice(index, 1);
      }
      return updated;
    });
  }, [localCustomActions]);

  // カスタムアクションを更新
  const updateCustomAction = useCallback((index: number, updates: Partial<CustomActionEntry>) => {
    setLocalCustomActions((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }, []);

  // カスタムアクションを削除
  const deleteCustomAction = useCallback((index: number) => {
    setLocalCustomActions((prev) => {
      const updated = [...prev];
      if (updated[index].id) {
        updated[index] = { ...updated[index], _delete: true };
      } else {
        updated.splice(index, 1);
      }
      return updated;
    });
  }, []);

  // 変更を取り消す
  const resetChanges = useCallback(() => {
    setKeybindingChanges({});
    setLocalRemaps(dbRemapsToUiRemaps(initialRemaps));
    setLocalFingerAssignments(
      playerConfig?.fingerAssignments ? JSON.parse(playerConfig.fingerAssignments) : {}
    );
    setLocalCustomActions(
      initialCustomActions.map((ca) => ({
        id: ca.id,
        actionName: ca.actionName,
        description: ca.description,
        category: ca.category as "other" | "macro" | "tool",
        triggerKey: ca.triggerKey,
        displayOrder: ca.displayOrder,
      }))
    );
  }, [initialRemaps, playerConfig?.fingerAssignments, initialCustomActions]);

  // 保存
  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "save-all");

    // キーバインド変更をJSON化
    const keybindingUpdates = Object.entries(keybindingChanges).map(([id, keyCode]) => ({
      id,
      keyCode,
    }));
    if (keybindingUpdates.length > 0) {
      formData.set("keybindings", JSON.stringify(keybindingUpdates));
    }

    // リマップをJSON化
    formData.set("remaps", JSON.stringify(localRemaps));

    // 指割り当てをJSON化
    formData.set("fingerAssignments", JSON.stringify(localFingerAssignments));

    // カスタムアクションをJSON化
    formData.set("customActions", JSON.stringify(localCustomActions));

    fetcher.submit(formData, { method: "post" });
  }, [fetcher, keybindingChanges, localRemaps, localFingerAssignments, localCustomActions]);

  // デバッグ: 現在のデータを表示
  const handleDebugLog = useCallback(() => {
    console.log("[Debug] keybindings count:", kbs.length);
    console.log("[Debug] keyRemaps count:", initialRemaps.length);
    console.log("[Debug] keyRemaps:", initialRemaps);
    console.log("[Debug] playerConfig:", playerConfig);
    console.log("[Debug] fingerAssignments:", playerConfig?.fingerAssignments);
    if (playerConfig?.fingerAssignments) {
      try {
        const parsed = JSON.parse(playerConfig.fingerAssignments);
        console.log("[Debug] fingerAssignments (parsed):", parsed);
        console.log("[Debug] fingerAssignments keys:", Object.keys(parsed));
      } catch (e) {
        console.error("[Debug] fingerAssignments parse error:", e);
      }
    }
  }, [kbs, initialRemaps, playerConfig]);

  // データを再読み込み
  const handleRevalidate = useCallback(() => {
    revalidator.revalidate();
  }, [revalidator]);

  // レガシーインポート
  const handleImportLegacy = useCallback(() => {
    if (!legacyApiUrl) {
      toast.error(t("meKeybindings.legacyApiNotConfigured"));
      return;
    }
    importFetcher.submit(
      { intent: "import-legacy" },
      { method: "post" }
    );
  }, [importFetcher, legacyApiUrl]);

  // プリセットからコピー
  const handleCopyFromPreset = useCallback((presetId: string, target: "keybindings" | "remaps" | "fingers" | "all") => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) {
      toast.error(t("mePresets.presetNotFound"));
      return;
    }

    let copiedItems: string[] = [];

    // キーバインドをコピー
    if ((target === "keybindings" || target === "all") && preset.keybindingsData) {
      try {
        const keybindingsDataParsed = JSON.parse(preset.keybindingsData) as Array<{ action: string; keyCode: string }>;
        const newChanges: Record<string, string> = {};
        for (const presetKb of keybindingsDataParsed) {
          // 現在のkeybindingsから同じactionのものを探す
          const kb = kbs.find((k) => k.action === presetKb.action);
          if (kb && presetKb.keyCode !== kb.keyCode) {
            newChanges[kb.id] = presetKb.keyCode;
          }
        }
        if (Object.keys(newChanges).length > 0) {
          setKeybindingChanges((prev) => ({ ...prev, ...newChanges }));
          copiedItems.push(t("meKeybindings.tabActions"));
        }
      } catch (e) {
        console.error("Failed to parse keybindings data:", e);
      }
    }

    // リマップをコピー
    if ((target === "remaps" || target === "all") && preset.remapsData) {
      try {
        const remapsDataParsed = JSON.parse(preset.remapsData) as DbRemapData[];
        setLocalRemaps(dbRemapsToUiRemaps(remapsDataParsed, true));
        copiedItems.push(t("meKeybindings.tabRemaps"));
      } catch (e) {
        console.error("Failed to parse remaps data:", e);
      }
    }

    // 指割り当てをコピー
    if ((target === "fingers" || target === "all") && preset.fingerAssignmentsData) {
      try {
        const fingerAssignmentsDataParsed = JSON.parse(preset.fingerAssignmentsData) as FingerAssignmentMap;
        setLocalFingerAssignments(fingerAssignmentsDataParsed);
        copiedItems.push(t("meKeybindings.tabFingers"));
      } catch (e) {
        console.error("Failed to parse finger assignments data:", e);
      }
    }

    if (copiedItems.length > 0) {
      toast.success(
        t("meKeybindings.copiedFromPreset", {
          name: preset.name,
          items: copiedItems.join("・"),
        })
      );
    } else {
      toast.info(t("meKeybindings.copyNoData"));
    }

    setCopyDialogOpen(false);
  }, [presets, kbs]);

  // インポート結果を表示
  useEffect(() => {
    const data = importFetcher.data;
    if (!data || data === prevImportDataRef.current) return;
    if (importFetcher.state !== "idle") return;
    prevImportDataRef.current = data;

    if ("error" in data && data.error) {
      toast.error(data.error);
    } else if ("success" in data && data.success && data.message) {
      toast.success(data.message);
      revalidator.revalidate();
    }
  }, [importFetcher.data, importFetcher.state, revalidator]);

  // カスタムキー保存結果を表示
  useEffect(() => {
    const data = customKeyFetcher.data;
    if (!data || data === prevCustomKeyDataRef.current) return;
    if (customKeyFetcher.state !== "idle") return;
    prevCustomKeyDataRef.current = data;

    if ("error" in data && data.error) {
      toast.error(data.error);
    } else if ("success" in data && data.success && data.message) {
      toast.success(data.message);
      revalidator.revalidate();
    }
  }, [customKeyFetcher.data, customKeyFetcher.state, revalidator]);

  // カスタムキーの追加
  const addCustomKey = useCallback(() => {
    const newKey: CustomKeyEntry = {
      keyCode: "",
      keyName: "",
      category: "keyboard",
      _isNew: true,
    };
    setLocalCustomKeys((prev) => [...prev, newKey]);
  }, []);

  // カスタムキーの更新
  const updateCustomKey = useCallback((index: number, updates: Partial<CustomKeyEntry>) => {
    setLocalCustomKeys((prev) =>
      prev.map((ck, i) => (i === index ? { ...ck, ...updates } : ck))
    );
  }, []);

  // カスタムキーの削除
  const deleteCustomKey = useCallback((index: number) => {
    setLocalCustomKeys((prev) =>
      prev.map((ck, i) =>
        i === index ? (ck.id ? { ...ck, _delete: true } : ck) : ck
      ).filter((ck, i) => !(i === index && !ck.id))
    );
  }, []);

  // カスタムキーの保存
  const saveCustomKeys = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "save-custom-keys");
    formData.set("customKeys", JSON.stringify(localCustomKeys));
    customKeyFetcher.submit(formData, { method: "post" });
  }, [customKeyFetcher, localCustomKeys]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("meKeybindings.pageTitle")}</h1>
          <p className="text-muted-foreground">
            {t("meKeybindings.pageDescription")}
          </p>
        </div>
        {/* 開発用デバッグボタン */}
        {import.meta.env.DEV && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDebugLog}
            >
              <Bug className="mr-1 h-4 w-4" />
              Debug
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRevalidate}
              disabled={revalidator.state === "loading"}
            >
              <RefreshCw className={cn("mr-1 h-4 w-4", revalidator.state === "loading" && "animate-spin")} />
              Reload
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleImportLegacy}
              disabled={importFetcher.state !== "idle" || !legacyApiUrl}
            >
              <Download className={cn("mr-1 h-4 w-4", importFetcher.state !== "idle" && "animate-pulse")} />
              Import
            </Button>
          </div>
        )}
      </div>

      {/* 現在のプリセット表示 */}
      {activePreset && (
        <Alert>
          <Settings className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm">
              {t("meKeybindings.editingPreset")} <strong>{activePreset.name}</strong>
            </span>
            <div className="flex gap-2 shrink-0">
              {presets.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    setCopyTarget("all");
                    setCopyDialogOpen(true);
                  }}
                >
                  <Copy className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{t("meKeybindings.copyFromOtherPreset")}</span>
                  <span className="sm:hidden">{t("meKeybindings.copyShort")}</span>
                </Button>
              )}
              <Link to="/me/presets" className="shrink-0">
                <Button variant="outline" size="sm" className="w-full sm:w-auto">
                  {t("meKeybindings.managePresets")}
                </Button>
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* プリセットがない場合の警告 */}
      {!hasPresets && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm">
              {t("meKeybindings.noPresetWarning")}
            </span>
            <Link to="/me/presets" className="shrink-0">
              <Button size="sm" className="w-full sm:w-auto">
                {t("meKeybindings.createPreset")}
              </Button>
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* コントローラーモード: コントローラービュー */}
      {isControllerMode ? (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Gamepad2 className="h-5 w-5" />
                {t("meKeybindings.controllerView")}
              </CardTitle>
            </div>
            <CardDescription>
              {t("meKeybindings.controllerViewDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 左側: フェイスボタン・バンパー・トリガー */}
              <div className="space-y-4">
                <div className="text-sm font-medium text-muted-foreground">{t("meKeybindings.buttons")}</div>
                <div className="grid grid-cols-2 gap-2">
                  {["GamepadA", "GamepadB", "GamepadX", "GamepadY", "GamepadLB", "GamepadRB", "GamepadLT", "GamepadRT", "GamepadL3", "GamepadR3"].map((keyCode) => {
                    const binding = keybindingsWithLocalChanges.find((kb) => kb.keyCode === keyCode);
                    return (
                      <button
                        key={keyCode}
                        type="button"
                        onClick={() => setEditingKeyCode(keyCode)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-lg border transition-colors",
                          "bg-secondary/30 hover:bg-secondary/50",
                          binding ? "border-primary/30" : "border-input"
                        )}
                      >
                        <span className="font-mono text-sm font-medium">{getKeyLabel(keyCode)}</span>
                        <span className={cn("text-xs", binding ? categoryColors[binding.category] : "text-muted-foreground")}>
                          {binding ? getActionLabel(binding.action) : t("meKeybindings.unassigned")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* 右側: D-Pad・Start/Select */}
              <div className="space-y-4">
                <div className="text-sm font-medium text-muted-foreground">{t("meKeybindings.dpadEtc")}</div>
                <div className="grid grid-cols-2 gap-2">
                  {["GamepadDpadUp", "GamepadDpadDown", "GamepadDpadLeft", "GamepadDpadRight", "GamepadStart", "GamepadSelect"].map((keyCode) => {
                    const binding = keybindingsWithLocalChanges.find((kb) => kb.keyCode === keyCode);
                    return (
                      <button
                        key={keyCode}
                        type="button"
                        onClick={() => setEditingKeyCode(keyCode)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-lg border transition-colors",
                          "bg-secondary/30 hover:bg-secondary/50",
                          binding ? "border-primary/30" : "border-input"
                        )}
                      >
                        <span className="font-mono text-sm font-medium">{getKeyLabel(keyCode)}</span>
                        <span className={cn("text-xs", binding ? categoryColors[binding.category] : "text-muted-foreground")}>
                          {binding ? getActionLabel(binding.action) : t("meKeybindings.unassigned")}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* スティックの説明 */}
                <div className="mt-4 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                  <div className="font-medium mb-1">{t("meKeybindings.stickFixed")}</div>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>{t("meKeybindings.leftStickDesc")}</li>
                    <li>{t("meKeybindings.rightStickDesc")}</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* キーボード/マウスモード: 仮想キーボード */
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <CardTitle className="text-base font-semibold">{t("meKeybindings.keyboardView")}</CardTitle>
              <FingerLegend />
            </div>
            <CardDescription>
              {t("meKeybindings.keyboardViewDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-start gap-4">
              {/* メインキーボード */}
              <div className="overflow-x-auto pb-2 w-full">
                <VirtualKeyboard
                  layout={keyboardLayout}
                  keybindings={keybindingsToMap(keybindingsWithLocalChanges)}
                  fingerAssignments={localFingerAssignments}
                  remaps={localRemaps
                    .filter((r) => !r._delete)
                    .map((r) => ({
                      sourceKey: r.sourceKey,
                      targetKey: r.targetKey,
                    }))}
                  customKeys={activeCustomKeys.filter((ck) => ck.category === "keyboard").map((ck) => ({ code: ck.keyCode, label: ck.keyName }))}
                  onKeyClick={handleKeyClick}
                  showActionLabels
                  showFingerAssignments
                  showRemaps
                  hideNumpad
                />
              </div>
              {/* テンキーとマウスを横並び */}
              <div className="flex items-start gap-6">
                <VirtualNumpad
                  keybindings={keybindingsToMap(keybindingsWithLocalChanges)}
                  fingerAssignments={localFingerAssignments}
                  remaps={localRemaps
                    .filter((r) => !r._delete)
                    .map((r) => ({
                      sourceKey: r.sourceKey,
                      targetKey: r.targetKey,
                    }))}
                  onKeyClick={handleKeyClick}
                  showActionLabels
                  showFingerAssignments
                  showRemaps
                />
                <VirtualMouse
                  keybindings={keybindingsToMap(keybindingsWithLocalChanges)}
                  fingerAssignments={localFingerAssignments}
                  remaps={localRemaps
                    .filter((r) => !r._delete)
                    .map((r) => ({
                      sourceKey: r.sourceKey,
                      targetKey: r.targetKey,
                    }))}
                  customButtons={activeCustomKeys.map((ck) => ({ code: ck.keyCode, label: ck.keyName, category: ck.category }))}
                  onButtonClick={handleKeyClick}
                  showActionLabels
                  showFingerAssignments
                  showRemaps
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* タブ分け設定セクション */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        <TabsList className={cn("grid w-full h-auto", isControllerMode ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4")}>
          <TabsTrigger value="keybindings" className="text-xs sm:text-sm py-2">
            {t("meKeybindings.tabActions")}
          </TabsTrigger>
          {!isControllerMode && (
            <>
              <TabsTrigger value="remaps" className="text-xs sm:text-sm py-2">
                {t("meKeybindings.tabRemaps")}
              </TabsTrigger>
              <TabsTrigger value="custom-keys" className="text-xs sm:text-sm py-2">
                {t("meKeybindings.tabCustomKeys")}
              </TabsTrigger>
              <TabsTrigger value="custom-actions" className="text-xs sm:text-sm py-2">
                {t("meKeybindings.tabCustomActions")}
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* 操作の種類タブ */}
        <TabsContent value="keybindings" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {categoryOrder.map((category) => {
              const bindings = byCategory[category];
              if (!bindings || bindings.length === 0) return null;

              return (
                <Card key={category}>
                  <CardHeader className="pb-2">
                    <CardTitle className={`text-base font-semibold ${categoryColors[category]}`}>
                      {categoryLabels[category]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="divide-y">
                      {bindings.map((kb) => {
                        const [isFocused, setIsFocused] = useState(false);
                        return (
                          <div key={kb.id} className="flex items-center justify-between py-2.5">
                            <span className="text-sm">{getActionLabel(kb.action)}</span>
                            {isControllerMode ? (
                              /* コントローラーモード: ドロップダウンでボタン選択 */
                              <Select
                                value={kb.keyCode || ""}
                                onValueChange={(value) => updateKeybindingKey(kb.id, value)}
                              >
                                <SelectTrigger className="w-32 h-8">
                                  <SelectValue placeholder={t("meKeybindings.unassigned")}>
                                    {isUnbound(kb.keyCode) ? (
                                      <span className="text-muted-foreground">{t("meKeybindings.notUsed")}</span>
                                    ) : kb.keyCode ? (
                                      getKeyLabel(kb.keyCode)
                                    ) : (
                                      <span className="text-muted-foreground">{t("meKeybindings.unassigned")}</span>
                                    )}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={UNBOUND_KEY}>{t("meKeybindings.notUsed")}</SelectItem>
                                  {["GamepadA", "GamepadB", "GamepadX", "GamepadY", "GamepadLB", "GamepadRB", "GamepadLT", "GamepadRT", "GamepadL3", "GamepadR3", "GamepadDpadUp", "GamepadDpadDown", "GamepadDpadLeft", "GamepadDpadRight", "GamepadStart", "GamepadSelect"].map((keyCode) => (
                                    <SelectItem key={keyCode} value={keyCode}>
                                      {getKeyLabel(keyCode)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              /* キーボード/マウスモード: キーキャプチャ */
                              <button
                                type="button"
                                onFocus={() => setIsFocused(true)}
                                onBlur={() => setIsFocused(false)}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    // ESCキーで不使用に設定
                                    e.preventDefault();
                                    updateKeybindingKey(kb.id, UNBOUND_KEY);
                                    (e.target as HTMLElement).blur();
                                  } else if (!["Tab", "Enter"].includes(e.key)) {
                                    e.preventDefault();
                                    updateKeybindingKey(kb.id, e.code);
                                    (e.target as HTMLElement).blur();
                                  }
                                }}
                                className={cn(
                                  "min-w-32 h-8 px-3 rounded-md border text-sm transition-colors",
                                  "bg-secondary/50 hover:bg-secondary/70",
                                  "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
                                  isFocused ? "border-primary" : "border-input"
                                )}
                              >
                                {isFocused ? (
                                  <span className="text-muted-foreground text-xs">{t("meKeybindings.pressKeyToAssign")}</span>
                                ) : isUnbound(kb.keyCode) ? (
                                  <span className="text-muted-foreground">{t("meKeybindings.notUsed")}</span>
                                ) : kb.keyCode ? (
                                  <span className="font-medium">{getKeyLabelWithCustom(kb.keyCode)}</span>
                                ) : (
                                  <span className="text-muted-foreground">{t("meKeybindings.unassigned")}</span>
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* リマップタブ（コントローラーモード以外） */}
        {!isControllerMode && (
        <TabsContent value="remaps" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t("meKeybindings.remapsTitle")}</CardTitle>
              <CardDescription>
                AutoHotkeyやKarabinerなどで設定しているキーの変換を記録します。
                変更元は修飾キー（Ctrl, Shift, Alt）との組み合わせに対応しています。
                変更先は「キー」（単一キー）または「文字」（大文字/小文字区別）を選択できます。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {localRemaps.filter((r) => !r._delete).length > 0 ? (
                <div className="space-y-3">
                  {localRemaps.map((remap, index) => {
                    if (remap._delete) return null;
                    return (
                      <RemapRow
                        key={remap.id || `new-${index}`}
                        remap={remap}
                        index={index}
                        keyboardLayout={playerConfig?.keyboardLayout ?? null}
                        onUpdate={updateRemap}
                        onDelete={deleteRemap}
                      />
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("meKeybindings.remapsTitle")}が設定されていません
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => addRemap("")}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("meKeybindings.tabRemaps")}を追加
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* カスタムキータブ（コントローラーモード以外） */}
        {!isControllerMode && (
        <TabsContent value="custom-keys" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t("meKeybindings.customKeysTitle")}</CardTitle>
              <CardDescription>
                標準のキーボード以外のキー（マウスの追加ボタンなど）を定義します。
                定義したカスタムキーは操作の割り当てやリマップで使用できます。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeCustomKeys.length > 0 ? (
                <div className="space-y-2">
                  {localCustomKeys.map((ck, index) => {
                    if (ck._delete) return null;
                    return (
                      <div key={ck.id || `new-${index}`} className="flex items-center gap-2 p-2 border rounded-md">
                        <div className="flex-1 grid grid-cols-3 gap-2">
                          <Input
                            value={ck.keyCode}
                            onChange={(e) => updateCustomKey(index, { keyCode: e.target.value })}
                            placeholder={t("meKeybindings.keyCode")}
                            className="font-mono text-sm"
                          />
                          <Input
                            value={ck.keyName}
                            onChange={(e) => updateCustomKey(index, { keyName: e.target.value })}
                            placeholder={t("meKeybindings.displayName")}
                            className="text-sm"
                          />
                          <Select
                            value={ck.category}
                            onValueChange={(value: "mouse" | "keyboard") => updateCustomKey(index, { category: value })}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="keyboard">{t("meKeybindings.keyboard")}</SelectItem>
                              <SelectItem value="mouse">{t("meKeybindings.mouse")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteCustomKey(index)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("meKeybindings.noCustomKeys")}
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <Button type="button" variant="outline" onClick={addCustomKey} className="w-full sm:w-auto">
                  <Plus className="mr-1 h-4 w-4" />
                  {t("meKeybindings.addCustomKey")}
                </Button>
                {localCustomKeys.some((ck) => ck._isNew || ck._delete || !initialCustomKeys.some((ic) => ic.id === ck.id && ic.keyCode === ck.keyCode && ic.keyName === ck.keyName && ic.category === ck.category)) && (
                  <Button
                    type="button"
                    onClick={saveCustomKeys}
                    disabled={customKeyFetcher.state !== "idle"}
                    className="w-full sm:w-auto"
                  >
                    {customKeyFetcher.state !== "idle" ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-1 h-4 w-4" />
                    )}
                    {t("meKeybindings.saveCustomKeys")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* カスタムアクションタブ（コントローラーモード以外） */}
        {!isControllerMode && (
        <TabsContent value="custom-actions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t("meKeybindings.customActionsTitle")}</CardTitle>
              <CardDescription>
                DPIスイッチやマクロなど、ユーザー定義のアクションを登録します。
                修飾キー（Ctrl, Shift, Alt）との組み合わせでトリガーを設定できます。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {localCustomActions.filter((a) => !a._delete).length > 0 ? (
                <div className="space-y-3">
                  {localCustomActions.map((action, index) => {
                    if (action._delete) return null;
                    return (
                      <CustomActionRow
                        key={action.id || `new-${index}`}
                        action={action}
                        index={index}
                        keyboardLayout={keyboardLayout}
                        onUpdate={updateCustomAction}
                        onDelete={deleteCustomAction}
                      />
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("meKeybindings.noCustomActions")}
                </p>
              )}
              <Button type="button" variant="outline" onClick={addCustomAction} className="w-full sm:w-auto">
                <Plus className="mr-1 h-4 w-4" />
                {t("meKeybindings.addCustomAction")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        )}
      </Tabs>

      {/* 保存バー */}
      <FloatingSaveBar
        hasChanges={hasUnsavedChanges}
        isSubmitting={isSubmitting}
        onSave={handleSave}
        onReset={resetChanges}
      />

      {/* キー編集ダイアログ */}
      <Dialog
        open={!!editingKeyCode}
        onOpenChange={(open) => {
          if (!open) {
            closeKeyModal();
          }
        }}
      >
        <DialogContent
          className="sm:max-w-lg max-h-[80vh] p-0 overflow-hidden flex flex-col"
          onKeyDown={isCapturing ? handleKeyCapture : undefined}
          onMouseDown={isCapturing ? handleMouseCapture : undefined}
          onContextMenu={isCapturing ? (e) => e.preventDefault() : undefined}
        >
          <DialogHeader className="px-6 py-4 border-b bg-background sticky top-0 z-10">
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-xl">{editingKeyCode && getKeyLabel(editingKeyCode)}</span>
              <span className="text-muted-foreground text-sm font-normal">{t("meKeybindings.settingsSuffix")}</span>
            </DialogTitle>
            <DialogDescription>
              このキーに関する設定を編集します
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-6">
            {/* 割り当て操作（複数選択可能） */}
            <div className="space-y-2">
              <Label>{t("meKeybindings.actionAssignment")}</Label>
              <p className="text-xs text-muted-foreground mb-2">
                複数の操作を割り当てられます。他のキーに割当済の操作を選択すると、元のキーから削除されます。
              </p>
              <div className="max-h-64 overflow-y-auto border rounded-md p-2">
                {categoryOrder.map((category) => {
                  const bindings = modalByCategory[category];
                  if (!bindings || bindings.length === 0) return null;

                  return (
                    <div key={category} className="mb-3 last:mb-0">
                      <p className={`text-xs font-medium mb-1.5 ${categoryColors[category]}`}>
                        {categoryLabels[category]}
                      </p>
                      <div className="space-y-1.5 pl-2">
                        {bindings.map((kb) => {
                          const isAssignedToThisKey = kb.keyCode === editingKeyCode;
                          const isAssignedToOtherKey = !!(kb.keyCode && kb.keyCode !== editingKeyCode);
                          const assignedTo = modalActionToKeyMap[kb.action];

                          return (
                            <div key={kb.id} className="flex items-center gap-2">
                              <Checkbox
                                id={`action-${kb.id}`}
                                checked={isAssignedToThisKey}
                                onCheckedChange={() => {
                                  if (editingKeyCode) {
                                    modalToggleActionForKey(kb.id, editingKeyCode, isAssignedToThisKey);
                                  }
                                }}
                              />
                              <label
                                htmlFor={`action-${kb.id}`}
                                className="text-sm cursor-pointer select-none"
                              >
                                {getActionLabel(kb.action)}
                                {isAssignedToOtherKey && (
                                  <span className="ml-2 text-xs text-amber-500">
                                    ⚠ {getKeyLabelWithCustom(assignedTo)}に割当済
                                  </span>
                                )}
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* リマップ（コントローラーボタン以外のみ表示） */}
            {editingKeyCode && !isControllerKeyCode(editingKeyCode) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t("meKeybindings.keyRemapSetting")}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // 新しいリマップを追加（ベースキーのみ、修飾キーなし）
                    modalAddRemapForKey(editingKeyCode);
                  }}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  追加
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                このキー（および修飾キーとの組み合わせ）のリマップを設定できます
              </p>

              {modalSelectedKeyRemaps.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {modalSelectedKeyRemaps.map((remap) => (
                    <DialogRemapRow
                      key={remap.id || `new-${remap._index}`}
                      remap={remap}
                      index={remap._index}
                      baseKeyCode={editingKeyCode}
                      keyboardLayout={playerConfig?.keyboardLayout ?? null}
                      onUpdate={modalUpdateRemap}
                      onDelete={modalDeleteRemap}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2 border rounded-md bg-muted/30">
                  {t("meKeybindings.remapsTitle")}が設定されていません
                </p>
              )}
            </div>
            )}

            {/* 指割り当て（コントローラーボタン以外のみ表示） */}
            {editingKeyCode && !isControllerKeyCode(editingKeyCode) && (
            <div className="space-y-2">
              <Label>{t("meKeybindings.fingerAssignment")}</Label>
              <Select
                value={(editingKeyCode ? modalFingerAssignments[editingKeyCode]?.[0] : undefined) || "none"}
                onValueChange={(value) => {
                  if (editingKeyCode) {
                    modalUpdateFingerAssignment(
                      editingKeyCode,
                      value === "none" ? null : (value as FingerType)
                    );
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("meKeybindings.selectFinger")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("meKeybindings.unassigned")}</SelectItem>
                  {FINGER_OPTIONS.map((finger) => (
                    <SelectItem key={finger} value={finger}>
                      <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${FINGER_COLOR_CLASSES[finger]}`} />
                        {FINGER_LABELS[finger]}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            )}

            {/* カスタムアクション（コントローラーモード以外） */}
            {editingKeyCode && !isControllerMode && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t("meKeybindings.customActionsTitle")}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => modalAddCustomActionForKey(editingKeyCode)}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  追加
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                このキーをトリガーにするカスタムアクションを追加・編集できます
              </p>

              {modalSelectedKeyCustomActions.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {modalSelectedKeyCustomActions.map((action) => (
                    <CustomActionRow
                      key={action.id || `new-${action._index}`}
                      action={action}
                      index={action._index}
                      keyboardLayout={keyboardLayout}
                      onUpdate={modalUpdateCustomAction}
                      onDelete={modalDeleteCustomAction}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2 border rounded-md bg-muted/30">
                  {t("meKeybindings.noCustomActions")}
                </p>
              )}
            </div>
            )}
          </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-background sticky bottom-0 z-10">
            <Button variant="outline" onClick={closeKeyModal}>
              <X className="mr-2 h-4 w-4" />
              {t("meKeybindings.cancel")}
            </Button>
            <Button onClick={saveKeyModalChanges}>
              <Save className="mr-2 h-4 w-4" />
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* プリセットからコピーダイアログ */}
      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("meKeybindings.copyDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("meKeybindings.copyDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* コピー対象の選択 */}
            <div className="space-y-2">
              <Label>{t("meKeybindings.copyTarget")}</Label>
              <Select
                value={copyTarget}
                onValueChange={(value: "keybindings" | "remaps" | "fingers" | "all") => setCopyTarget(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("meKeybindings.all")}</SelectItem>
                  <SelectItem value="keybindings">{t("meKeybindings.keybindingsOnly")}</SelectItem>
                  <SelectItem value="remaps">{t("meKeybindings.remapsOnly")}</SelectItem>
                  <SelectItem value="fingers">{t("meKeybindings.fingersOnly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* プリセット一覧 */}
            <div className="space-y-2">
              <Label>{t("meKeybindings.copySourcePreset")}</Label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {presets
                  .filter((p) => p.id !== activePreset?.id)
                  .map((preset) => {
                    const hasData =
                      (copyTarget === "all" && (preset.hasKeybindings || preset.hasRemaps || preset.hasFingerAssignments)) ||
                      (copyTarget === "keybindings" && preset.hasKeybindings) ||
                      (copyTarget === "remaps" && preset.hasRemaps) ||
                      (copyTarget === "fingers" && preset.hasFingerAssignments);

                    return (
                      <Button
                        key={preset.id}
                        variant="outline"
                        className="w-full justify-start h-auto py-3"
                        disabled={!hasData}
                        onClick={() => handleCopyFromPreset(preset.id, copyTarget)}
                      >
                        <div className="flex flex-col items-start gap-1">
                          <span className="font-medium">{preset.name}</span>
                          <div className="flex gap-1 flex-wrap">
                            {preset.hasKeybindings && (
                              <Badge variant="secondary" className="text-xs">
                                <Keyboard className="h-3 w-3 mr-1" />
                                {t("meKeybindings.tabActions")}
                              </Badge>
                            )}
                            {preset.hasRemaps && (
                              <Badge variant="secondary" className="text-xs">
                                <ArrowRight className="h-3 w-3 mr-1" />
                                {t("meKeybindings.tabRemaps")}
                              </Badge>
                            )}
                            {preset.hasFingerAssignments && (
                              <Badge variant="secondary" className="text-xs">
                                {t("meKeybindings.tabFingers")}
                              </Badge>
                            )}
                            {!preset.hasKeybindings && !preset.hasRemaps && !preset.hasFingerAssignments && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                {t("meKeybindings.noData")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </Button>
                    );
                  })}
                {presets.filter((p) => p.id !== activePreset?.id).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {t("meKeybindings.noOtherPresets")}
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>
              {t("meKeybindings.cancel")}
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
            <h2 className="text-2xl font-bold">{t("meKeybindings.errorTitle")}</h2>
            <p className="text-muted-foreground">
              {t("meKeybindings.errorDescription")}
            </p>
            <Button onClick={() => window.location.reload()}>
              {t("meKeybindings.reloadPage")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
