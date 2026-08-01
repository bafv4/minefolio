import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useLoaderData, useFetcher, useRevalidator, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/keybindings";
import { createDb, isUniqueConstraintError } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, keybindings, playerConfigs, keyRemaps, customKeys, configHistory, configPresets, customActions } from "@/lib/schema";
import { eq, asc, and, or, inArray } from "drizzle-orm";
import { getActionLabel, getKeyLabel, normalizeKeyCode, normalizeKeyCombination, getKeyCombinationLabel, parseKeyCombination, isSingleKey, getFingerLabel, UNBOUND_KEY, isUnbound, type FingerType, CONTROLLER_ACTIONS, KEYBOARD_MOUSE_ACTIONS, isControllerKeyCode } from "@/lib/keybindings";
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
import { Keyboard, X, Plus, Trash2, ArrowRight, Download, Save, Loader2, AlertCircle, Settings, Copy, Gamepad2 } from "lucide-react";
import { Link } from "react-router";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import { RemapRow, DialogRemapRow, ModifierToggleGroup } from "@/components/remap-row";
import { KeyCaptureButton, keyCaptureEscapeGuard } from "@/components/key-capture-button";
import { VirtualKeyboard, VirtualMouse, VirtualNumpad, FingerLegend, keybindingsToMap } from "@/components/virtual-keyboard";
import { createId } from "@paralleldrive/cuid2";
import { useT } from "@/hooks/use-locale";
import type { Translator } from "@/lib/messages";
import { isKeyRemapTarget, sanitizeRemapTargetKey, normalizeKeyRemapType, findRemapConflict, getRemapSourceLabel, remapSourceMatchKey, filterRemapsForContext, type KeyRemapType, type RemapConflict, type RemapContext } from "@/lib/remap-utils";
import { syncActivePresetSnapshot, assertPresetIsActive, PresetMismatchError, type PresetSyncKind } from "@/lib/preset-utils";
import { PresetSelector } from "@/components/preset-selector";
import { PresetSwitchLock } from "@/components/preset-switch-lock";
import { RemapViewToggle } from "@/components/remap-view-toggle";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meKeybindings.title") }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate, formAction, currentUrl, nextUrl }: ShouldRevalidateFunctionArgs) {
  // 自ルートのアクション結果がある場合はデフォルトの動作に従う
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  // /me/presets でのアクション（プリセット切替・作成・削除）の後は再検証する
  if (formAction === "/me/presets") {
    return true;
  }
  // フォーム送信を伴わない同一 URL の再検証（useRevalidator 起点）はデフォルトに従う。
  // PresetSelector の focus 再検証（別タブでのプリセット切替検知）や Reload ボタンを通すため
  if (!formAction && currentUrl.href === nextUrl.href) {
    return defaultShouldRevalidate;
  }
  // それ以外（ナビゲーションなど）では再検証しない
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
      configPresets: {
        columns: {
          id: true,
          name: true,
          isActive: true,
          isMain: true,
          keybindingsData: true,
          remapsData: true,
          fingerAssignmentsData: true,
        },
      },
    },
  });

  if (!user) {
    throw new Response(t("meKeybindings.userNotFound"), { status: 404 });
  }

  // 全プリセットを取得（コピー機能用）
  const allPresets = user.configPresets;

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
      isMain: p.isMain,
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
  const t = useT();
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
  // クライアント値は信用せず normalizeKeyRemapType で正規化する
  remapType?: string;
  _delete?: boolean;
};

type KeybindingUpdateInput = { id: string; keyCode: string };
type PersistedRemapPayload = {
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
  remapType: KeyRemapType;
};

// RemapOutputType / getRemapOutputTypeFromTargetKey / useRemapOutputType は @/components/remap-row、
// sanitizeRemapTargetKey は @/lib/remap-utils に抽出済み

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

/** findRemapConflict の違反をユーザー向けメッセージへ変換する（サーバー/クライアント共用） */
function remapConflictErrorMessage(
  t: Translator,
  conflict: RemapConflict,
  keyboardLayout?: string | null,
): string {
  const key = getRemapSourceLabel(t, conflict.sourceKey, keyboardLayout);
  return conflict.kind === "duplicate"
    ? t("meKeybindings.remapDuplicateError", { key, type: t(`remapType.${conflict.remapType}`) })
    : t("meKeybindings.remapAllConflictError", { key });
}

type Db = ReturnType<typeof createDb>;
/** db.transaction のコールバックに渡るトランザクション型 */
type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** persist 系ヘルパーが受け取る DB クライアント（トップレベル / トランザクション内のどちらでも可） */
type DbClient = Db | DbTransaction;

/** save-all のトランザクションをユーザー向けエラーメッセージ付きで中断するための例外 */
class SaveAllAbortError extends Error {}

async function persistRemaps(
  t: Translator,
  db: DbClient,
  userId: string,
  remapsData: RemapMutationInput[],
  now: Date
): Promise<{ error: string } | null> {
  // 保存前バリデーション: 同一 (sourceKey, 種別) の完全重複 / All 行と他行の共存を拒否
  const conflict = findRemapConflict(remapsData.filter((r) => !r._delete && r.sourceKey));
  if (conflict) {
    return { error: remapConflictErrorMessage(t, conflict) };
  }

  try {
    await db.transaction(async (tx) => {
      for (const remap of remapsData) {
        if (remap._delete && remap.id) {
          await tx
            .delete(keyRemaps)
            .where(and(eq(keyRemaps.id, remap.id), eq(keyRemaps.userId, userId)));
        }
      }

      // 各行を既存行（あれば）へ解決してから「一括削除→挿入」で書き戻す。
      // 逐次 update だと同一 sourceKey の2行で種別を入れ替えた際に
      // 一時的な UNIQUE 衝突が起き、正当な最終状態でも保存できなくなるため
      const resolved: Array<{ id: string; createdAt: Date; payload: PersistedRemapPayload }> = [];
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
          remapType: normalizeKeyRemapType(remap.remapType),
        };

        const existing = await tx.query.keyRemaps.findFirst({
          where: remap.id
            ? and(eq(keyRemaps.id, remap.id), eq(keyRemaps.userId, userId))
            : and(
                eq(keyRemaps.userId, userId),
                eq(keyRemaps.remapType, payload.remapType),
                or(
                  eq(keyRemaps.sourceKey, sourceKeyNormalized),
                  eq(keyRemaps.sourceKey, sourceKeyUpper)
                )
              ),
        });

        resolved.push({
          id: existing?.id ?? createId(),
          createdAt: existing?.createdAt ?? now,
          payload,
        });
      }

      if (resolved.length > 0) {
        await tx.delete(keyRemaps).where(
          and(
            eq(keyRemaps.userId, userId),
            inArray(keyRemaps.id, resolved.map((r) => r.id))
          )
        );
        for (const row of resolved) {
          await tx.insert(keyRemaps).values({
            id: row.id,
            userId,
            ...row.payload,
            createdAt: row.createdAt,
            updatedAt: now,
          });
        }
      }
    });
  } catch (e) {
    // UNIQUE 違反の catch はトランザクションの外側で行う
    // （内側で正常リターンすると削除だけが commit されるため）
    if (isUniqueConstraintError(e)) {
      return { error: t("meKeybindings.remapConflictError") };
    }
    throw e;
  }

  return null;
}

async function persistKeybindingUpdates(
  db: DbClient,
  userId: string,
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
        .where(and(eq(keybindings.id, update.id), eq(keybindings.userId, userId)));
      continue;
    }

    if (!update.keyCode) continue;
    await db
      .update(keybindings)
      .set({ keyCode: update.keyCode, updatedAt: now })
      .where(and(eq(keybindings.id, update.id), eq(keybindings.userId, userId)));
  }
}

async function upsertFingerAssignments(
  db: DbClient,
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
  db: DbClient,
  userId: string,
  actionsData: CustomActionMutationInput[],
  now: Date
) {
  for (const action of actionsData) {
    if (action._delete && action.id) {
      await db
        .delete(customActions)
        .where(and(eq(customActions.id, action.id), eq(customActions.userId, userId)));
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
        .where(and(eq(customActions.id, action.id), eq(customActions.userId, userId)));
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

/** formData 由来の JSON 配列を安全にパースする（不正なら null）。 */
function parseJsonArray<T>(raw: string | null | undefined): T[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
}

/** fingerAssignments の JSON 文字列がオブジェクトとして妥当か検証する。 */
function isValidFingerAssignmentsJson(raw: string): boolean {
  try {
    const v = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v);
  } catch {
    return false;
  }
}

/** fingerAssignments を安全にパースする（不正・未設定なら {}）。表示側で使用。 */
function parseFingerAssignments(
  raw: string | null | undefined,
): Record<string, FingerType[]> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, FingerType[]>)
      : {};
  } catch {
    return {};
  }
}

export async function action({ request }: Route.ActionArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
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
  const presetId = (formData.get("presetId") as string | null) || null;

  try {
    await assertPresetIsActive(db, user.id, presetId);
  } catch (e) {
    if (e instanceof PresetMismatchError) {
      return { error: t("mePresets.staleSession") };
    }
    throw e;
  }

  // このアクションの全 intent はライブ設定への書き込み＝アクティブプリセットの
  // スナップショット更新を伴うため、アクティブなプリセットが無い状態では一律で弾く
  // （既存データの読み込みは可能）。プリセットが無いまま書き込むと
  // syncActivePresetSnapshot が無言でスキップされ、後からプリセットを作るまで
  // どのプリセットにも属さないデータになってしまう。
  const activePresetRow = await db.query.configPresets.findFirst({
    where: and(eq(configPresets.userId, user.id), eq(configPresets.isActive, true)),
    columns: { id: true },
  });
  if (!activePresetRow) {
    return { error: t("meKeybindings.presetRequired") };
  }

  // キーバインド保存
  if (intent === "save-keybindings") {
    const updates = parseJsonArray<KeybindingUpdateInput>(
      formData.get("keybindings") as string,
    );
    if (!updates) return { error: t("meKeybindings.invalidPayload") };
    await persistKeybindingUpdates(db, user.id, updates, new Date(), {
      normalizeEmptyToUnbound: true,
    });
    await syncActivePresetSnapshot(db, user.id, ["keybindings"]);

    return { success: true, message: t("meKeybindings.saveKeybindings") };
  }

  // リマップ保存
  if (intent === "save-remaps") {
    const remapsData = parseJsonArray<RemapMutationInput>(
      formData.get("remaps") as string,
    );
    if (!remapsData) return { error: t("meKeybindings.invalidPayload") };

    const now = new Date();
    const remapError = await persistRemaps(t, db, user.id, remapsData, now);
    if (remapError) return { error: remapError.error };
    await syncActivePresetSnapshot(db, user.id, ["remaps"]);

    return { success: true, message: t("meKeybindings.saveRemaps") };
  }

  // 指割り当て保存
  if (intent === "save-fingers") {
    const fingerAssignmentsJson = formData.get("fingerAssignments") as string;
    if (!fingerAssignmentsJson || !isValidFingerAssignmentsJson(fingerAssignmentsJson)) {
      return { error: t("meKeybindings.invalidPayload") };
    }
    const now = new Date();
    await upsertFingerAssignments(db, user.id, fingerAssignmentsJson, now);
    // upsertFingerAssignments はライブ playerConfig 行を新規作成しうるため playerConfig も同期する
    // （fingers のみだと fingerAssignmentsData だけ非 null の非対称スナップショットになる）
    await syncActivePresetSnapshot(db, user.id, ["fingers", "playerConfig"]);

    return { success: true, message: t("meKeybindings.saveFingers") };
  }

  // 全て保存
  if (intent === "save-all") {
    const keybindingsJson = formData.get("keybindings") as string;
    const remapsJson = formData.get("remaps") as string;
    const fingerAssignmentsJson = formData.get("fingerAssignments") as string;
    const customActionsJson = formData.get("customActions") as string;
    const now = new Date();

    // 事前パース・バリデーション（書き込みを始める前に不正 payload をすべて弾く）
    const remapsData = remapsJson ? parseJsonArray<RemapMutationInput>(remapsJson) : null;
    if (remapsJson && !remapsData) return { error: t("meKeybindings.invalidPayload") };

    const keybindingUpdates = keybindingsJson
      ? parseJsonArray<KeybindingUpdateInput>(keybindingsJson)
      : null;
    if (keybindingsJson && !keybindingUpdates) return { error: t("meKeybindings.invalidPayload") };

    if (fingerAssignmentsJson && !isValidFingerAssignmentsJson(fingerAssignmentsJson)) {
      return { error: t("meKeybindings.invalidPayload") };
    }

    const customActionsData = customActionsJson
      ? parseJsonArray<CustomActionMutationInput>(customActionsJson)
      : null;
    if (customActionsJson && !customActionsData) return { error: t("meKeybindings.invalidPayload") };

    // 変更履歴の内容
    const changes: string[] = [];
    if (keybindingsJson) changes.push(t("meKeybindings.tabActions"));
    if (remapsJson) changes.push(t("meKeybindings.tabRemaps"));
    if (fingerAssignmentsJson) changes.push(t("meKeybindings.tabFingers"));
    if (customActionsJson) changes.push(t("meKeybindings.tabCustomActions"));

    // persist 系すべて + 変更履歴の挿入を単一トランザクションで実行し、
    // 途中で失敗（UNIQUE 制約違反等）した場合に部分適用状態にならないようにする
    try {
      await db.transaction(async (tx) => {
        // リマップ（persistRemaps はエラーを返しうるため先に実行する。
        // エラー時は throw でトランザクション全体をロールバックする）
        if (remapsData) {
          const remapError = await persistRemaps(t, tx, user.id, remapsData, now);
          if (remapError) throw new SaveAllAbortError(remapError.error);
        }

        // キーバインド
        if (keybindingUpdates) {
          await persistKeybindingUpdates(tx, user.id, keybindingUpdates, now, {
            normalizeEmptyToUnbound: false,
          });
        }

        // 指割り当て
        if (fingerAssignmentsJson) {
          await upsertFingerAssignments(tx, user.id, fingerAssignmentsJson, now);
        }

        // カスタムアクション
        if (customActionsData) {
          await persistCustomActions(tx, user.id, customActionsData, now);
        }

        // 変更履歴を記録
        if (changes.length > 0) {
          await tx.insert(configHistory).values({
            id: createId(),
            userId: user.id,
            changeType: "keybinding",
            changeDescription: t("meKeybindings.updatedChanges", { changes: changes.join(t("common.listSeparator")) }),
            newData: JSON.stringify({ keybindings: keybindingsJson, remaps: remapsJson, fingerAssignments: fingerAssignmentsJson, customActions: customActionsJson }),
            createdAt: now,
          });
        }
      });
    } catch (e) {
      if (e instanceof SaveAllAbortError) {
        return { error: e.message };
      }
      throw e;
    }

    // アクティブプリセットスナップショット同期（ライブテーブルのコミット後に実行）
    const syncKinds: PresetSyncKind[] = [];
    if (keybindingsJson) syncKinds.push("keybindings");
    if (remapsJson) syncKinds.push("remaps");
    // upsertFingerAssignments はライブ playerConfig 行を新規作成しうるため playerConfig も同期する
    if (fingerAssignmentsJson) syncKinds.push("fingers", "playerConfig");
    if (customActionsJson) syncKinds.push("customActions");
    if (syncKinds.length > 0) {
      await syncActivePresetSnapshot(db, user.id, syncKinds);
    }

    return { success: true, message: t("meKeybindings.saveSettings") };
  }

  // レガシーインポート
  if (intent === "import-legacy") {
    // リマップ・カスタムキーを取り込むため、プリセットが必要
    const legacyApiUrl = env.LEGACY_API_URL;
    if (!legacyApiUrl) {
      return { error: t("meKeybindings.legacyApiNotConfigured") };
    }

    if (!user.mcid) {
      return { error: t("meKeybindings.mcidNotSetForImport") };
    }

    const result = await importFromLegacy(t, db, user.id, legacyApiUrl, user.mcid);
    if (result.success) {
      // importFromLegacy が書き込みうるライブテーブルをすべて同期する
      // （itemLayouts / searchCrafts を欠くとスナップショットが古いままになる）
      await syncActivePresetSnapshot(db, user.id, [
        "keybindings",
        "remaps",
        "fingers",
        "customKeys",
        "playerConfig",
        "itemLayouts",
        "searchCrafts",
        "customActions",
      ]);
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
    const customKeysData = parseJsonArray<CustomKeyMutationInput>(
      formData.get("customKeys") as string,
    );
    if (!customKeysData) return { error: t("meKeybindings.invalidPayload") };

    const now = new Date();

    for (const ck of customKeysData) {
      if (ck._delete && ck.id) {
        await db
          .delete(customKeys)
          .where(and(eq(customKeys.id, ck.id), eq(customKeys.userId, user.id)));
      } else if (ck.id) {
        await db.update(customKeys)
          .set({
            keyCode: ck.keyCode,
            keyName: ck.keyName,
            category: ck.category,
            updatedAt: now,
          })
          .where(and(eq(customKeys.id, ck.id), eq(customKeys.userId, user.id)));
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

    await syncActivePresetSnapshot(db, user.id, ["customKeys"]);

    return { success: true, message: t("meKeybindings.saveCustomKeys") };
  }

  // カスタムアクション保存
  if (intent === "save-custom-actions") {
    const customActionsData = parseJsonArray<CustomActionMutationInput>(
      formData.get("customActions") as string,
    );
    if (!customActionsData) return { error: t("meKeybindings.invalidPayload") };

    const now = new Date();
    await persistCustomActions(db, user.id, customActionsData, now);
    await syncActivePresetSnapshot(db, user.id, ["customActions"]);

    return { success: true, message: t("meKeybindings.saveCustomActions") };
  }

  return { error: t("meKeybindings.unknownAction") };
}

// ラベルは描画時に t() で解決する（モジュール評価時はロケールが未確定）
const categoryLabelsOf = (t: Translator): Record<string, string> => ({
  movement: t("meKeybindings.categoryMovement"),
  combat: t("meKeybindings.categoryCombat"),
  inventory: t("meKeybindings.categoryInventory"),
  ui: t("meKeybindings.categoryUi"),
});

const categoryColors: Record<string, string> = {
  movement: "text-category-movement",
  combat: "text-category-combat",
  inventory: "text-category-inventory",
  ui: "text-category-ui",
};

// 操作割り当てタブの表示グループ。公開プロフィール
// （app/routes/player/profile.tsx の keybindingDisplayGroups）と同一の
// グルーピング・並び順にする（DB カテゴリではなく意味順の手書き分類）
const KEYBINDING_DISPLAY_GROUPS = [
  {
    key: "movement",
    labelKey: "playerProfile.movement",
    color: "text-category-movement",
    actions: ["forward", "back", "left", "right", "jump", "sneak", "sprint"],
  },
  {
    key: "inventory",
    labelKey: "playerProfile.inventory",
    color: "text-category-inventory",
    actions: [
      "hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5",
      "hotbar6", "hotbar7", "hotbar8", "hotbar9",
      "swapHands", "inventory", "pickBlock", "drop",
    ],
  },
  {
    key: "combat-ui",
    labelKey: "playerProfile.combatAndUi",
    color: "text-category-combat",
    actions: ["attack", "use", "togglePerspective", "chat", "command", "fullscreen"],
  },
] as const;

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
  remapType: KeyRemapType;
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
  remapType?: string | null;
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
    // remapType 欠落の旧JSON（プリセットコピー等）は unset に正規化
    remapType: normalizeKeyRemapType(db.remapType),
  };
}

function dbRemapsToUiRemaps(remaps: DbRemapData[], markAsNew = false): RemapEntry[] {
  return remaps.map((remap) => {
    const uiRemap = dbRemapToUiRemap(remap);
    return markAsNew ? { ...uiRemap, _isNew: true } : uiRemap;
  });
}

/** 同一 sourceKey ごとの非削除行数。2行以上あるキーは種別 All を選択不可にする */
function countRemapSourceKeys(remaps: RemapEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const remap of remaps) {
    if (remap._delete || !remap.sourceKey) continue;
    const key = remapSourceMatchKey(remap.sourceKey);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
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

// キーキャプチャボタンは @/components/key-capture-button、
// リマップ行（RemapRow / DialogRemapRow）は @/components/remap-row に抽出済み

// カスタムアクション行コンポーネント
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
  const t = useT();
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
        {/* 共通キャプチャ: 修飾キーは押しっぱなしで組み合わせ待ち、離すと単独で確定 */}
        <KeyCaptureButton
          value={action.triggerKey}
          placeholder={t("meKeybindings.unassigned")}
          keyboardLayout={keyboardLayout}
          onCapture={(keyCode) => onUpdate(index, { triggerKey: keyCode })}
          allowModifiers={true}
          className="min-w-40 h-8"
        />
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

/**
 * ダイアログ内カスタムアクション行。キー編集ダイアログ（クリックしたキーが起点）用で、
 * トリガーはキーキャプチャではなく、リマップ行と同じ修飾キートグル + ベースキーで編集する。
 */
function DialogCustomActionRow({
  action,
  index,
  baseKeyCode,
  keyboardLayout,
  onUpdate,
  onDelete,
}: {
  action: CustomActionEntry;
  index: number;
  baseKeyCode: string;
  keyboardLayout: string;
  onUpdate: (index: number, updates: Partial<CustomActionEntry>) => void;
  onDelete: (index: number) => void;
}) {
  const t = useT();
  return (
    <div className="p-3 rounded-lg border bg-secondary/20 space-y-3">
      {/* トリガー行（修飾キートグル + ベースキー + 削除） */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{t("meKeybindings.triggerKey")}</span>
        <ModifierToggleGroup
          comboKey={action.triggerKey}
          baseKeyCode={baseKeyCode}
          keyboardLayout={keyboardLayout}
          onChange={(newTriggerKey) => onUpdate(index, { triggerKey: newTriggerKey })}
        />
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

      {/* 名前・カテゴリ行 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <Input
            value={action.actionName}
            onChange={(e) => onUpdate(index, { actionName: e.target.value })}
            placeholder={t("meKeybindings.actionNamePlaceholder")}
            className="text-sm h-8"
          />
        </div>
        <Select
          value={action.category}
          onValueChange={(value: "other" | "macro" | "tool") => onUpdate(index, { category: value })}
        >
          <SelectTrigger className="w-28 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="other">{t("meKeybindings.categoryOther")}</SelectItem>
            <SelectItem value="macro">{t("meKeybindings.categoryMacro")}</SelectItem>
            <SelectItem value="tool">{t("meKeybindings.categoryTool")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Input
        value={action.description || ""}
        onChange={(e) => onUpdate(index, { description: e.target.value || null })}
        placeholder={t("meKeybindings.descriptionOptional")}
        className="text-sm h-8"
      />
    </div>
  );
}

/**
 * プリセット未作成時に、リマップ・カスタムキー・カスタムアクションが
 * 編集できない旨を案内する。既存データは読み取り専用で表示される。
 */
function PresetRequiredNotice() {
  const t = useT();
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="flex flex-wrap items-center gap-1">
        <span>{t("meKeybindings.presetRequiredNotice")}</span>
        <Link to="/me/presets" className="underline underline-offset-2">
          {t("meKeybindings.presetRequiredLink")}
        </Link>
      </AlertDescription>
    </Alert>
  );
}

export default function KeybindingsPage() {
  const t = useT();
  const { keybindings: kbs, playerConfig, keyRemaps: initialRemaps, customKeys: initialCustomKeys, customActions: initialCustomActions, mcid, legacyApiUrl, activePreset, hasPresets, presets, inputMethod } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const importFetcher = useFetcher<typeof action>();
  const customKeyFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  // リマップ・カスタムキー・カスタムアクションはプリセットに紐づくため、
  // アクティブなプリセットが無い間は閲覧のみ（サーバー側でも同じ判定で拒否する）
  const canEditPresetData = !!activePreset;
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
    parseFingerAssignments(playerConfig?.fingerAssignments)
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

  // loaderデータが変わったらローカル状態を再同期（プリセット切替時など）
  useEffect(() => {
    setLocalRemaps(dbRemapsToUiRemaps(initialRemaps));
  }, [initialRemaps]);

  useEffect(() => {
    setLocalFingerAssignments(
      parseFingerAssignments(playerConfig?.fingerAssignments),
    );
  }, [playerConfig?.fingerAssignments]);

  useEffect(() => {
    setLocalCustomKeys(
      initialCustomKeys.map((ck) => ({
        id: ck.id,
        keyCode: ck.keyCode,
        keyName: ck.keyName,
        category: ck.category as "mouse" | "keyboard",
      })),
    );
  }, [initialCustomKeys]);

  useEffect(() => {
    setLocalCustomActions(
      initialCustomActions.map((ca) => ({
        id: ca.id,
        actionName: ca.actionName,
        description: ca.description,
        category: ca.category as "other" | "macro" | "tool",
        triggerKey: ca.triggerKey,
        displayOrder: ca.displayOrder,
      })),
    );
  }, [initialCustomActions]);

  // キーバインドが loader で更新されたらローカル変更（差分）をクリア
  useEffect(() => {
    setKeybindingChanges({});
  }, [kbs]);

  // トースト通知 + 保存完了時のローカル状態リセット
  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    if (fetcher.state !== "idle") return; // 再検証完了まで待つ
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(data.message);
      // 保存完了後、すべてのローカル状態を最新の loader データから再構築
      // （hasUnsavedChanges を確実に false にして FloatingSaveBar を非表示にする）
      setKeybindingChanges({});
      setLocalRemaps(dbRemapsToUiRemaps(initialRemaps));
      setLocalFingerAssignments(
        parseFingerAssignments(playerConfig?.fingerAssignments),
      );
      setLocalCustomActions(
        initialCustomActions.map((ca) => ({
          id: ca.id,
          actionName: ca.actionName,
          description: ca.description,
          category: ca.category as "other" | "macro" | "tool",
          triggerKey: ca.triggerKey,
          displayOrder: ca.displayOrder,
        })),
      );
      setLocalCustomKeys(
        initialCustomKeys.map((ck) => ({
          id: ck.id,
          keyCode: ck.keyCode,
          keyName: ck.keyName,
          category: ck.category as "mouse" | "keyboard",
        })),
      );
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [data, fetcher.state, initialRemaps, playerConfig?.fingerAssignments, initialCustomActions, initialCustomKeys]);

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

  // 操作割り当てタブの表示グループ:
  // キーボード/マウスはプロフィールと同一の3グループ（移動 / インベントリ / 戦闘・UI）・意味順、
  // コントローラーは従来どおり DB カテゴリ準拠
  const displayGroups = useMemo(() => {
    if (isControllerMode) {
      return categoryOrder.map((category) => ({
        key: category,
        label: categoryLabelsOf(t)[category],
        color: categoryColors[category],
        bindings: byCategory[category] ?? [],
      }));
    }
    const byAction = new Map(keybindingsWithLocalChanges.map((kb) => [kb.action, kb]));
    return KEYBINDING_DISPLAY_GROUPS.map((group) => ({
      key: group.key,
      label: t(group.labelKey),
      color: group.color,
      bindings: group.actions
        .map((action) => byAction.get(action))
        .filter((kb): kb is (typeof keybindingsWithLocalChanges)[number] => kb !== undefined),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControllerMode, byCategory, keybindingsWithLocalChanges]);

  // キーボードレイアウト
  const keyboardLayout = (playerConfig?.keyboardLayout as "US" | "JIS") || "US";

  // 未保存の変更チェック
  const hasKeybindingChanges = Object.keys(keybindingChanges).length > 0;
  const hasRemapChanges = useMemo(() => {
    // localRemaps は dbRemapsToUiRemaps 経由で値が正規化される一方、
    // initialRemaps は DB の生値なので比較時に同じ正規化を適用する
    const originalRemapMap = new Map(
      initialRemaps.map((r) => [r.id, dbRemapToUiRemap(r)] as const),
    );
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
        original.notes !== remap.notes ||
        original.remapType !== remap.remapType
      ) {
        return true;
      }
    }
    // 件数が一致しなければ変更ありとみなす（追加/削除の検知）
    if (localRemaps.filter((r) => !r._delete).length !== initialRemaps.length) {
      return true;
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

  // 未保存の変更があるままページを離れようとしたら警告（タブを閉じる/リロード等）
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

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
    return getKeyLabel(t, keyCode);
  }, [customKeyNameMap]);

  // 現在選択中のキーに割り当てられている操作のIDセット
  const selectedActionIds = useMemo(() => {
    return new Set(selectedKeyBindings.map((kb) => kb.id));
  }, [selectedKeyBindings]);

  const modalKeybindingChanges = modalDraftKeybindingChanges ?? keybindingChanges;
  const modalRemaps = modalDraftRemaps ?? localRemaps;
  const modalFingerAssignments = modalDraftFingerAssignments ?? localFingerAssignments;
  const modalCustomActions = modalDraftCustomActions ?? localCustomActions;

  // 種別 All の選択可否判定用: 同一 sourceKey の行数（タブは localRemaps、ダイアログは modalRemaps 全体で判定）
  const remapSourceKeyCounts = useMemo(() => countRemapSourceKeys(localRemaps), [localRemaps]);
  const modalRemapSourceKeyCounts = useMemo(() => countRemapSourceKeys(modalRemaps), [modalRemaps]);

  // キーボードビューの Trigger/Chat 表示切替（プロフィールと同条件: 種別付きリマップがある場合のみ）
  const [remapView, setRemapView] = useState<RemapContext>("trigger");
  const hasTypedRemaps = useMemo(
    () =>
      localRemaps.some(
        (r) => !r._delete && (r.remapType === "trigger" || r.remapType === "chat"),
      ),
    [localRemaps],
  );

  // キーボードプレビューへ渡すリマップ。表示文脈（Trigger/Chat）で絞り込む
  // （remapType はツールチップのバッジ表示にも使う）
  const keyboardRemaps = useMemo(
    () =>
      filterRemapsForContext(
        localRemaps
          .filter((r) => !r._delete)
          .map((r) => ({ sourceKey: r.sourceKey, targetKey: r.targetKey, remapType: r.remapType })),
        remapView,
      ),
    [localRemaps, remapView],
  );

  // プリセット切替（apply-preset）中はキーボードビュー・入力欄をロックする
  const [presetSwitching, setPresetSwitching] = useState(false);

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
        remapType: "unset" as const,
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
          // 無効（disabled）は null で表す。"" だとキーボードビューの無効判定
          // （targetKey === null）に一致せず、保存するまで「×」が出ない（タブ側の addRemap と統一）
          targetKey: null,
          software: null,
          notes: null,
          remapType: "unset" as const,
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
      parseFingerAssignments(playerConfig?.fingerAssignments)
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
    // 保存前バリデーション（サーバーと同じ判定・メッセージ）: 重複・All共存はここで止める
    const conflict = findRemapConflict(localRemaps.filter((r) => !r._delete && r.sourceKey));
    if (conflict) {
      toast.error(remapConflictErrorMessage(t, conflict, keyboardLayout));
      return;
    }

    // 全設定がプリセットのスナップショット対象のため、プリセットが無い間は保存不可
    // （UI 側も編集を無効化しているが、防御的にここでも弾く）
    if (!activePreset) {
      toast.error(t("meKeybindings.presetRequired"));
      return;
    }

    const formData = new FormData();
    formData.set("intent", "save-all");
    formData.set("presetId", activePreset.id);

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

    // カスタムアクションをJSON化
    formData.set("customActions", JSON.stringify(localCustomActions));

    // 指割り当てをJSON化
    formData.set("fingerAssignments", JSON.stringify(localFingerAssignments));

    fetcher.submit(formData, { method: "post" });
  }, [fetcher, keybindingChanges, localRemaps, localFingerAssignments, localCustomActions, activePreset, keyboardLayout]);

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
    const formData = new FormData();
    formData.set("intent", "import-legacy");
    if (activePreset) {
      formData.set("presetId", activePreset.id);
    }
    importFetcher.submit(formData, { method: "post" });
  }, [importFetcher, legacyApiUrl, activePreset]);

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
          items: copiedItems.join(t("common.listSeparator")),
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
    if (!activePreset) {
      toast.error(t("meKeybindings.presetRequired"));
      return;
    }
    const formData = new FormData();
    formData.set("intent", "save-custom-keys");
    formData.set("presetId", activePreset.id);
    formData.set("customKeys", JSON.stringify(localCustomKeys));
    customKeyFetcher.submit(formData, { method: "post" });
  }, [customKeyFetcher, localCustomKeys, activePreset]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("meKeybindings.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">
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
              Debug
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRevalidate}
              disabled={revalidator.state === "loading"}
            >
              Reload
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleImportLegacy}
              disabled={importFetcher.state !== "idle" || !legacyApiUrl || !canEditPresetData}
            >
              <Download className={cn("mr-1 h-4 w-4", importFetcher.state !== "idle" && "animate-pulse")} />
              Import
            </Button>
          </div>
        )}
      </div>

      {/* プリセットセレクター */}
      <PresetSelector
        presets={presets.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive, isMain: p.isMain }))}
        activePresetId={activePreset?.id ?? null}
        hasChanges={hasUnsavedChanges}
        onSwitchingChange={setPresetSwitching}
        onCopyFromOther={presets.length > 1 ? () => {
          setCopyTarget("all");
          setCopyDialogOpen(true);
        } : undefined}
      />

      {/* プリセット切替中はキーボードビュー・入力欄をロックする */}
      <PresetSwitchLock locked={presetSwitching}>
      {/* キーボードビューとタブの間の余白（ページ直下の space-y-6 相当）を維持する */}
      <div className="space-y-6">
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
                        <span className="font-mono text-sm font-medium">{getKeyLabel(t, keyCode)}</span>
                        <span className={cn("text-xs", binding ? categoryColors[binding.category] : "text-muted-foreground")}>
                          {binding ? getActionLabel(t, binding.action) : t("meKeybindings.unassigned")}
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
                        <span className="font-mono text-sm font-medium">{getKeyLabel(t, keyCode)}</span>
                        <span className={cn("text-xs", binding ? categoryColors[binding.category] : "text-muted-foreground")}>
                          {binding ? getActionLabel(t, binding.action) : t("meKeybindings.unassigned")}
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
              <div className="flex flex-wrap items-center gap-3">
                {/* Trigger/Chat 表示切替（種別付きリマップがある場合のみ。プロフィールと同条件） */}
                {hasTypedRemaps && (
                  <RemapViewToggle value={remapView} onChange={setRemapView} />
                )}
                <FingerLegend />
              </div>
            </div>
            <CardDescription>
              {t("meKeybindings.keyboardViewDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-start gap-4">
              {/* メインキーボード */}
              <div className="custom-scrollbar overflow-x-auto pb-2 w-full">
                <VirtualKeyboard
                  layout={keyboardLayout}
                  keybindings={keybindingsToMap(keybindingsWithLocalChanges)}
                  fingerAssignments={localFingerAssignments}
                  remaps={keyboardRemaps}
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
                  remaps={keyboardRemaps}
                  onKeyClick={handleKeyClick}
                  showActionLabels
                  showFingerAssignments
                  showRemaps
                />
                <VirtualMouse
                  keybindings={keybindingsToMap(keybindingsWithLocalChanges)}
                  fingerAssignments={localFingerAssignments}
                  remaps={keyboardRemaps}
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
        <TabsList>
          <TabsTrigger value="keybindings">
            {t("meKeybindings.tabActions")}
          </TabsTrigger>
          {!isControllerMode && (
            <>
              <TabsTrigger value="remaps">
                {t("meKeybindings.tabRemaps")}
              </TabsTrigger>
              <TabsTrigger value="custom-actions">
                {t("meKeybindings.tabCustomActions")}
              </TabsTrigger>
              <TabsTrigger value="custom-keys">
                {t("meKeybindings.tabCustomKeys")}
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* 操作割り当てタブ */}
        <TabsContent value="keybindings" className="space-y-4">
          {!canEditPresetData && <PresetRequiredNotice />}
          <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-4", !canEditPresetData && "pointer-events-none opacity-50")}>
            {displayGroups.map((group) => {
              const bindings = group.bindings;
              if (!bindings || bindings.length === 0) return null;

              return (
                <Card key={group.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className={`text-base font-semibold ${group.color}`}>
                      {group.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="divide-y">
                      {bindings.map((kb) => {
                        const [isFocused, setIsFocused] = useState(false);
                        return (
                          <div key={kb.id} className="flex items-center justify-between gap-2 py-2.5">
                            <span className="text-sm">{getActionLabel(t, kb.action)}</span>
                            <div className="flex items-center gap-1">
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
                                      getKeyLabel(t, kb.keyCode)
                                    ) : (
                                      <span className="text-muted-foreground">{t("meKeybindings.unassigned")}</span>
                                    )}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={UNBOUND_KEY}>{t("meKeybindings.notUsed")}</SelectItem>
                                  {["GamepadA", "GamepadB", "GamepadX", "GamepadY", "GamepadLB", "GamepadRB", "GamepadLT", "GamepadRT", "GamepadL3", "GamepadR3", "GamepadDpadUp", "GamepadDpadDown", "GamepadDpadLeft", "GamepadDpadRight", "GamepadStart", "GamepadSelect"].map((keyCode) => (
                                    <SelectItem key={keyCode} value={keyCode}>
                                      {getKeyLabel(t, keyCode)}
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
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={t("meKeybindings.unassignAction")}
                              title={t("meKeybindings.unassignAction")}
                              onClick={() => updateKeybindingKey(kb.id, UNBOUND_KEY)}
                              disabled={!kb.keyCode || isUnbound(kb.keyCode)}
                              className={cn(
                                "h-8 w-8 shrink-0 text-destructive hover:text-destructive",
                                (!kb.keyCode || isUnbound(kb.keyCode)) && "invisible"
                              )}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                            </div>
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
          {!canEditPresetData && <PresetRequiredNotice />}
          <div className={cn(!canEditPresetData && "pointer-events-none opacity-50")}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t("meKeybindings.remapsTitle")}</CardTitle>
              <CardDescription>{t("meKeybindings.remapsDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {localRemaps.filter((r) => !r._delete).length > 0 ? (
                <div className="divide-y border-y">
                  {localRemaps.map((remap, index) => {
                    if (remap._delete) return null;
                    // 同一 sourceKey の行が他にある場合は All を選択不可にする（All共存禁止）
                    const hasSameSourceSibling =
                      !!remap.sourceKey &&
                      (remapSourceKeyCounts.get(remapSourceMatchKey(remap.sourceKey)) ?? 0) > 1;
                    return (
                      <RemapRow
                        key={remap.id || `new-${index}`}
                        remap={remap}
                        index={index}
                        keyboardLayout={playerConfig?.keyboardLayout ?? null}
                        onUpdate={updateRemap}
                        onDelete={deleteRemap}
                        showRemapType
                        disabledRemapTypes={hasSameSourceSibling ? ["all"] : undefined}
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
          </div>
        </TabsContent>
        )}

        {/* カスタムキータブ（コントローラーモード以外） */}
        {!isControllerMode && (
        <TabsContent value="custom-keys" className="space-y-4">
          {!canEditPresetData && <PresetRequiredNotice />}
          <div className={cn(!canEditPresetData && "pointer-events-none opacity-50")}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t("meKeybindings.customKeysTitle")}</CardTitle>
              <CardDescription>
                {t("meKeybindings.customKeysDescription")}
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
          </div>
        </TabsContent>
        )}

        {/* カスタムアクションタブ（コントローラーモード以外） */}
        {!isControllerMode && (
        <TabsContent value="custom-actions" className="space-y-4">
          {!canEditPresetData && <PresetRequiredNotice />}
          <div className={cn(!canEditPresetData && "pointer-events-none opacity-50")}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t("meKeybindings.customActionsTitle")}</CardTitle>
              <CardDescription>
                {t("meKeybindings.customActionsDescription")}
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
          </div>
        </TabsContent>
        )}
      </Tabs>
      </div>
      </PresetSwitchLock>

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
          onEscapeKeyDown={keyCaptureEscapeGuard}
        >
          <DialogHeader className="px-6 py-4 border-b bg-background sticky top-0 z-10">
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-xl">{editingKeyCode && getKeyLabel(t, editingKeyCode)}</span>
              <span className="text-muted-foreground text-sm font-normal">{t("meKeybindings.settingsSuffix")}</span>
            </DialogTitle>
            <DialogDescription>
              {t("meKeybindings.keyModalDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-6">
            {/* 操作割り当て（複数選択可能） */}
            <div className={cn("space-y-2", !canEditPresetData && "pointer-events-none opacity-50")}>
              <Label>{t("meKeybindings.actionAssignment")}</Label>
              <p className="text-xs text-muted-foreground mb-2">
                {canEditPresetData
                  ? t("meKeybindings.actionsHelp")
                  : t("meKeybindings.presetRequired")}
              </p>
              <div className="max-h-64 overflow-y-auto border rounded-md p-2">
                {categoryOrder.map((category) => {
                  const bindings = modalByCategory[category];
                  if (!bindings || bindings.length === 0) return null;

                  return (
                    <div key={category} className="mb-3 last:mb-0">
                      <p className={`text-xs font-medium mb-1.5 ${categoryColors[category]}`}>
                        {categoryLabelsOf(t)[category]}
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
                                {getActionLabel(t, kb.action)}
                                {isAssignedToOtherKey && (
                                  <span className="ml-2 text-xs text-amber-500">
                                    ⚠ {t("meKeybindings.assignedToOtherKey", {
                                      key: getKeyLabelWithCustom(assignedTo),
                                    })}
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
            <div className={cn("space-y-3", !canEditPresetData && "pointer-events-none opacity-50")}>
              <div className="flex items-center justify-between">
                <Label>{t("meKeybindings.keyRemapSetting")}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canEditPresetData}
                  onClick={() => {
                    // 新しいリマップを追加（ベースキーのみ、修飾キーなし）
                    modalAddRemapForKey(editingKeyCode);
                  }}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {t("meKeybindings.add")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {canEditPresetData
                  ? t("meKeybindings.remapsHelp")
                  : t("meKeybindings.presetRequired")}
              </p>

              {modalSelectedKeyRemaps.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {modalSelectedKeyRemaps.map((remap) => {
                    // 同一 sourceKey の行が他にある場合は All を選択不可にする（リマップ全体で判定）
                    const hasSameSourceSibling =
                      !!remap.sourceKey &&
                      (modalRemapSourceKeyCounts.get(remapSourceMatchKey(remap.sourceKey)) ?? 0) > 1;
                    return (
                      <DialogRemapRow
                        key={remap.id || `new-${remap._index}`}
                        remap={remap}
                        index={remap._index}
                        baseKeyCode={editingKeyCode}
                        keyboardLayout={playerConfig?.keyboardLayout ?? null}
                        onUpdate={modalUpdateRemap}
                        onDelete={modalDeleteRemap}
                        showRemapType
                        disabledRemapTypes={hasSameSourceSibling ? ["all"] : undefined}
                      />
                    );
                  })}
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
            <div className={cn("space-y-2", !canEditPresetData && "pointer-events-none opacity-50")}>
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
                        {getFingerLabel(t, finger)}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            )}

            {/* カスタムアクション（コントローラーモード以外） */}
            {editingKeyCode && !isControllerMode && (
            <div className={cn("space-y-3", !canEditPresetData && "pointer-events-none opacity-50")}>
              <div className="flex items-center justify-between">
                <Label>{t("meKeybindings.customActionsTitle")}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canEditPresetData}
                  onClick={() => modalAddCustomActionForKey(editingKeyCode)}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {t("meKeybindings.add")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {canEditPresetData
                  ? t("meKeybindings.customActionsHelp")
                  : t("meKeybindings.presetRequired")}
              </p>

              {modalSelectedKeyCustomActions.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {modalSelectedKeyCustomActions.map((action) => (
                    <DialogCustomActionRow
                      key={action.id || `new-${action._index}`}
                      action={action}
                      index={action._index}
                      baseKeyCode={editingKeyCode}
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
            <Button onClick={saveKeyModalChanges} disabled={!canEditPresetData}>
              <Save className="mr-2 h-4 w-4" />
              {t("meKeybindings.saveLabel")}
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
  const t = useT();
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
