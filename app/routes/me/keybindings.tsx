import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useLoaderData, useFetcher, useRevalidator, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/keybindings";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, keybindings, playerConfigs, keyRemaps, customKeys, configHistory, configPresets } from "@/lib/schema";
import { eq, asc, and, or } from "drizzle-orm";
import { getActionLabel, getKeyLabel, normalizeKeyCode, FINGER_LABELS, UNBOUND_KEY, isUnbound, type FingerType, CONTROLLER_ACTIONS, KEYBOARD_MOUSE_ACTIONS, isControllerKeyCode } from "@/lib/keybindings";
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

export const meta: Route.MetaFunction = () => {
  return [{ title: "キー配置 - Minefolio" }];
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

export async function action({ context, request }: Route.ActionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return { error: "ユーザーが見つかりません" };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // キーバインド保存
  if (intent === "save-keybindings") {
    const keybindingsJson = formData.get("keybindings") as string;
    const updates = JSON.parse(keybindingsJson) as Array<{ id: string; keyCode: string }>;

    for (const update of updates) {
      // 空文字列または_UNBOUNDの場合は不使用として保存
      const keyCode = update.keyCode || "_UNBOUND";
      await db
        .update(keybindings)
        .set({ keyCode, updatedAt: new Date() })
        .where(eq(keybindings.id, update.id));
    }

    return { success: true, message: "キー配置を保存しました" };
  }

  // リマップ保存
  if (intent === "save-remaps") {
    const remapsJson = formData.get("remaps") as string;
    const remapsData = JSON.parse(remapsJson) as Array<{
      id?: string;
      sourceKey: string;
      targetKey: string | null;
      software: string | null;
      notes: string | null;
      _delete?: boolean;
    }>;

    const now = new Date();

    // 削除対象を先に処理
    for (const remap of remapsData) {
      if (remap._delete && remap.id) {
        await db.delete(keyRemaps).where(eq(keyRemaps.id, remap.id));
      }
    }

    // 更新・挿入を処理
    for (const remap of remapsData) {
      if (remap._delete) continue;
      if (!remap.sourceKey) continue;

      const sourceKeyNormalized = normalizeKeyCode(remap.sourceKey);
      const targetKeyNormalized = remap.targetKey ? normalizeKeyCode(remap.targetKey) : null;

      if (remap.id) {
        // 既存レコードの更新
        await db.update(keyRemaps)
          .set({
            sourceKey: sourceKeyNormalized,
            targetKey: targetKeyNormalized,
            software: remap.software || null,
            notes: remap.notes || null,
            updatedAt: now,
          })
          .where(eq(keyRemaps.id, remap.id));
      } else {
        // 新規挿入 - 同じsourceKeyが既に存在するか確認（正規化後と大文字の両方でチェック）
        const sourceKeyUpper = remap.sourceKey.toUpperCase();
        const existing = await db.query.keyRemaps.findFirst({
          where: and(
            eq(keyRemaps.userId, user.id),
            or(
              eq(keyRemaps.sourceKey, sourceKeyNormalized),
              eq(keyRemaps.sourceKey, sourceKeyUpper)
            )
          ),
        });

        if (existing) {
          // 既存のものを更新（正規化形式に変換）
          await db.update(keyRemaps)
            .set({
              sourceKey: sourceKeyNormalized,
              targetKey: targetKeyNormalized,
              software: remap.software || null,
              notes: remap.notes || null,
              updatedAt: now,
            })
            .where(eq(keyRemaps.id, existing.id));
        } else {
          // 新規挿入
          await db.insert(keyRemaps).values({
            id: createId(),
            userId: user.id,
            sourceKey: sourceKeyNormalized,
            targetKey: targetKeyNormalized,
            software: remap.software || null,
            notes: remap.notes || null,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    return { success: true, message: "リマップを保存しました" };
  }

  // 指割り当て保存
  if (intent === "save-fingers") {
    const fingerAssignmentsJson = formData.get("fingerAssignments") as string;

    const existingConfig = await db.query.playerConfigs.findFirst({
      where: eq(playerConfigs.userId, user.id),
    });

    const now = new Date();
    if (existingConfig) {
      await db
        .update(playerConfigs)
        .set({ fingerAssignments: fingerAssignmentsJson, updatedAt: now })
        .where(eq(playerConfigs.userId, user.id));
    } else {
      await db.insert(playerConfigs).values({
        id: createId(),
        userId: user.id,
        fingerAssignments: fingerAssignmentsJson,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true, message: "指割り当てを保存しました" };
  }

  // 全て保存
  if (intent === "save-all") {
    const keybindingsJson = formData.get("keybindings") as string;
    const remapsJson = formData.get("remaps") as string;
    const fingerAssignmentsJson = formData.get("fingerAssignments") as string;

    const now = new Date();

    // キーバインド
    if (keybindingsJson) {
      const updates = JSON.parse(keybindingsJson) as Array<{ id: string; keyCode: string }>;
      for (const update of updates) {
        if (update.keyCode) {
          await db
            .update(keybindings)
            .set({ keyCode: update.keyCode, updatedAt: now })
            .where(eq(keybindings.id, update.id));
        }
      }
    }

    // リマップ
    if (remapsJson) {
      const remapsData = JSON.parse(remapsJson) as Array<{
        id?: string;
        sourceKey: string;
        targetKey: string | null;
        software: string | null;
        notes: string | null;
        _delete?: boolean;
      }>;

      // 削除対象を先に処理
      for (const remap of remapsData) {
        if (remap._delete && remap.id) {
          await db.delete(keyRemaps).where(eq(keyRemaps.id, remap.id));
        }
      }

      // 更新・挿入を処理
      for (const remap of remapsData) {
        if (remap._delete) continue;
        if (!remap.sourceKey) continue;

        const sourceKeyNormalized = normalizeKeyCode(remap.sourceKey);
        const targetKeyNormalized = remap.targetKey ? normalizeKeyCode(remap.targetKey) : null;

        if (remap.id) {
          // 既存レコードの更新
          await db.update(keyRemaps)
            .set({
              sourceKey: sourceKeyNormalized,
              targetKey: targetKeyNormalized,
              software: remap.software || null,
              notes: remap.notes || null,
              updatedAt: now,
            })
            .where(eq(keyRemaps.id, remap.id));
        } else {
          // 新規挿入 - 同じsourceKeyが既に存在するか確認（正規化後と大文字の両方でチェック）
          const sourceKeyUpper = remap.sourceKey.toUpperCase();
          const existing = await db.query.keyRemaps.findFirst({
            where: and(
              eq(keyRemaps.userId, user.id),
              or(
                eq(keyRemaps.sourceKey, sourceKeyNormalized),
                eq(keyRemaps.sourceKey, sourceKeyUpper)
              )
            ),
          });

          if (existing) {
            // 既存のものを更新（正規化形式に変換）
            await db.update(keyRemaps)
              .set({
                sourceKey: sourceKeyNormalized,
                targetKey: targetKeyNormalized,
                software: remap.software || null,
                notes: remap.notes || null,
                updatedAt: now,
              })
              .where(eq(keyRemaps.id, existing.id));
          } else {
            // 新規挿入
            await db.insert(keyRemaps).values({
              id: createId(),
              userId: user.id,
              sourceKey: sourceKeyNormalized,
              targetKey: targetKeyNormalized,
              software: remap.software || null,
              notes: remap.notes || null,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
      }
    }

    // 指割り当て
    if (fingerAssignmentsJson) {
      const existingConfig = await db.query.playerConfigs.findFirst({
        where: eq(playerConfigs.userId, user.id),
      });

      if (existingConfig) {
        await db
          .update(playerConfigs)
          .set({ fingerAssignments: fingerAssignmentsJson, updatedAt: now })
          .where(eq(playerConfigs.userId, user.id));
      } else {
        await db.insert(playerConfigs).values({
          id: createId(),
          userId: user.id,
          fingerAssignments: fingerAssignmentsJson,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // 変更履歴を記録
    const changes: string[] = [];
    if (keybindingsJson) changes.push("キー配置");
    if (remapsJson) changes.push("リマップ");
    if (fingerAssignmentsJson) changes.push("指割り当て");

    if (changes.length > 0) {
      await db.insert(configHistory).values({
        id: createId(),
        userId: user.id,
        changeType: "keybinding",
        changeDescription: `${changes.join("・")}を更新`,
        newData: JSON.stringify({ keybindings: keybindingsJson, remaps: remapsJson, fingerAssignments: fingerAssignmentsJson }),
        createdAt: now,
      });
    }

    return { success: true, message: "設定を保存しました" };
  }

  // レガシーインポート
  if (intent === "import-legacy") {
    const legacyApiUrl = env.LEGACY_API_URL;
    if (!legacyApiUrl) {
      return { error: "レガシーAPIが設定されていません" };
    }

    if (!user.mcid) {
      return { error: "MCIDが設定されていないためインポートできません" };
    }

    const result = await importFromLegacy(db, user.id, legacyApiUrl, user.mcid);
    if (result.success) {
      return {
        success: true,
        message: `インポート完了: キーバインド${result.keybindingsImported}件, カスタムキー${result.customKeysImported}件, リマップ${result.remapsImported}件, 指割当${result.fingerAssignmentsImported ? "あり" : "なし"}, 設定${result.settingsImported ? "あり" : "なし"}`,
        importResult: result,
      };
    } else {
      return { error: result.error ?? "インポートに失敗しました" };
    }
  }

  // カスタムキー保存
  if (intent === "save-custom-keys") {
    const customKeysJson = formData.get("customKeys") as string;
    const customKeysData = JSON.parse(customKeysJson) as Array<{
      id?: string;
      keyCode: string;
      keyName: string;
      category: "mouse" | "keyboard";
      _delete?: boolean;
    }>;

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

    return { success: true, message: "カスタムキーを保存しました" };
  }

  return { error: "不明な操作です" };
}

const categoryLabels: Record<string, string> = {
  movement: "移動",
  combat: "戦闘",
  inventory: "インベントリ",
  ui: "UI",
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

type RemapEntry = {
  id?: string;
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
  _delete?: boolean;
  _isNew?: boolean;
};

// リマップの種類
type RemapType = "none" | "keyboard" | "special" | "disabled";

// リマップの種類を判定
function getRemapType(remap: RemapEntry | null | undefined): RemapType {
  if (!remap) return "none";
  if (remap.targetKey === null) return "disabled";
  // 空文字の場合はキーボード入力待ち状態
  if (remap.targetKey === "") return "keyboard";
  // 特殊文字かどうかを判定（通常のキーコードではない場合）
  if (!remap.targetKey.match(/^(Key[A-Z]|Digit[0-9]|F[0-9]+|Numpad[0-9]|Arrow|Space|Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Shift|Control|Alt|Meta|Caps)/)) {
    return "special";
  }
  return "keyboard";
}

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

export default function KeybindingsPage() {
  const { keybindings: kbs, playerConfig, keyRemaps: initialRemaps, customKeys: initialCustomKeys, mcid, legacyApiUrl, activePreset, hasPresets, presets, inputMethod } = useLoaderData<typeof loader>();
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
  const [localRemaps, setLocalRemaps] = useState<RemapEntry[]>(() =>
    initialRemaps.map((r) => ({
      id: r.id,
      sourceKey: r.sourceKey,
      targetKey: r.targetKey,
      software: r.software,
      notes: r.notes,
    }))
  );
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

  // ダイアログ関連
  const [editingKeyCode, setEditingKeyCode] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  // ダイアログ内のリマップタイプ選択状態（空文字でkeyboardとspecialを区別するため）
  const [selectedRemapType, setSelectedRemapType] = useState<RemapType>("none");

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
      const original = originalRemapMap.get(remap.id!);
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

  const hasUnsavedChanges = hasKeybindingChanges || hasRemapChanges || hasFingerChanges;

  // 現在選択中のキーに関するデータ
  // 複数の操作が同じキーに割り当てられている場合はすべて取得
  const selectedKeyBindings = editingKeyCode
    ? keybindingsWithLocalChanges.filter((kb) => kb.keyCode === editingKeyCode)
    : [];
  const selectedRemap = editingKeyCode
    ? localRemaps.find((r) => r.sourceKey === editingKeyCode && !r._delete)
    : null;
  const selectedFinger = editingKeyCode
    ? localFingerAssignments[editingKeyCode]?.[0]
    : undefined;

  // editingKeyCode が変わったときに selectedRemapType を初期化
  // localRemaps を依存配列に入れると、入力のたびに再計算されてUIが壊れるため除外
  useEffect(() => {
    if (editingKeyCode) {
      const remap = localRemaps.find((r) => r.sourceKey === editingKeyCode && !r._delete);
      setSelectedRemapType(getRemapType(remap));
    } else {
      setSelectedRemapType("none");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingKeyCode]);

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

  // 変更を取り消す
  const resetChanges = useCallback(() => {
    setKeybindingChanges({});
    setLocalRemaps(
      initialRemaps.map((r) => ({
        id: r.id,
        sourceKey: r.sourceKey,
        targetKey: r.targetKey,
        software: r.software,
        notes: r.notes,
      }))
    );
    setLocalFingerAssignments(
      playerConfig?.fingerAssignments ? JSON.parse(playerConfig.fingerAssignments) : {}
    );
  }, [initialRemaps, playerConfig?.fingerAssignments]);

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

    fetcher.submit(formData, { method: "post" });
  }, [fetcher, keybindingChanges, localRemaps, localFingerAssignments]);

  // 現在のキーに対するリマップのインデックス
  const currentRemapIndex = editingKeyCode
    ? localRemaps.findIndex((r) => r.sourceKey === editingKeyCode && !r._delete)
    : -1;

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
      toast.error("レガシーAPIが設定されていません");
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
      toast.error("プリセットが見つかりません");
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
          copiedItems.push("キー配置");
        }
      } catch (e) {
        console.error("Failed to parse keybindings data:", e);
      }
    }

    // リマップをコピー
    if ((target === "remaps" || target === "all") && preset.remapsData) {
      try {
        const remapsDataParsed = JSON.parse(preset.remapsData) as Array<{
          sourceKey: string;
          targetKey: string | null;
          software: string | null;
          notes: string | null;
        }>;
        setLocalRemaps(remapsDataParsed.map((r) => ({
          sourceKey: r.sourceKey,
          targetKey: r.targetKey,
          software: r.software,
          notes: r.notes,
          _isNew: true,
        })));
        copiedItems.push("リマップ");
      } catch (e) {
        console.error("Failed to parse remaps data:", e);
      }
    }

    // 指割り当てをコピー
    if ((target === "fingers" || target === "all") && preset.fingerAssignmentsData) {
      try {
        const fingerAssignmentsDataParsed = JSON.parse(preset.fingerAssignmentsData) as FingerAssignmentMap;
        setLocalFingerAssignments(fingerAssignmentsDataParsed);
        copiedItems.push("指割り当て");
      } catch (e) {
        console.error("Failed to parse finger assignments data:", e);
      }
    }

    if (copiedItems.length > 0) {
      toast.success(`${preset.name}から${copiedItems.join("・")}をコピーしました`);
    } else {
      toast.info("コピーするデータがありませんでした");
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
          <h1 className="text-2xl font-bold">キー配置</h1>
          <p className="text-muted-foreground">
            キー配置・リマップ・指割り当てを設定します
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
              現在編集中のプリセット: <strong>{activePreset.name}</strong>
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
                  <span className="hidden sm:inline">他のプリセットからコピー</span>
                  <span className="sm:hidden">コピー</span>
                </Button>
              )}
              <Link to="/me/presets" className="shrink-0">
                <Button variant="outline" size="sm" className="w-full sm:w-auto">
                  プリセット管理
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
              プリセットがないため、キー配置を編集できません。まずプリセットを作成してください。
            </span>
            <Link to="/me/presets" className="shrink-0">
              <Button size="sm" className="w-full sm:w-auto">
                プリセットを作成
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
                コントローラービュー
              </CardTitle>
            </div>
            <CardDescription>
              コントローラーボタンに操作を割り当てます。左スティック（移動）・右スティック（視点）は固定です。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 左側: フェイスボタン・バンパー・トリガー */}
              <div className="space-y-4">
                <div className="text-sm font-medium text-muted-foreground">ボタン</div>
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
                          {binding ? getActionLabel(binding.action) : "未設定"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* 右側: D-Pad・Start/Select */}
              <div className="space-y-4">
                <div className="text-sm font-medium text-muted-foreground">D-Pad / その他</div>
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
                          {binding ? getActionLabel(binding.action) : "未設定"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* スティックの説明 */}
                <div className="mt-4 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                  <div className="font-medium mb-1">スティック操作（固定）</div>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>左スティック: 移動（前後左右）</li>
                    <li>右スティック: 視点操作</li>
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
              <CardTitle className="text-base font-semibold">キーボードビュー</CardTitle>
              <FingerLegend />
            </div>
            <CardDescription>
              キーをクリックして設定を編集できます
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
                  remaps={localRemaps.filter((r) => !r._delete).map((r) => ({ sourceKey: r.sourceKey, targetKey: r.targetKey }))}
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
                  remaps={localRemaps.filter((r) => !r._delete).map((r) => ({ sourceKey: r.sourceKey, targetKey: r.targetKey }))}
                  onKeyClick={handleKeyClick}
                  showActionLabels
                  showFingerAssignments
                  showRemaps
                />
                <VirtualMouse
                  keybindings={keybindingsToMap(keybindingsWithLocalChanges)}
                  fingerAssignments={localFingerAssignments}
                  remaps={localRemaps.filter((r) => !r._delete).map((r) => ({ sourceKey: r.sourceKey, targetKey: r.targetKey }))}
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
        onValueChange={(value) => {
          // 未保存の変更がある場合はタブ変更を防ぐ
          if (hasUnsavedChanges) {
            toast.error("変更を保存してからタブを切り替えてください");
            return;
          }
          setActiveTab(value);
        }}
        className="w-full"
      >
        <TabsList className={cn("grid w-full h-auto", isControllerMode ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4")}>
          <TabsTrigger value="keybindings" disabled={hasUnsavedChanges && activeTab !== "keybindings"} className="text-xs sm:text-sm py-2">
            操作の種類
          </TabsTrigger>
          {!isControllerMode && (
            <>
              <TabsTrigger value="remaps" disabled={hasUnsavedChanges && activeTab !== "remaps"} className="text-xs sm:text-sm py-2">
                リマップ
              </TabsTrigger>
              <TabsTrigger value="fingers" disabled={hasUnsavedChanges && activeTab !== "fingers"} className="text-xs sm:text-sm py-2">
                指割り当て
              </TabsTrigger>
              <TabsTrigger value="custom-keys" disabled={hasUnsavedChanges && activeTab !== "custom-keys"} className="text-xs sm:text-sm py-2">
                カスタムキー
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
                                  <SelectValue placeholder="未設定">
                                    {isUnbound(kb.keyCode) ? (
                                      <span className="text-muted-foreground">不使用</span>
                                    ) : kb.keyCode ? (
                                      getKeyLabel(kb.keyCode)
                                    ) : (
                                      <span className="text-muted-foreground">未設定</span>
                                    )}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={UNBOUND_KEY}>不使用</SelectItem>
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
                                  <span className="text-muted-foreground text-xs">キーを押す / ESCで不使用</span>
                                ) : isUnbound(kb.keyCode) ? (
                                  <span className="text-muted-foreground">不使用</span>
                                ) : kb.keyCode ? (
                                  <span className="font-medium">{getKeyLabelWithCustom(kb.keyCode)}</span>
                                ) : (
                                  <span className="text-muted-foreground">未設定</span>
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
              <CardTitle className="text-base font-semibold">キーリマップ</CardTitle>
              <CardDescription>
                AutoHotkeyやKarabinerなどで設定しているキーの変換を記録します。
                キーコードは直接入力するか、入力欄をクリック後にキーを押して入力できます。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {localRemaps.filter((r) => !r._delete).length > 0 ? (
                <div className="space-y-3">
                  {localRemaps.map((remap, index) => {
                    if (remap._delete) return null;
                    const remapType = getRemapType(remap);
                    return (
                      <div key={remap.id || `new-${index}`} className="p-3 rounded-lg border bg-secondary/20 space-y-3">
                        {/* キー変換行 */}
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1">
                            <Input
                              value={remap.sourceKey}
                              onChange={(e) => updateRemap(index, { sourceKey: e.target.value })}
                              onKeyDown={(e) => {
                                // 特殊キーをキャプチャ
                                if (!["Backspace", "Delete", "Tab", "Enter"].includes(e.key)) {
                                  e.preventDefault();
                                  updateRemap(index, { sourceKey: e.code });
                                }
                              }}
                              placeholder="変更元キー"
                              className="w-24 sm:w-28 font-mono text-center text-xs"
                            />
                            {remap.sourceKey && (
                              <span className="text-xs text-muted-foreground min-w-8">
                                ({getKeyLabel(remap.sourceKey, playerConfig?.keyboardLayout)})
                              </span>
                            )}
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          {remapType === "disabled" ? (
                            <Badge variant="destructive" className="w-24 sm:w-32 justify-center">無効化</Badge>
                          ) : (
                            <div className="flex items-center gap-1">
                              <Input
                                value={remap.targetKey || ""}
                                onChange={(e) => updateRemap(index, { targetKey: e.target.value || null })}
                                onKeyDown={(e) => {
                                  // 特殊キーをキャプチャ
                                  if (!["Backspace", "Delete", "Tab", "Enter"].includes(e.key)) {
                                    e.preventDefault();
                                    updateRemap(index, { targetKey: e.code });
                                  }
                                }}
                                placeholder="変更先キー"
                                className="w-24 sm:w-28 font-mono text-center text-xs"
                              />
                              {remap.targetKey && (
                                <span className="text-xs text-muted-foreground min-w-8">
                                  ({getKeyLabel(remap.targetKey, playerConfig?.keyboardLayout)})
                                </span>
                              )}
                            </div>
                          )}
                          <Select
                            value={remapType}
                            onValueChange={(value: RemapType) => {
                              if (value === "disabled") {
                                updateRemap(index, { targetKey: null });
                              } else if (value === "none") {
                                deleteRemap(index);
                              } else if (remapType === "disabled") {
                                updateRemap(index, { targetKey: "" });
                              }
                            }}
                          >
                            <SelectTrigger className="w-20 sm:w-24 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="keyboard">キー</SelectItem>
                              <SelectItem value="special">特殊</SelectItem>
                              <SelectItem value="disabled">無効</SelectItem>
                              <SelectItem value="none">削除</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive ml-auto sm:ml-0"
                            onClick={() => deleteRemap(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {/* 詳細行 */}
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            value={remap.software || ""}
                            onChange={(e) => updateRemap(index, { software: e.target.value || null })}
                            placeholder="ソフトウェア"
                            className="w-full sm:w-28 text-sm"
                          />
                          <Input
                            value={remap.notes || ""}
                            onChange={(e) => updateRemap(index, { notes: e.target.value || null })}
                            placeholder="メモ"
                            className="flex-1 min-w-0 text-sm"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  リマップが設定されていません
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
                リマップを追加
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* 指割り当てタブ（コントローラーモード以外） */}
        {!isControllerMode && (
        <TabsContent value="fingers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">指割り当て</CardTitle>
              <CardDescription>
                各キーを押す指を設定します。キーボードビューでキーをクリックして編集することもできます。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {Object.keys(localFingerAssignments).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(localFingerAssignments).map(([keyCode, fingers]) => {
                    const finger = fingers[0];
                    return (
                      <Badge
                        key={keyCode}
                        variant="outline"
                        className="cursor-pointer hover:bg-muted py-1.5 px-3"
                        onClick={() => setEditingKeyCode(keyCode)}
                      >
                        <span className="font-mono mr-2">{getKeyLabel(keyCode)}</span>
                        <span className={`w-3 h-3 rounded-full ${FINGER_COLOR_CLASSES[finger]}`} />
                        <span className="ml-1 text-xs text-muted-foreground">{FINGER_LABELS[finger]}</span>
                      </Badge>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  指割り当てが設定されていません。キーボードビューでキーをクリックして設定できます。
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* カスタムキータブ（コントローラーモード以外） */}
        {!isControllerMode && (
        <TabsContent value="custom-keys" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">カスタムキー</CardTitle>
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
                            placeholder="キーコード"
                            className="font-mono text-sm"
                          />
                          <Input
                            value={ck.keyName}
                            onChange={(e) => updateCustomKey(index, { keyName: e.target.value })}
                            placeholder="表示名"
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
                              <SelectItem value="keyboard">キーボード</SelectItem>
                              <SelectItem value="mouse">マウス</SelectItem>
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
                  カスタムキーが定義されていません
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <Button type="button" variant="outline" onClick={addCustomKey} className="w-full sm:w-auto">
                  <Plus className="mr-1 h-4 w-4" />
                  カスタムキーを追加
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
                    カスタムキーを保存
                  </Button>
                )}
              </div>
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
            setEditingKeyCode(null);
            setIsCapturing(false);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-lg"
          onKeyDown={isCapturing ? handleKeyCapture : undefined}
          onMouseDown={isCapturing ? handleMouseCapture : undefined}
          onContextMenu={isCapturing ? (e) => e.preventDefault() : undefined}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-xl">{editingKeyCode && getKeyLabel(editingKeyCode)}</span>
              <span className="text-muted-foreground text-sm font-normal">の設定</span>
            </DialogTitle>
            <DialogDescription>
              このキーに関する設定を編集します
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* 割り当て操作（複数選択可能） */}
            <div className="space-y-2">
              <Label>割り当て操作:</Label>
              <p className="text-xs text-muted-foreground mb-2">
                複数の操作を割り当てられます。他のキーに割当済の操作を選択すると、元のキーから削除されます。
              </p>
              <div className="max-h-64 overflow-y-auto border rounded-md p-2">
                {categoryOrder.map((category) => {
                  const bindings = byCategory[category];
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
                          const assignedTo = actionToKeyMap[kb.action];

                          return (
                            <div key={kb.id} className="flex items-center gap-2">
                              <Checkbox
                                id={`action-${kb.id}`}
                                checked={isAssignedToThisKey}
                                onCheckedChange={() => {
                                  if (editingKeyCode) {
                                    toggleActionForKey(kb.id, editingKeyCode, isAssignedToThisKey, kb.keyCode || undefined);
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
            <div className="space-y-2">
              <Label>リマップ:</Label>
              <p className="text-xs text-muted-foreground">
                このキーを別のキーに変換している場合に設定します
              </p>
              <div className="space-y-3">
                <Select
                  value={selectedRemapType}
                  onValueChange={(value: RemapType) => {
                    if (!editingKeyCode) return;
                    setSelectedRemapType(value);

                    const hasRemap = selectedRemap && currentRemapIndex >= 0;

                    if (value === "none") {
                      // リマップを削除
                      if (hasRemap) {
                        deleteRemap(currentRemapIndex);
                      }
                    } else if (value === "disabled") {
                      // 無効化
                      if (hasRemap) {
                        updateRemap(currentRemapIndex, { targetKey: null });
                      } else {
                        // 新規追加（targetKey: null で無効化状態）
                        setLocalRemaps((prev) => [
                          ...prev,
                          {
                            sourceKey: editingKeyCode,
                            targetKey: null,
                            software: null,
                            notes: null,
                            _isNew: true,
                          },
                        ]);
                      }
                    } else if (value === "keyboard" || value === "special") {
                      // キーボードまたは特殊文字へのリマップ
                      if (hasRemap) {
                        // 既存のリマップを更新（targetKeyを空にして入力待ち状態に）
                        updateRemap(currentRemapIndex, { targetKey: "" });
                      } else {
                        // 新規追加（targetKey: "" で入力待ち状態）
                        setLocalRemaps((prev) => [
                          ...prev,
                          {
                            sourceKey: editingKeyCode,
                            targetKey: "",
                            software: null,
                            notes: null,
                            _isNew: true,
                          },
                        ]);
                      }
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="リマップ種類を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">リマップしない</SelectItem>
                    <SelectItem value="keyboard">キーボードにある文字にリマップ</SelectItem>
                    <SelectItem value="special">特殊文字にリマップ</SelectItem>
                    <SelectItem value="disabled">無効化</SelectItem>
                  </SelectContent>
                </Select>

                {selectedRemapType === "keyboard" && (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono shrink-0">
                      {getKeyLabel(editingKeyCode || "")}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={selectedRemap?.targetKey || ""}
                      readOnly
                      onKeyDown={(e) => {
                        if (!["Tab", "Enter"].includes(e.key)) {
                          e.preventDefault();
                          if (currentRemapIndex >= 0) {
                            updateRemap(currentRemapIndex, { targetKey: e.code });
                          }
                        }
                      }}
                      placeholder="キーを押してください"
                      className="w-40 font-mono text-center text-sm"
                    />
                  </div>
                )}

                {selectedRemapType === "special" && (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono shrink-0">
                      {getKeyLabel(editingKeyCode || "")}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={selectedRemap?.targetKey || ""}
                      onChange={(e) => {
                        if (currentRemapIndex >= 0) {
                          updateRemap(currentRemapIndex, { targetKey: e.target.value || null });
                        }
                      }}
                      placeholder="特殊文字を入力"
                      className="w-40 font-mono text-center text-sm"
                    />
                  </div>
                )}

                {selectedRemapType === "disabled" && (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono">
                      {getKeyLabel(editingKeyCode || "")}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="destructive">無効化</Badge>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* 指割り当て（コントローラーボタン以外のみ表示） */}
            {editingKeyCode && !isControllerKeyCode(editingKeyCode) && (
            <div className="space-y-2">
              <Label>指割り当て:</Label>
              <Select
                value={selectedFinger || "none"}
                onValueChange={(value) => {
                  if (editingKeyCode) {
                    updateFingerAssignment(
                      editingKeyCode,
                      value === "none" ? null : (value as FingerType)
                    );
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="指を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未設定</SelectItem>
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingKeyCode(null)}>
              <X className="mr-2 h-4 w-4" />
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {/* コピー対象の選択 */}
            <div className="space-y-2">
              <Label>コピーする項目:</Label>
              <Select
                value={copyTarget}
                onValueChange={(value: "keybindings" | "remaps" | "fingers" | "all") => setCopyTarget(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">すべて</SelectItem>
                  <SelectItem value="keybindings">キー配置のみ</SelectItem>
                  <SelectItem value="remaps">リマップのみ</SelectItem>
                  <SelectItem value="fingers">指割り当てのみ</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* プリセット一覧 */}
            <div className="space-y-2">
              <Label>コピー元プリセット:</Label>
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
                                キー配置
                              </Badge>
                            )}
                            {preset.hasRemaps && (
                              <Badge variant="secondary" className="text-xs">
                                <ArrowRight className="h-3 w-3 mr-1" />
                                リマップ
                              </Badge>
                            )}
                            {preset.hasFingerAssignments && (
                              <Badge variant="secondary" className="text-xs">
                                指割り当て
                              </Badge>
                            )}
                            {!preset.hasKeybindings && !preset.hasRemaps && !preset.hasFingerAssignments && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                データなし
                              </Badge>
                            )}
                          </div>
                        </div>
                      </Button>
                    );
                  })}
                {presets.filter((p) => p.id !== activePreset?.id).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    他のプリセットがありません
                  </p>
                )}
              </div>
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
