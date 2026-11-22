import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { flushSync } from "react-dom";
import { lazy, Suspense, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useLoaderData, useFetcher, useRevalidator, useSearchParams, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/keybindings";
import { createDb, isUniqueConstraintError } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { resolveActivePublicPresetId } from "@/lib/config-history";
import { encodeKeybindingUpdate, type KeybindingChangeId } from "@/lib/history-description";
import { users, keybindings, playerConfigs, keyRemaps, customKeys, configHistory, configPresets, customActions } from "@/lib/schema";
import { eq, asc, and, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { countAssignedToKey, getActionAssignmentStatus } from "@/lib/keybindings-assignment";
import { getActionLabel, getKeyLabel, normalizeKeyCode, normalizeKeyCombination, parseKeyCombination, UNBOUND_KEY, isUnbound, type FingerType, CONTROLLER_ACTIONS, KEYBOARD_MOUSE_ACTIONS, isControllerKeyCode } from "@/lib/keybindings";
import { importFromLegacy } from "@/lib/legacy-import";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { Keyboard, X, Plus, Trash2, ArrowRight, Download, Save, FileInput, Check, Loader2, AlertCircle, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import { PageSection } from "@/components/page-section";
import { NoticeBanner } from "@/components/notice-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { KeyDialogSection } from "@/components/keybindings/key-dialog-section";
import { KeyActionPicker } from "@/components/keybindings/key-action-picker";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { RemapRow, DialogRemapRow, ModifierToggleGroup } from "@/components/remap-row";
import { KeyCaptureButton, keyCaptureEscapeGuard } from "@/components/key-capture-button";
import { HorizontalScrollArea } from "@/components/horizontal-scroll-area";
import { KeyboardScaledPreview, LEFT_HAND_CROP } from "@/components/keyboard-scaled-preview";
import { VirtualKeyboard, VirtualMouse, VirtualNumpad, FingerLegend, keybindingsToMap } from "@/components/virtual-keyboard";
import { FingerToggleGroup, sortFingers } from "@/components/finger-toggle-group";
import { createId } from "@paralleldrive/cuid2";
import { useT } from "@/hooks/use-locale";
import { jsonEqual } from "@/lib/loader-synced-draft";
import { useLoaderSyncedDraft } from "@/hooks/use-loader-synced-draft";
import type { MessageKey, Translator } from "@/lib/messages";
import { isKeyRemapTarget, sanitizeRemapTargetKey, normalizeKeyRemapType, findRemapConflict, getRemapSourceLabel, remapSourceMatchKey, filterRemapsForContext, type KeyRemapType, type RemapConflict, type RemapContext } from "@/lib/remap-utils";
import { syncActivePresetSnapshot, type PresetSyncKind } from "@/lib/preset-utils";
import { parseFingerAssignments } from "@/lib/preset-read";
import { validateFingerAssignmentsJson } from "@/lib/finger-assignments";
import { SAVE_LIMITS, formString } from "@/lib/save-limits";
import { isValidRemapInputs, isValidCustomKeyInputs, isValidCustomActionInputs } from "@/lib/keybindings-payload";
import { PresetSelector, PresetSelectorSkeleton } from "@/components/preset-selector";
import { PresetSwitchLock } from "@/components/preset-switch-lock";
import { RemapViewToggle } from "@/components/remap-view-toggle";
import { MeErrorBoundary } from "@/components/me/me-error-boundary";

/** カスタムアクションのカテゴリに対応する翻訳キー（SelectValue と SelectItem で共用） */
const CUSTOM_ACTION_CATEGORIES = ["other", "macro", "tool"] as const;
const CUSTOM_ACTION_CATEGORY_LABEL_KEYS: Record<(typeof CUSTOM_ACTION_CATEGORIES)[number], MessageKey> = {
  other: "meKeybindings.categoryOther",
  macro: "meKeybindings.categoryMacro",
  tool: "meKeybindings.categoryTool",
};

/** プリセットのコピー対象に対応する翻訳キー（SelectValue と SelectItem で共用） */
const COPY_TARGET_OPTIONS = ["all", "keybindings", "remaps", "fingers"] as const;
const COPY_TARGET_LABEL_KEYS: Record<(typeof COPY_TARGET_OPTIONS)[number], MessageKey> = {
  all: "meKeybindings.all",
  keybindings: "meKeybindings.keybindingsOnly",
  remaps: "meKeybindings.remapsOnly",
  fingers: "meKeybindings.fingersOnly",
};

// 設定インポートのダイアログは開くときだけ読む（import-parser ごと別チャンクにする）
const ImportDialog = lazy(() =>
  import("@/components/import-dialog").then((m) => ({ default: m.ImportDialog })),
);

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meKeybindings.title") }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate, formAction, currentUrl, nextUrl }: ShouldRevalidateFunctionArgs) {
  // action の結果がある場合はデフォルトの動作に従う（/me/presets・/me/import の action は常に値を返すので、
  // プリセット切替・作成・削除と、プリセット行のインポート後の再検証はここで1回だけ走る）
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  // action が結果を返さずに終わった（throw した）場合の保険。/me/presets・/me/import への送信後は必ず取り直す
  if (formAction === "/me/presets" || formAction === "/me/import") {
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
  // 本物（下の default export）と同じ並び・高さ: 見出し（h1 32px ＋ 説明 20px）→ プリセット選択（ラベル 16px ＋ gap 4px ＋ セレクト 36px、
  // sm 未満は 44px）→ キーボードの欄（罫線 ＋ 見出し 28px ＋ 説明 20px ＋ 凡例 ＋ キーボード）→ フォルダ型タブ（帯 42px、sm 未満 50px、
  // 中身は p-4 sm:p-6、先頭の欄は罫線なし）
  return (
    <div className="space-y-7 sm:space-y-8 animate-in fade-in duration-200" aria-hidden="true">
      {/* Header */}
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-0 h-5 w-64 max-w-full" />
      </div>

      {/* プリセットセレクター */}
      <PresetSelectorSkeleton />

      {/* キーボードの欄（上罫線＋見出し＋説明＋凡例＋中身） */}
      <div className="space-y-4 border-t border-foreground/15 pt-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-5 w-72 max-w-full" />
        <Skeleton className="h-6 w-56 max-w-full" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>

      {/* タブ（帯 ＋ 内容は一体のカード） */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <Skeleton className="h-[42px] w-full rounded-none max-sm:h-[50px]" />
        <div className="space-y-4 border-t p-4 sm:p-6">
          <Skeleton className="h-7 w-32" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        </div>
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

/** 保存後の総数が上限を超えるときにトランザクションを中断する例外（削除だけ commit されるのを防ぐ） */
class SaveLimitExceededError extends Error {}

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
      const deleteIds = remapsData
        .filter((remap) => remap._delete && remap.id)
        .map((remap) => remap.id!);
      if (deleteIds.length > 0) {
        await tx
          .delete(keyRemaps)
          .where(and(eq(keyRemaps.userId, userId), inArray(keyRemaps.id, deleteIds)));
      }

      const existingRows = await tx.query.keyRemaps.findMany({
        where: eq(keyRemaps.userId, userId),
      });

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

        const existing = remap.id
          ? existingRows.find((r) => r.id === remap.id)
          : existingRows.find(
              (r) =>
                r.remapType === payload.remapType &&
                (r.sourceKey === sourceKeyNormalized || r.sourceKey === sourceKeyUpper)
            );

        resolved.push({
          id: existing?.id ?? createId(),
          createdAt: existing?.createdAt ?? now,
          payload,
        });
      }

      // 保存後の総数で上限を判定する（ペイロード件数だけでは、id 無しの行を繰り返し送って増やせる）。
      // existingRows は上の削除の後に読んでいるので、削除分は数えない
      const finalIds = new Set([...existingRows.map((r) => r.id), ...resolved.map((r) => r.id)]);
      if (finalIds.size > SAVE_LIMITS.remaps) throw new SaveLimitExceededError();

      if (resolved.length > 0) {
        await tx.delete(keyRemaps).where(
          and(
            eq(keyRemaps.userId, userId),
            inArray(keyRemaps.id, resolved.map((r) => r.id))
          )
        );
        await tx.insert(keyRemaps).values(
          resolved.map((row) => ({
            id: row.id,
            userId,
            ...row.payload,
            createdAt: row.createdAt,
            updatedAt: now,
          }))
        );
      }
    });
  } catch (e) {
    // UNIQUE 違反の catch はトランザクションの外側で行う
    // （内側で正常リターンすると削除だけが commit されるため）
    if (isUniqueConstraintError(e)) {
      return { error: t("meKeybindings.remapConflictError") };
    }
    if (e instanceof SaveLimitExceededError) {
      return { error: t("meKeybindings.limitExceeded") };
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
  // 行ごとの UPDATE（Turso では 1 件 = 1 HTTP 往復）を避け、CASE 式の単一 UPDATE にまとめる。
  // 同一 id が複数あれば後勝ち（従来の逐次 UPDATE と同じ最終状態）。
  const keyCodeById = new Map<string, string>();
  for (const update of updates) {
    if (options.normalizeEmptyToUnbound) {
      keyCodeById.set(update.id, update.keyCode || "_UNBOUND");
      continue;
    }
    if (!update.keyCode) continue;
    keyCodeById.set(update.id, update.keyCode);
  }
  if (keyCodeById.size === 0) return;

  const keyCodeCase = sql.join(
    [
      sql`CASE ${keybindings.id}`,
      ...Array.from(keyCodeById, ([id, keyCode]) => sql`WHEN ${id} THEN ${keyCode}`),
      sql`END`,
    ],
    sql` `
  );
  await db
    .update(keybindings)
    .set({ keyCode: keyCodeCase, updatedAt: now })
    .where(and(eq(keybindings.userId, userId), inArray(keybindings.id, Array.from(keyCodeById.keys()))));
}

/**
 * 書き込み文をまとめて実行する。トップレベルの DB では db.batch（1 HTTP リクエスト・原子的）、
 * トランザクション内では（呼び出し側のトランザクションに任せて）順次実行する。
 */
async function runWrites(db: DbClient, statements: BatchItem<"sqlite">[]) {
  if (statements.length === 0) return;
  if ("batch" in db) {
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return;
  }
  for (const statement of statements) await statement;
}

async function upsertFingerAssignments(
  db: DbClient,
  userId: string,
  fingerAssignmentsJson: string,
  now: Date
) {
  // player_configs.user_id は UNIQUE。select → update/insert の 2 往復を 1 文の upsert にする
  await db
    .insert(playerConfigs)
    .values({
      id: createId(),
      userId,
      fingerAssignments: fingerAssignmentsJson,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: playerConfigs.userId,
      set: { fingerAssignments: fingerAssignmentsJson, updatedAt: now },
    });
}

async function persistCustomKeys(
  db: DbClient,
  userId: string,
  keysData: CustomKeyMutationInput[],
  now: Date,
  /** 検証のために読んだ自分の既存行（往復を増やさず使い回す） */
  existing: Array<{ id: string }>
): Promise<{ limitExceeded: boolean }> {
  // 保存後の総数（既存 − 削除 + 新規）で上限を判定する。超過なら何も書かない
  const existingIds = new Set(existing.map((r) => r.id));
  const deletedIds = new Set(
    keysData.filter((ck) => ck._delete && ck.id && existingIds.has(ck.id)).map((ck) => ck.id!),
  );
  const inserts = keysData.filter((ck) => !ck._delete && !ck.id && ck.keyCode && ck.keyName).length;
  if (existing.length - deletedIds.size + inserts > SAVE_LIMITS.customKeys) {
    return { limitExceeded: true };
  }

  const statements: BatchItem<"sqlite">[] = [];
  for (const ck of keysData) {
    if (ck._delete && ck.id) {
      statements.push(
        db
          .delete(customKeys)
          .where(and(eq(customKeys.id, ck.id), eq(customKeys.userId, userId)))
      );
    } else if (ck.id) {
      statements.push(
        db.update(customKeys)
          .set({
            keyCode: ck.keyCode,
            keyName: ck.keyName,
            category: ck.category,
            updatedAt: now,
          })
          .where(and(eq(customKeys.id, ck.id), eq(customKeys.userId, userId)))
      );
    } else if (ck.keyCode && ck.keyName) {
      statements.push(
        db.insert(customKeys).values({
          id: createId(),
          userId,
          keyCode: ck.keyCode,
          keyName: ck.keyName,
          category: ck.category,
          createdAt: now,
          updatedAt: now,
        })
      );
    }
  }
  await runWrites(db, statements);
  return { limitExceeded: false };
}

async function persistCustomActions(
  db: DbClient,
  userId: string,
  actionsData: CustomActionMutationInput[],
  now: Date
): Promise<{ limitExceeded: boolean }> {
  const existing = await db.query.customActions.findMany({
    where: eq(customActions.userId, userId),
    columns: { id: true },
  });
  const existingIds = new Set(existing.map((r) => r.id));
  const deletedIds = new Set(
    actionsData.filter((a) => a._delete && a.id && existingIds.has(a.id)).map((a) => a.id!),
  );
  const inserts = actionsData.filter((a) => !a._delete && !a.id && a.actionName && a.triggerKey).length;
  if (existing.length - deletedIds.size + inserts > SAVE_LIMITS.customActions) {
    return { limitExceeded: true };
  }

  const statements: BatchItem<"sqlite">[] = [];
  for (const action of actionsData) {
    if (action._delete && action.id) {
      statements.push(
        db
          .delete(customActions)
          .where(and(eq(customActions.id, action.id), eq(customActions.userId, userId)))
      );
    }
  }

  let order = 0;
  for (const action of actionsData) {
    if (action._delete) continue;
    if (!action.actionName || !action.triggerKey) continue;

    const triggerKeyNormalized = normalizeKeyCombination(action.triggerKey);

    if (action.id) {
      statements.push(
        db
          .update(customActions)
          .set({
            actionName: action.actionName,
            description: action.description || null,
            category: action.category,
            triggerKey: triggerKeyNormalized,
            displayOrder: order++,
            updatedAt: now,
          })
          .where(and(eq(customActions.id, action.id), eq(customActions.userId, userId)))
      );
      continue;
    }

    statements.push(
      db.insert(customActions).values({
        id: createId(),
        userId,
        actionName: action.actionName,
        description: action.description || null,
        category: action.category,
        triggerKey: triggerKeyNormalized,
        displayOrder: order++,
        createdAt: now,
        updatedAt: now,
      })
    );
  }
  await runWrites(db, statements);
  return { limitExceeded: false };
}

/** formData 由来の JSON 配列を安全にパースする（不正なら null）。 */
function parseJsonArray<T>(raw: string | null | undefined): T[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.every((el) => el !== null && typeof el === "object")
      ? (v as T[])
      : null;
  } catch {
    return null;
  }
}

/**
 * キーバインド更新の上限件数。CASE 式 UPDATE のバインド変数が件数に比例するため、
 * SQLite の変数上限に当たる前に弾く（実際のキー数は数百件未満）。
 */
const MAX_KEYBINDING_UPDATES = SAVE_LIMITS.keybindingUpdates;

/** キーバインド更新 payload を検証してパースする（不正・過大なら null）。 */
function parseKeybindingUpdates(raw: string | null | undefined): KeybindingUpdateInput[] | null {
  const updates = parseJsonArray<KeybindingUpdateInput>(raw);
  if (!updates || updates.length > MAX_KEYBINDING_UPDATES) return null;
  const valid = updates.every(
    (u) =>
      typeof u.id === "string" &&
      u.id.length <= SAVE_LIMITS.shortText &&
      typeof u.keyCode === "string" &&
      u.keyCode.length <= SAVE_LIMITS.shortText,
  );
  return valid ? updates : null;
}

/** fingerAssignments の JSON 文字列を検証する（値は有効な指の配列、件数・長さの上限つき）。 */
function isValidFingerAssignmentsJson(raw: string): boolean {
  return validateFingerAssignmentsJson(raw) !== null;
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

  // アクティブプリセットは 1 回だけ引き、競合検証（assertPresetIsActive 相当）・プリセット必須ゲート・
  // スナップショット同期（syncActivePresetSnapshot の activePresetId）で共有する
  const activePresetRow = await db.query.configPresets.findFirst({
    where: and(eq(configPresets.userId, user.id), eq(configPresets.isActive, true)),
    columns: { id: true },
  });
  // 送信 presetId が現在のアクティブと異なる（別タブでプリセット切替が起きた等）場合は弾く
  if (presetId && activePresetRow?.id !== presetId) {
    return { error: t("mePresets.staleSession") };
  }

  // このアクションの全 intent はライブ設定への書き込み＝アクティブプリセットの
  // スナップショット更新を伴うため、アクティブなプリセットが無い状態では一律で弾く
  // （既存データの読み込みは可能）。プリセットが無いまま書き込むと
  // syncActivePresetSnapshot が無言でスキップされ、後からプリセットを作るまで
  // どのプリセットにも属さないデータになってしまう。
  if (!activePresetRow) {
    return { error: t("meKeybindings.presetRequired") };
  }

  // キーバインド保存
  if (intent === "save-keybindings") {
    const updates = parseKeybindingUpdates(formData.get("keybindings") as string);
    if (!updates) return { error: t("meKeybindings.invalidPayload") };
    await persistKeybindingUpdates(db, user.id, updates, new Date(), {
      normalizeEmptyToUnbound: true,
    });
    await syncActivePresetSnapshot(db, user.id, ["keybindings"], { activePresetId: activePresetRow.id });

    return { success: true, message: t("meKeybindings.saveKeybindings") };
  }

  // リマップ保存
  if (intent === "save-remaps") {
    const remapsData = parseJsonArray<RemapMutationInput>(
      formString(formData, "remaps"),
    );
    if (!remapsData || !isValidRemapInputs(remapsData)) return { error: t("meKeybindings.invalidPayload") };

    const now = new Date();
    const remapError = await persistRemaps(t, db, user.id, remapsData, now);
    if (remapError) return { error: remapError.error };
    await syncActivePresetSnapshot(db, user.id, ["remaps"], { activePresetId: activePresetRow.id });

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
    await syncActivePresetSnapshot(db, user.id, ["fingers", "playerConfig"], { activePresetId: activePresetRow.id });

    return { success: true, message: t("meKeybindings.saveFingers") };
  }

  // 全て保存
  if (intent === "save-all") {
    const keybindingsJson = formData.get("keybindings") as string;
    const remapsJson = formData.get("remaps") as string;
    const fingerAssignmentsJson = formData.get("fingerAssignments") as string;
    const customActionsJson = formData.get("customActions") as string;
    const customKeysJson = formData.get("customKeys") as string;
    const now = new Date();

    // 事前パース・バリデーション（書き込みを始める前に不正 payload をすべて弾く）
    const remapsData = remapsJson ? parseJsonArray<RemapMutationInput>(remapsJson) : null;
    if (remapsJson && (!remapsData || !isValidRemapInputs(remapsData))) {
      return { error: t("meKeybindings.invalidPayload") };
    }

    const keybindingUpdates = keybindingsJson
      ? parseKeybindingUpdates(keybindingsJson)
      : null;
    if (keybindingsJson && !keybindingUpdates) return { error: t("meKeybindings.invalidPayload") };

    if (fingerAssignmentsJson && !isValidFingerAssignmentsJson(fingerAssignmentsJson)) {
      return { error: t("meKeybindings.invalidPayload") };
    }

    const customActionsData = customActionsJson
      ? parseJsonArray<CustomActionMutationInput>(customActionsJson)
      : null;
    if (customActionsJson && (!customActionsData || !isValidCustomActionInputs(customActionsData))) {
      return { error: t("meKeybindings.invalidPayload") };
    }

    const customKeysData = customKeysJson
      ? parseJsonArray<CustomKeyMutationInput>(customKeysJson)
      : null;
    // 自分の既存のカスタムキー。検証で「保存値と同じ値は通す」ために使い、上限の判定にも使い回す
    const existingCustomKeys = customKeysData
      ? await db.query.customKeys.findMany({
          where: eq(customKeys.userId, user.id),
          columns: { id: true, keyCode: true, keyName: true },
        })
      : [];
    if (
      customKeysJson &&
      (!customKeysData || !isValidCustomKeyInputs(customKeysData, new Map(existingCustomKeys.map((r) => [r.id, r]))))
    ) {
      return { error: t("meKeybindings.invalidPayload") };
    }

    // 変更履歴の内容
    const changes: KeybindingChangeId[] = [];
    if (keybindingsJson) changes.push("actions");
    if (remapsJson) changes.push("remaps");
    if (fingerAssignmentsJson) changes.push("fingers");
    if (customActionsJson) changes.push("customActions");
    if (customKeysJson) changes.push("customKeys");

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
          const result = await persistCustomActions(tx, user.id, customActionsData, now);
          if (result.limitExceeded) throw new SaveAllAbortError(t("meKeybindings.limitExceeded"));
        }

        // カスタムキー
        if (customKeysData) {
          const result = await persistCustomKeys(tx, user.id, customKeysData, now, existingCustomKeys);
          if (result.limitExceeded) throw new SaveAllAbortError(t("meKeybindings.limitExceeded"));
        }

        // 変更履歴を記録
        if (changes.length > 0) {
          await tx.insert(configHistory).values({
            id: createId(),
            userId: user.id,
            changeType: "keybinding",
            changeDescription: encodeKeybindingUpdate(changes),
            // クライアントの生ペイロードは保存しない（読む側が無く、保存のたびに DB が膨らむため）
            presetId: await resolveActivePublicPresetId(tx, user.id),
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
    if (customKeysJson) syncKinds.push("customKeys");
    if (syncKinds.length > 0) {
      await syncActivePresetSnapshot(db, user.id, syncKinds, { activePresetId: activePresetRow.id });
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
      // 取り込みは importFromLegacy が新しいプリセット（編集先）を作って完結する。
      // 旧アクティブへの同期は、非アクティブ化済みで no-op になるため呼ばない
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

  // カスタムアクション保存
  if (intent === "save-custom-actions") {
    const customActionsData = parseJsonArray<CustomActionMutationInput>(
      formString(formData, "customActions"),
    );
    if (!customActionsData || !isValidCustomActionInputs(customActionsData)) {
      return { error: t("meKeybindings.invalidPayload") };
    }

    const now = new Date();
    const persisted = await persistCustomActions(db, user.id, customActionsData, now);
    if (persisted.limitExceeded) return { error: t("meKeybindings.limitExceeded") };
    await syncActivePresetSnapshot(db, user.id, ["customActions"], { activePresetId: activePresetRow.id });

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

// 廃止済みアクション（表示から除外）
const deprecatedActions = ["toggleHud"];

// 操作割り当てタブの表示グループ。公開プロフィール
// （app/routes/player/profile.tsx の keybindingDisplayGroups）と同一の
// グルーピング・並び順にする（DB カテゴリではなく意味順の手書き分類）
const KEYBINDING_DISPLAY_GROUPS = [
  {
    key: "movement",
    labelKey: "playerProfile.movement",
    actions: ["forward", "back", "left", "right", "jump", "sneak", "sprint"],
  },
  {
    key: "inventory",
    labelKey: "playerProfile.inventory",
    actions: [
      "hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5",
      "hotbar6", "hotbar7", "hotbar8", "hotbar9",
      "swapHands", "inventory", "pickBlock", "drop",
    ],
  },
  {
    key: "combat-ui",
    labelKey: "playerProfile.combatAndUi",
    actions: ["attack", "use", "togglePerspective", "chat", "command", "fullscreen"],
  },
] as const;

/** コントローラーの操作の並び（DB カテゴリ準拠） */
const CONTROLLER_CATEGORY_ORDER = ["movement", "combat", "inventory", "ui"];

/**
 * 操作の表示グループ。ページの「操作割り当て」一覧とキー設定ダイアログの両方がこれを使い、
 * 分類・並び順をそろえる。キーボード/マウスはプロフィールと同一の3グループ（移動 / インベントリ /
 * 戦闘・UI）・意味順、コントローラーは DB カテゴリ準拠
 */
function groupKeybindingsForDisplay<KB extends { action: string; category: string }>(
  t: Translator,
  kbs: KB[],
  isControllerMode: boolean,
): { key: string; label: string; bindings: KB[] }[] {
  if (isControllerMode) {
    return CONTROLLER_CATEGORY_ORDER.map((category) => ({
      key: category,
      label: categoryLabelsOf(t)[category],
      bindings: kbs.filter((kb) => kb.category === category),
    }));
  }
  const byAction = new Map(kbs.map((kb) => [kb.action, kb]));
  return KEYBINDING_DISPLAY_GROUPS.map((group) => ({
    key: group.key,
    label: t(group.labelKey),
    bindings: group.actions
      .map((action) => byAction.get(action))
      .filter((kb): kb is KB => kb !== undefined),
  }));
}

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

const MODIFIER_CODES = new Set([
  "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
  "AltLeft", "AltRight", "MetaLeft", "MetaRight",
]);

// キーバインド行コンポーネント（フォーカス状態をローカルで持つため独立コンポーネントに分割。
// .map() コールバック内での useState 呼び出しは Rules of Hooks 違反になるため避ける）
function KeybindingRow({
  kb,
  isControllerMode,
  updateKeybindingKey,
  getKeyLabelWithCustom,
  getSharedActionLabels,
  onAnnounce,
}: {
  kb: { id: string; action: string; keyCode: string };
  isControllerMode: boolean;
  updateKeybindingKey: (keybindingId: string, newKeyCode: string) => void;
  getKeyLabelWithCustom: (keyCode: string) => string;
  /** 指定キーを、この行以外で使っている操作の名前（キー編集ダイアログの共有判定と同じ「同じキー」） */
  getSharedActionLabels: (keybindingId: string, keyCode: string) => string[];
  /** 確定結果をページ共通のライブ領域へ伝える（行ごとに領域を持たない） */
  onAnnounce: (message: string) => void;
}) {
  const t = useT();
  // フォーカスだけではキャプチャしない。クリック / Enter / Space で明示的に開始する
  const [isCapturing, setIsCapturing] = useState(false);
  const actionLabel = getActionLabel(t, kb.action);
  const currentKeyLabel = isUnbound(kb.keyCode)
    ? t("meKeybindings.notUsed")
    : kb.keyCode
      ? getKeyLabelWithCustom(kb.keyCode)
      : t("meKeybindings.unassigned");
  // 確定結果をスクリーンリーダーへ伝える（フォーカスはボタンに残す）
  const commitKey = (keyCode: string) => {
    updateKeybindingKey(kb.id, keyCode);
    setIsCapturing(false);
    const key = getKeyLabelWithCustom(keyCode);
    const shared = getSharedActionLabels(kb.id, keyCode);
    onAnnounce(
      shared.length > 0
        ? t("meKeybindings.keyAssignedSharedAnnounce", {
            action: actionLabel,
            key,
            actions: shared.join(t("common.listSeparatorComma")),
          })
        : t("meKeybindings.keyAssignedAnnounce", { action: actionLabel, key })
    );
  };
  const sharedLabels = kb.keyCode ? getSharedActionLabels(kb.id, kb.keyCode) : [];
  return (
    <div className="flex items-center justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <span className="text-sm">{actionLabel}</span>
        {sharedLabels.length > 0 && (
          <p className="mt-0.5 flex items-start gap-1 text-xs text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {t("meKeybindings.sharedKeyConflictWith", {
                actions: sharedLabels.join(t("common.listSeparatorComma")),
              })}
            </span>
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        {isControllerMode ? (
          /* コントローラーモード: ドロップダウンでボタン選択 */
          <Select
            value={kb.keyCode || ""}
            onValueChange={(value) => updateKeybindingKey(kb.id, value)}
          >
            <SelectTrigger aria-label={actionLabel} className="w-32 h-8 max-sm:h-11">
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
            aria-label={
              isCapturing
                ? t("meKeybindings.pressKeyToAssign")
                : t("meKeybindings.keyRowAriaLabel", { action: actionLabel, key: currentKeyLabel })
            }
            onClick={() => {
              onAnnounce("");
              setIsCapturing(true);
            }}
            onBlur={() => setIsCapturing(false)}
            onKeyDown={(e) => {
              if (!isCapturing) {
                // 開始は Enter / Space のみ（他のキーは何もしない）
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setIsCapturing(true);
                }
                return;
              }
              if (e.key === "Tab") {
                // Tab / Shift+Tab はキャプチャせず、キャプチャを抜けてフォーカス移動に任せる
                setIsCapturing(false);
                return;
              }
              e.preventDefault();
              if (e.repeat) return;
              if (e.key === "Escape") {
                // Esc はキャンセル（何も変更しない）。解除は × ボタンから
                setIsCapturing(false);
                return;
              }
              // 修飾キーは keyup まで確定しない（他のキーとの併用で誤って割り当てないため）
              if (MODIFIER_CODES.has(e.code)) return;
              commitKey(e.code);
            }}
            onKeyUp={(e) => {
              // Space で確定した直後の keyup で Firefox が click を発火し、キャプチャが再開するのを防ぐ
              // （確定後もフォーカスを残すため）
              if (!isCapturing) {
                if (e.key === " ") e.preventDefault();
                return;
              }
              if (!MODIFIER_CODES.has(e.code)) return;
              e.preventDefault();
              commitKey(e.code);
            }}
            className={cn(
              "min-w-32 h-8 max-sm:h-11 px-3 rounded-md border text-sm transition-colors",
              "bg-secondary/50 hover:bg-secondary/70",
              "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
              isCapturing ? "border-primary" : "border-input"
            )}
          >
            {isCapturing ? (
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
          aria-label={t("meKeybindings.unassignAction", { action: actionLabel })}
          title={t("meKeybindings.unassignAction", { action: actionLabel })}
          onClick={() => updateKeybindingKey(kb.id, UNBOUND_KEY)}
          disabled={!kb.keyCode || isUnbound(kb.keyCode)}
          className={cn(
            "size-8 max-sm:size-11 shrink-0 text-muted-foreground hover:text-destructive focus-visible:text-destructive",
            (!kb.keyCode || isUnbound(kb.keyCode)) && "invisible"
          )}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

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
            aria-label={t("meKeybindings.actionNameAria")}
            className="text-sm"
          />
        </div>
        <Select
          value={action.category}
          onValueChange={(value: "other" | "macro" | "tool") => onUpdate(index, { category: value })}
        >
          <SelectTrigger aria-label={t("meKeybindings.categoryAria")} className="w-28">
            <SelectValue>
              {t(CUSTOM_ACTION_CATEGORY_LABEL_KEYS[action.category])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CUSTOM_ACTION_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>{t(CUSTOM_ACTION_CATEGORY_LABEL_KEYS[category])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDelete(index)}
          aria-label={t("meKeybindings.deleteCustomActionAria")}
          className="text-destructive hover:text-destructive shrink-0 max-sm:size-11"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
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
          ariaLabel={t("meKeybindings.triggerKey")}
        />
      </div>
      <div>
        <Input
          value={action.description || ""}
          onChange={(e) => onUpdate(index, { description: e.target.value || null })}
          placeholder={t("meKeybindings.descriptionOptional")}
          aria-label={t("meKeybindings.descriptionOptional")}
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
          aria-label={t("meKeybindings.deleteCustomActionAria")}
          className="size-7 max-sm:size-11 p-0 text-destructive hover:text-destructive ml-auto"
          onClick={() => onDelete(index)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {/* 名前・カテゴリ行 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <Input
            value={action.actionName}
            onChange={(e) => onUpdate(index, { actionName: e.target.value })}
            placeholder={t("meKeybindings.actionNamePlaceholder")}
            aria-label={t("meKeybindings.actionNameAria")}
            className="text-sm h-8 max-sm:h-11"
          />
        </div>
        <Select
          value={action.category}
          onValueChange={(value: "other" | "macro" | "tool") => onUpdate(index, { category: value })}
        >
          <SelectTrigger aria-label={t("meKeybindings.categoryAria")} className="w-28 h-8 max-sm:h-11 text-sm">
            <SelectValue>
              {t(CUSTOM_ACTION_CATEGORY_LABEL_KEYS[action.category])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CUSTOM_ACTION_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>{t(CUSTOM_ACTION_CATEGORY_LABEL_KEYS[category])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Input
        value={action.description || ""}
        onChange={(e) => onUpdate(index, { description: e.target.value || null })}
        placeholder={t("meKeybindings.descriptionOptional")}
        aria-label={t("meKeybindings.descriptionOptional")}
        className="text-sm h-8 max-sm:h-11"
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
    <NoticeBanner tone="info" icon={AlertCircle}>
      <span className="flex flex-wrap items-center gap-1">
        <span>{t("meKeybindings.presetRequiredNotice")}</span>
        <Link to="/me/presets" className="underline underline-offset-2">
          {t("meKeybindings.presetRequiredLink")}
        </Link>
      </span>
    </NoticeBanner>
  );
}

export default function KeybindingsPage() {
  const t = useT();
  const { keybindings: kbs, playerConfig, keyRemaps: initialRemaps, customKeys: initialCustomKeys, customActions: initialCustomActions, legacyApiUrl, activePreset, presets, inputMethod } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const importFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  // プリセット行のインポートダイアログ。旧 URL /me/import は ?import=1 付きでここへ転送され、開いた状態で始まる
  const [searchParams, setSearchParams] = useSearchParams();
  // 開閉は「ボタンで開いた」か「URL に ?import=1 が付いている」かの導出（クライアント遷移で付いたときも開く）
  const [manualImportOpen, setManualImportOpen] = useState(false);
  const importParamOn = searchParams.get("import") === "1";
  // ?import=1 で開いたダイアログを閉じた直後は、URL から import が消えるまでのあいだ閉じたままにする
  const [importParamDismissed, setImportParamDismissed] = useState(false);
  if (importParamDismissed && !importParamOn) setImportParamDismissed(false);
  const importDialogOpen = manualImportOpen || (importParamOn && !importParamDismissed);
  // 初めて開くときにだけダイアログ（と import-parser）を読み込み、閉じたあとはマウントしたままにして閉じる演出・フォーカス復帰を保つ
  const [importDialogMounted, setImportDialogMounted] = useState(false);
  if (importDialogOpen && !importDialogMounted) setImportDialogMounted(true);
  // 閉じたあとのフォーカスの戻り先。0件の警告帯と通常の行のどちらの位置でも同じ ref を付ける
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const handleImportDialogOpenChange = useCallback(
    (open: boolean) => {
      setManualImportOpen(open);
      if (!open && searchParams.has("import")) {
        setImportParamDismissed(true);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("import");
            return next;
          },
          { replace: true, preventScrollReset: true },
        );
      }
    },
    [searchParams, setSearchParams],
  );
  // リマップ・カスタムキー・カスタムアクションはプリセットに紐づくため、
  // アクティブなプリセットが無い間は閲覧のみ（サーバー側でも同じ判定で拒否する）
  const canEditPresetData = !!activePreset;
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const prevImportDataRef = useRef<typeof importFetcher.data>(undefined);
  const isInitializedRef = useRef(false);

  // ========== State ==========
  // キーバインドのローカル変更
  const [keybindingChanges, setKeybindingChanges] = useState<Record<string, string>>({});
  // リマップ・指割り当て・カスタムキー・カスタムアクションのローカル下書き。
  // loader の値が変わったとき（プリセット切替・保存後・タブ復帰の再検証）は、
  // 未変更の間だけ新しい値へ置き換える（入力中の編集を黙って消さない）
  const remapsSource = useMemo(() => dbRemapsToUiRemaps(initialRemaps), [initialRemaps]);
  const fingerAssignmentsSource = useMemo(
    () => parseFingerAssignments(playerConfig?.fingerAssignments),
    [playerConfig?.fingerAssignments],
  );
  const customKeysSource = useMemo<CustomKeyEntry[]>(
    () =>
      initialCustomKeys.map((ck) => ({
        id: ck.id,
        keyCode: ck.keyCode,
        keyName: ck.keyName,
        category: ck.category as "mouse" | "keyboard",
      })),
    [initialCustomKeys],
  );
  const customActionsSource = useMemo<CustomActionEntry[]>(
    () =>
      initialCustomActions.map((ca) => ({
        id: ca.id,
        actionName: ca.actionName,
        description: ca.description,
        category: ca.category as "other" | "macro" | "tool",
        triggerKey: ca.triggerKey,
        displayOrder: ca.displayOrder,
      })),
    [initialCustomActions],
  );
  const { draft: localRemaps, setDraft: setLocalRemaps } = useLoaderSyncedDraft<RemapEntry[]>(remapsSource, { resetKey: activePreset?.id ?? null });
  const { draft: localFingerAssignments, setDraft: setLocalFingerAssignments } =
    useLoaderSyncedDraft<FingerAssignmentMap>(fingerAssignmentsSource, { resetKey: activePreset?.id ?? null });
  const { draft: localCustomKeys, setDraft: setLocalCustomKeys } =
    useLoaderSyncedDraft<CustomKeyEntry[]>(customKeysSource, { resetKey: activePreset?.id ?? null });
  const { draft: localCustomActions, setDraft: setLocalCustomActions } =
    useLoaderSyncedDraft<CustomActionEntry[]>(customActionsSource, { resetKey: activePreset?.id ?? null });

  // ダイアログ関連
  const [editingKeyCode, setEditingKeyCode] = useState<string | null>(null);
  const keyModalReturnFocusRef = useRef<{ el: HTMLElement | null; keyCode: string } | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  // 行ごとの確定結果を読み上げるページ共通のライブ領域（行ごとに持つと空の aria-live が行数だけ並ぶ）
  const [keyAnnouncement, setKeyAnnouncement] = useState("");
  const [modalDraftKeybindingChanges, setModalDraftKeybindingChanges] = useState<Record<string, string> | null>(null);
  const [modalDraftRemaps, setModalDraftRemaps] = useState<RemapEntry[] | null>(null);
  const [modalDraftFingerAssignments, setModalDraftFingerAssignments] = useState<FingerAssignmentMap | null>(null);
  const [modalDraftCustomActions, setModalDraftCustomActions] = useState<CustomActionEntry[] | null>(null);

  // 編集先プリセットが変わったら（別タブでの切替など）、別のプリセットの内容を引き継がないよう
  // hook 以外の下書き（操作割り当ての差分・キーのダイアログの下書き）も捨て、開いているダイアログを閉じる
  const activePresetId = activePreset?.id ?? null;
  const [draftPresetId, setDraftPresetId] = useState(activePresetId);
  if (draftPresetId !== activePresetId) {
    setDraftPresetId(activePresetId);
    setKeybindingChanges({});
    setEditingKeyCode(null);
    setIsCapturing(false);
    setModalDraftKeybindingChanges(null);
    setModalDraftRemaps(null);
    setModalDraftFingerAssignments(null);
    setModalDraftCustomActions(null);
  }

  // タブの状態
  const [activeTab, setActiveTab] = useState("keybindings");
  // md 未満のキーボード表示。既定は左手側を大きく見せる（キーを押せる）。true で全体を横スクロールで見る
  const [mobileFullKeyboard, setMobileFullKeyboard] = useState(false);

  // コピー元プリセット選択ダイアログ
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<"keybindings" | "remaps" | "fingers" | "all">("all");

  // 保存後の loader 再取得（loading）が終わるまでを保存中に含める。終わった時点で下書きの基準値が保存値へ進むので、
  // 保存バーの「未保存」がちらつかず、離脱確認の「保存して移動」も再取得の完了を待ってから判定できる
  const isSubmitting = fetcher.state !== "idle";
  const data = fetcher.data;

  // 初期化済みフラグを設定（初回レンダリング後）
  useEffect(() => {
    isInitializedRef.current = true;
  }, []);

  // キーバインドが loader で更新されたら、保存値と同じになった変更だけを下書き（差分）から外す。
  // 未保存の編集は残す（タブ復帰の再検証で消さない）。保存成功時は下の効果がすべてクリアする
  useEffect(() => {
    setKeybindingChanges((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;
      const saved = new Map(kbs.map((kb) => [kb.id, kb.keyCode]));
      const kept = entries.filter(([id, keyCode]) => saved.has(id) && saved.get(id) !== keyCode);
      return kept.length === entries.length ? prev : Object.fromEntries(kept);
    });
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
      setLocalRemaps(remapsSource);
      setLocalFingerAssignments(fingerAssignmentsSource);
      setLocalCustomActions(customActionsSource);
      setLocalCustomKeys(customKeysSource);
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [data, fetcher.state, remapsSource, fingerAssignmentsSource, customActionsSource, customKeysSource]);

  // ========== Computed Values ==========
  const isControllerMode = inputMethod === "controller";

  // 入力方法に応じたアクションをフィルタリング
  const allowedActions = isControllerMode
    ? (CONTROLLER_ACTIONS as readonly string[])
    : (KEYBOARD_MOUSE_ACTIONS as readonly string[]);

  const validKeybindings = useMemo(
    () =>
      kbs.filter(
        (kb) => !deprecatedActions.includes(kb.action) && allowedActions.includes(kb.action)
      ),
    [kbs, isControllerMode]
  );

  // ローカル変更を適用したキーバインドリスト
  const keybindingsWithLocalChanges = useMemo(() =>
    validKeybindings.map((kb) => ({
      ...kb,
      keyCode: keybindingChanges[kb.id] ?? kb.keyCode,
    })),
    [validKeybindings, keybindingChanges]
  );

  // キーバインドの action → keyCode マップ（VirtualKeyboard/Numpad/Mouse 共通）
  const keybindingsMap = useMemo(
    () => keybindingsToMap(keybindingsWithLocalChanges),
    [keybindingsWithLocalChanges]
  );

  // 操作割り当てタブの表示グループ（キー設定ダイアログと同じ定義。groupKeybindingsForDisplay）
  const displayGroups = useMemo(
    () => groupKeybindingsForDisplay(t, keybindingsWithLocalChanges, isControllerMode),
    [t, keybindingsWithLocalChanges, isControllerMode],
  );

  // 操作割り当てタブの行で「同じキーを他の操作も使っている」を出すための、キー → 操作名の対応（未割り当ては除く）
  const actionLabelsByKey = useMemo(() => {
    const map = new Map<string, { id: string; label: string }[]>();
    for (const kb of keybindingsWithLocalChanges) {
      if (!kb.keyCode || isUnbound(kb.keyCode)) continue;
      const list = map.get(kb.keyCode) ?? [];
      list.push({ id: kb.id, label: getActionLabel(t, kb.action) });
      map.set(kb.keyCode, list);
    }
    return map;
  }, [keybindingsWithLocalChanges, t]);
  const getSharedActionLabels = useCallback(
    (keybindingId: string, keyCode: string) => {
      if (isUnbound(keyCode)) return [];
      return (actionLabelsByKey.get(keyCode) ?? [])
        .filter((e) => e.id !== keybindingId)
        .map((e) => e.label);
    },
    [actionLabelsByKey],
  );

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

  const hasCustomKeyChanges = useMemo(() => {
    const originalKeyMap = new Map(initialCustomKeys.map((k) => [k.id, k]));
    for (const ck of localCustomKeys) {
      if (ck._isNew) return true;
      if (ck._delete) return true;
      if (!ck.id) return true;
      const original = originalKeyMap.get(ck.id);
      if (!original) return true;
      if (
        original.keyCode !== ck.keyCode ||
        original.keyName !== ck.keyName ||
        original.category !== ck.category
      ) {
        return true;
      }
    }
    return false;
  }, [localCustomKeys, initialCustomKeys]);

  const hasUnsavedChanges =
    hasKeybindingChanges || hasRemapChanges || hasFingerChanges || hasCustomActionChanges || hasCustomKeyChanges;

  // 現在選択中のキーに関するデータ
  // 複数の操作が同じキーに割り当てられている場合はすべて取得
  const selectedKeyBindings = editingKeyCode
    ? keybindingsWithLocalChanges.filter((kb) => kb.keyCode === editingKeyCode)
    : [];

  // 有効なカスタムキー（削除されていないもの）
  const activeCustomKeys = useMemo(
    () => localCustomKeys.filter((ck) => !ck._delete),
    [localCustomKeys]
  );

  // キーボードカテゴリのカスタムキー（VirtualKeyboard）
  const keyboardCustomKeys = useMemo(
    () =>
      activeCustomKeys
        .filter((ck) => ck.category === "keyboard")
        .map((ck) => ({ code: ck.keyCode, label: ck.keyName })),
    [activeCustomKeys]
  );

  // 全カスタムボタン（VirtualMouse）
  const mouseCustomButtons = useMemo(
    () =>
      activeCustomKeys.map((ck) => ({
        code: ck.keyCode,
        label: ck.keyName,
        category: ck.category,
      })),
    [activeCustomKeys]
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

  // キー設定ダイアログの操作の一覧。ページの「操作割り当て」と同じ分類・並び順で出す
  const modalDisplayGroups = useMemo(
    () => groupKeybindingsForDisplay(t, modalKeybindingsWithLocalChanges, isControllerMode),
    [t, modalKeybindingsWithLocalChanges, isControllerMode],
  );

  const modalAssignedCountOnKey = useMemo(
    () => (editingKeyCode ? countAssignedToKey(modalKeybindingsWithLocalChanges, editingKeyCode) : 0),
    [editingKeyCode, modalKeybindingsWithLocalChanges],
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

  // ダイアログを開いた時点（＝ページ状態の複製）から下書きが変わっているか
  const isKeyModalDirty =
    (modalDraftKeybindingChanges !== null &&
      JSON.stringify(modalDraftKeybindingChanges) !== JSON.stringify(keybindingChanges)) ||
    (modalDraftRemaps !== null && JSON.stringify(modalDraftRemaps) !== JSON.stringify(localRemaps)) ||
    (modalDraftFingerAssignments !== null &&
      JSON.stringify(modalDraftFingerAssignments) !== JSON.stringify(localFingerAssignments)) ||
    (modalDraftCustomActions !== null &&
      JSON.stringify(modalDraftCustomActions) !== JSON.stringify(localCustomActions));

  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  // Esc / 外側クリック / キャンセルからの閉じ。下書きが変わっていれば破棄確認を挟む
  const requestCloseKeyModal = useCallback(() => {
    if (isKeyModalDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    closeKeyModal();
  }, [isKeyModalDirty, closeKeyModal]);

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
    // Dialog は trigger を持たない（open を state で制御）ので、閉じたときの戻り先をここで覚える
    const active = document.activeElement;
    keyModalReturnFocusRef.current = {
      el: active instanceof HTMLElement && active !== document.body ? active : null,
      keyCode,
    };
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

  // 指割り当て（複数可）を更新。空配列ならキーごと削除。配列は正準順（FINGER_OPTIONS）に揃える
  const modalUpdateFingerAssignment = useCallback((keyCode: string, fingers: FingerType[]) => {
    setModalDraftFingerAssignments((prev) => {
      const base = prev ?? localFingerAssignments;
      const updated = { ...base };
      if (fingers.length === 0) {
        delete updated[keyCode];
      } else {
        updated[keyCode] = sortFingers(fingers);
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

  // 「元に戻す」の押下時点の基準値（loader の再検証で進んでいれば古い下書きを被せない）
  const latestBasesRef = useRef({ remapsSource, fingerAssignmentsSource, customActionsSource, customKeysSource });
  latestBasesRef.current = { remapsSource, fingerAssignmentsSource, customActionsSource, customKeysSource };

  // 変更を取り消す（取り消し前の下書きをまとめて取っておき、元に戻す関数を返す）
  const resetChanges = useCallback(() => {
    const prev = {
      keybindingChanges,
      remaps: localRemaps,
      fingerAssignments: localFingerAssignments,
      customActions: localCustomActions,
      customKeys: localCustomKeys,
    };
    const bases = { remapsSource, fingerAssignmentsSource, customActionsSource, customKeysSource };
    setKeybindingChanges({});
    setLocalRemaps(remapsSource);
    setLocalFingerAssignments(fingerAssignmentsSource);
    setLocalCustomActions(customActionsSource);
    setLocalCustomKeys(customKeysSource);
    return () => {
      const latest = latestBasesRef.current;
      if (
        !jsonEqual(latest.remapsSource, bases.remapsSource) ||
        !jsonEqual(latest.fingerAssignmentsSource, bases.fingerAssignmentsSource) ||
        !jsonEqual(latest.customActionsSource, bases.customActionsSource) ||
        !jsonEqual(latest.customKeysSource, bases.customKeysSource)
      ) {
        return false;
      }
      setKeybindingChanges(prev.keybindingChanges);
      setLocalRemaps(prev.remaps);
      setLocalFingerAssignments(prev.fingerAssignments);
      setLocalCustomActions(prev.customActions);
      setLocalCustomKeys(prev.customKeys);
      return true;
    };
  }, [
    keybindingChanges,
    localRemaps,
    localFingerAssignments,
    localCustomActions,
    localCustomKeys,
    remapsSource,
    fingerAssignmentsSource,
    customActionsSource,
    customKeysSource,
  ]);

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

    // カスタムキーは変更があるときだけ送る（変更履歴に「カスタムキー」を毎回残さない）
    if (hasCustomKeyChanges) {
      formData.set("customKeys", JSON.stringify(localCustomKeys));
    }

    fetcher.submit(formData, { method: "post" });
  }, [fetcher, keybindingChanges, localRemaps, localFingerAssignments, localCustomActions, localCustomKeys, hasCustomKeyChanges, activePreset, keyboardLayout]);

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
        const fingerAssignmentsDataParsed = parseFingerAssignments(preset.fingerAssignmentsData);
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

  return (
    <div className="space-y-7 sm:space-y-8 pb-24">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {keyAnnouncement}
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("meKeybindings.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("meKeybindings.pageDescription")}
          </p>
        </div>
        {/* 開発用デバッグボタン（旧 API からの取り込み。プリセット行の「インポート」＝ファイルからの取り込みとは別物） */}
        {import.meta.env.DEV && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRevalidate}
              disabled={revalidator.state === "loading"}
              className="max-sm:min-h-11"
            >
              Reload (dev)
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleImportLegacy}
              disabled={importFetcher.state !== "idle" || !legacyApiUrl || !canEditPresetData}
              className="max-sm:min-h-11"
            >
              <Download className={cn("mr-1 h-4 w-4", importFetcher.state !== "idle" && "animate-pulse")} />
              Legacy API import (dev)
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
        extraActions={({ disabled, describedBy }) => (
          // ダイアログ本体は下で1回だけ置く。ここはトリガーのボタンだけ（0件の警告帯と通常の行で位置が変わっても、ダイアログは再マウントされない）
          <Button
            ref={importTriggerRef}
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-describedby={disabled ? describedBy : undefined}
            onClick={() => handleImportDialogOpenChange(true)}
            className="max-sm:min-h-11"
          >
            <FileInput className="h-4 w-4 sm:mr-2" aria-hidden />
            <span>{t("meImport.importButton")}</span>
          </Button>
        )}
        onCopyFromOther={presets.length > 1 ? () => {
          setCopyTarget("all");
          setCopyDialogOpen(true);
        } : undefined}
      />
      {importDialogMounted && (
        <Suspense fallback={null}>
          <ImportDialog
            open={importDialogOpen}
            onOpenChange={handleImportDialogOpenChange}
            returnFocusRef={importTriggerRef}
            targetPresetName={activePreset?.name ?? null}
            targetPresetId={activePreset?.id ?? null}
            // 取り込み後の再検証は shouldRevalidate が /me/import の action 結果で行うので、ここでは呼ばない
          />
        </Suspense>
      )}

      {/* プリセット切替中はキーボードビュー・入力欄をロックする */}
      <PresetSwitchLock locked={presetSwitching}>
      {/* キーボードビューとタブの間の余白（ページ直下の space-y-6 相当）を維持する */}
      <div className="space-y-7 sm:space-y-8">
      {/* コントローラーモード: コントローラービュー */}
      {isControllerMode ? (
        <PageSection
          id="controller-view"
          title={t("meKeybindings.controllerView")}
        >
            <p className="text-sm text-muted-foreground">{t("meKeybindings.controllerViewDesc")}</p>
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
                        onClick={() => handleKeyClick(keyCode)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl border transition-colors",
                          "bg-secondary/30 hover:bg-secondary/50",
                          binding ? "border-primary/30" : "border-input"
                        )}
                      >
                        <span className="font-mono text-sm font-medium">{getKeyLabel(t, keyCode)}</span>
                        <span className={cn("text-xs", !binding && "text-muted-foreground")}>
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
                        onClick={() => handleKeyClick(keyCode)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl border transition-colors",
                          "bg-secondary/30 hover:bg-secondary/50",
                          binding ? "border-primary/30" : "border-input"
                        )}
                      >
                        <span className="font-mono text-sm font-medium">{getKeyLabel(t, keyCode)}</span>
                        <span className={cn("text-xs", !binding && "text-muted-foreground")}>
                          {binding ? getActionLabel(t, binding.action) : t("meKeybindings.unassigned")}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* スティックの説明 */}
                <NoticeBanner tone="info" className="mt-4">
                  <div className="font-medium mb-1">{t("meKeybindings.stickFixed")}</div>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>{t("meKeybindings.leftStickDesc")}</li>
                    <li>{t("meKeybindings.rightStickDesc")}</li>
                  </ul>
                </NoticeBanner>
              </div>
            </div>
        </PageSection>
      ) : (
        /* キーボード/マウスモード: 仮想キーボード */
        <PageSection id="keyboard-view" title={t("meKeybindings.keyboardView")}>
            <p className="text-sm text-muted-foreground">{t("meKeybindings.keyboardViewDesc")}</p>
            <div className="flex flex-wrap items-center gap-3">
              {/* Trigger/Chat 表示切替（種別付きリマップがある場合のみ。プロフィールと同条件） */}
              {hasTypedRemaps && (
                <RemapViewToggle value={remapView} onChange={setRemapView} />
              )}
              <FingerLegend />
            </div>
            <div className="flex flex-col items-start gap-4">
              {/* 仮想キー約100個を飛ばして操作割り当てへ移動するスキップリンク */}
              <a
                href="#keybindings-actions-heading"
                onClick={(e) => {
                  e.preventDefault();
                  flushSync(() => setActiveTab("keybindings"));
                  document.getElementById("keybindings-actions-heading")?.focus();
                }}
                className="sr-only rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              >
                {t("meKeybindings.skipToActions")}
              </a>
              {/* メインキーボード。md 未満は左手側だけを大きく見せてキーを押せるようにし、
                  全体は横スクロール表示へ切り替えられる。2つの表示は CSS で出し分ける（md 以上は常に横スクロール表示） */}
              {!mobileFullKeyboard && (
                <div className="w-full min-w-0 space-y-2 md:hidden">
                  <KeyboardScaledPreview
                    interactive
                    dialogTitle={t("meKeybindings.keyboardView")}
                    // 押せる表示はキーを 44px 以上にする。公開側の 478.5px だと 375 幅（枠 343px）で 43.0px になるので、
                    // 左手側の最右の B（447.5px）が収まる 466px まで詰める（343/466×60 ≒ 44.2px）
                    crop={{ ...LEFT_HAND_CROP, width: 466, surface: "background" }}
                    unmeasuredClassName="max-md:aspect-[479/370]"
                  >
                    <VirtualKeyboard
                      layout={keyboardLayout}
                      keybindings={keybindingsMap}
                      fingerAssignments={localFingerAssignments}
                      remaps={keyboardRemaps}
                      customKeys={keyboardCustomKeys}
                      onKeyClick={handleKeyClick}
                      showActionLabels
                      showFingerAssignments
                      showRemaps
                      hideNumpad
                    />
                  </KeyboardScaledPreview>
                  <p className="text-xs text-muted-foreground">{t("meKeybindings.mobileKeyboardRightNote")}</p>
                </div>
              )}
              {/* xl 以上は、表示幅が実寸（約 1120px）に足りないとき（1280〜1535px）だけ全体を幅に合わせて縮め、
                  ナビゲーション列まで一度に見せる。幅が足りるなら縮まない。xl 未満は横スクロール表示。
                  計測前（SSR 直後）は実寸の縦横比（テンキーなし 1120×370）で高さを確保して、跳ねないようにする */}
              <div className="w-full min-w-0 max-xl:hidden">
                <KeyboardScaledPreview
                  interactive
                  dialogTitle={t("meKeybindings.keyboardView")}
                  unmeasuredClassName="aspect-[1120/370] max-h-[370px]"
                >
                  <VirtualKeyboard
                    layout={keyboardLayout}
                    keybindings={keybindingsMap}
                    fingerAssignments={localFingerAssignments}
                    remaps={keyboardRemaps}
                    customKeys={keyboardCustomKeys}
                    onKeyClick={handleKeyClick}
                    showActionLabels
                    showFingerAssignments
                    showRemaps
                    hideNumpad
                  />
                </KeyboardScaledPreview>
              </div>
              <HorizontalScrollArea showHint wrapperClassName={cn("xl:hidden", !mobileFullKeyboard && "max-md:hidden")}>
                <VirtualKeyboard
                  layout={keyboardLayout}
                  keybindings={keybindingsMap}
                  fingerAssignments={localFingerAssignments}
                  remaps={keyboardRemaps}
                  customKeys={keyboardCustomKeys}
                  onKeyClick={handleKeyClick}
                  showActionLabels
                  showFingerAssignments
                  showRemaps
                  hideNumpad
                />
              </HorizontalScrollArea>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 md:hidden"
                aria-pressed={mobileFullKeyboard}
                onClick={() => setMobileFullKeyboard((v) => !v)}
              >
                {t(mobileFullKeyboard ? "meKeybindings.mobileKeyboardLeftHand" : "meKeybindings.mobileKeyboardFull")}
              </Button>
              {/* テンキーとマウスを横並び（狭い画面では折り返して縦積み） */}
              <div className="flex max-w-full flex-wrap items-start gap-x-6 gap-y-4">
                <VirtualNumpad
                  keybindings={keybindingsMap}
                  fingerAssignments={localFingerAssignments}
                  remaps={keyboardRemaps}
                  onKeyClick={handleKeyClick}
                  showActionLabels
                  showFingerAssignments
                  showRemaps
                />
                <VirtualMouse
                  keybindings={keybindingsMap}
                  fingerAssignments={localFingerAssignments}
                  remaps={keyboardRemaps}
                  customButtons={mouseCustomButtons}
                  onButtonClick={handleKeyClick}
                  showActionLabels
                  showFingerAssignments
                  showRemaps
                />
              </div>
            </div>
        </PageSection>
      )}

      {/* タブ分け設定セクション */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="keybindings" className="max-sm:h-11">
            {t("meKeybindings.tabActions")}
          </TabsTrigger>
          {!isControllerMode && (
            <>
              <TabsTrigger value="remaps" className="max-sm:h-11">
                {t("meKeybindings.tabRemaps")}
              </TabsTrigger>
              <TabsTrigger value="custom-actions" className="max-sm:h-11">
                {t("meKeybindings.tabCustomActions")}
              </TabsTrigger>
              <TabsTrigger value="custom-keys" className="max-sm:h-11">
                {t("meKeybindings.tabCustomKeys")}
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* 操作割り当てタブ */}
        <TabsContent value="keybindings" className="space-y-4">
          {!canEditPresetData && <PresetRequiredNotice />}
          {/* 見出し（h1 > h2 > h3）。id は `keybindings-actions-heading` になり、スキップリンクの移動先を兼ねる */}
          <PageSection id="keybindings-actions" first title={t("meKeybindings.tabActions")} className={cn(!canEditPresetData && "pointer-events-none opacity-50")}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {displayGroups.map((group) => {
              const bindings = group.bindings;
              if (!bindings || bindings.length === 0) return null;

              return (
                <section key={group.key}>
                  <h3 className="border-b border-border/60 pb-2 text-base font-semibold">
                    {group.label}
                  </h3>
                  <div>
                    <div className="divide-y">
                      {bindings.map((kb) => (
                        <KeybindingRow
                          key={kb.id}
                          kb={kb}
                          isControllerMode={isControllerMode}
                          updateKeybindingKey={updateKeybindingKey}
                          getKeyLabelWithCustom={getKeyLabelWithCustom}
                          getSharedActionLabels={getSharedActionLabels}
                          onAnnounce={setKeyAnnouncement}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
          </PageSection>
        </TabsContent>

        {/* リマップタブ（コントローラーモード以外） */}
        {!isControllerMode && (
        <TabsContent value="remaps" className="space-y-4">
          {!canEditPresetData && <PresetRequiredNotice />}
          <div className={cn(!canEditPresetData && "pointer-events-none opacity-50")}>
          <PageSection id="remaps" first title={t("meKeybindings.remapsTitle")}>
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p>{t("meKeybindings.remapsDescription")}</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">
                <li>{t("meKeybindings.remapsGuideSource")}</li>
                <li>{t("meKeybindings.remapsGuideTarget")}</li>
                <li>{t("meKeybindings.remapsGuideTrigger")}</li>
                <li>{t("meKeybindings.remapsGuideChat")}</li>
                <li>{t("meKeybindings.remapsGuideAll")}</li>
              </ul>
            </div>
            <div>
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
                  {t("meKeybindings.remapsNotConfigured")}
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
                {t("meKeybindings.addRemap")}
              </Button>
            </div>
          </PageSection>
          </div>
        </TabsContent>
        )}

        {/* カスタムキータブ（コントローラーモード以外） */}
        {!isControllerMode && (
        <TabsContent value="custom-keys" className="space-y-4">
          {!canEditPresetData && <PresetRequiredNotice />}
          <div className={cn(!canEditPresetData && "pointer-events-none opacity-50")}>
          <PageSection id="custom-keys" first title={t("meKeybindings.customKeysTitle")}>
            <p className="text-sm text-muted-foreground">
              {t("meKeybindings.customKeysDescription")}
            </p>
            <div className="space-y-4">
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
                            aria-label={t("meKeybindings.keyCode")}
                            className="font-mono text-sm max-sm:h-11"
                          />
                          <Input
                            value={ck.keyName}
                            onChange={(e) => updateCustomKey(index, { keyName: e.target.value })}
                            placeholder={t("meKeybindings.displayName")}
                            aria-label={t("meKeybindings.displayName")}
                            className="text-sm max-sm:h-11"
                          />
                          <Select
                            value={ck.category}
                            onValueChange={(value: "mouse" | "keyboard") => updateCustomKey(index, { category: value })}
                          >
                            <SelectTrigger aria-label={t("meKeybindings.customKeyCategoryAria")} className="w-full max-sm:h-11">
                              <SelectValue>{t(ck.category === "mouse" ? "meKeybindings.mouse" : "meKeybindings.keyboard")}</SelectValue>
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
                          aria-label={t("meKeybindings.deleteCustomKeyAria")}
                          className="text-destructive hover:text-destructive max-sm:size-11"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
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
                <Button type="button" variant="outline" onClick={addCustomKey} className="w-full sm:w-auto max-sm:min-h-11">
                  <Plus className="mr-1 h-4 w-4" />
                  {t("meKeybindings.addCustomKey")}
                </Button>
              </div>
            </div>
          </PageSection>
          </div>
        </TabsContent>
        )}

        {/* カスタムアクションタブ（コントローラーモード以外） */}
        {!isControllerMode && (
        <TabsContent value="custom-actions" className="space-y-4">
          {!canEditPresetData && <PresetRequiredNotice />}
          <div className={cn(!canEditPresetData && "pointer-events-none opacity-50")}>
          <PageSection id="custom-actions" first title={t("meKeybindings.customActionsTitle")}>
            <p className="text-sm text-muted-foreground">
              {t("meKeybindings.customActionsDescription")}
            </p>
            <div className="space-y-4">
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
            </div>
          </PageSection>
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
        saveResult={fetcher.data}
        saveSucceeded={fetcher.data != null && "success" in fetcher.data && fetcher.data.success === true}
      />

      {/* キー編集ダイアログ */}
      <Dialog
        open={!!editingKeyCode}
        onOpenChange={(open) => {
          if (!open) {
            requestCloseKeyModal();
          }
        }}
      >
        <DialogContent
          className="sm:max-w-lg max-h-[calc(100dvh-2rem)] p-0 overflow-hidden flex flex-col"
          onKeyDown={isCapturing ? handleKeyCapture : undefined}
          onMouseDown={isCapturing ? handleMouseCapture : undefined}
          onContextMenu={isCapturing ? (e) => e.preventDefault() : undefined}
          onEscapeKeyDown={keyCaptureEscapeGuard}
          onCloseAutoFocus={(e) => {
            // 開いたキーのボタン（仮想キーボードのそのキー）へ戻す。要素が差し替わっていたら roving key の属性で探す
            const ret = keyModalReturnFocusRef.current;
            if (!ret) return;
            e.preventDefault();
            const target =
              ret.el && ret.el.isConnected
                ? ret.el
                : document.querySelector<HTMLElement>(`[data-roving-key$=":${CSS.escape(ret.keyCode)}"]`);
            target?.focus({ preventScroll: true });
          }}
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
          <div className="space-y-3">
            {/* 段階的に見せる: 操作割り当ては常に開き、関係の薄い段（リマップ・指・カスタムアクション）は中身があるときだけ開く */}
            {/* 操作割り当て（複数選択可能） */}
            <KeyDialogSection
              key={`assign-${editingKeyCode}`}
              defaultOpen
              title={t("meKeybindings.actionAssignment")}
              summary={t("meKeybindings.sectionCount", { count: modalAssignedCountOnKey })}
              className={cn(!canEditPresetData && "pointer-events-none opacity-50")}
            >
              <p className="text-xs text-muted-foreground">
                {canEditPresetData
                  ? t("meKeybindings.actionsHelp")
                  : t("meKeybindings.presetRequired")}
              </p>
              <KeyActionPicker
                groups={modalDisplayGroups}
                editingKeyCode={editingKeyCode}
                getLabel={(kb) => getActionLabel(t, kb.action)}
                renderRow={(kb) => {
                          const isAssignedToThisKey = kb.keyCode === editingKeyCode;
                          const assignmentStatus = editingKeyCode
                            ? getActionAssignmentStatus(kb, editingKeyCode, modalAssignedCountOnKey)
                            : "none";
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
                                {assignmentStatus === "conflict" && (
                                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-warning">
                                    <span className="sr-only">{t("common.listSeparatorComma")}</span>
                                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                                    {t("meKeybindings.sharedKeyConflict")}
                                  </span>
                                )}
                                {assignmentStatus === "moves" && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    <span className="sr-only">{t("common.listSeparatorComma")}</span>
                                    {t("meKeybindings.assignedToOtherKey", {
                                      key: getKeyLabelWithCustom(assignedTo),
                                    })}
                                  </span>
                                )}
                              </label>
                            </div>
                          );
                }}
              />
            </KeyDialogSection>

            {/* リマップ（コントローラーボタン以外のみ表示） */}
            {editingKeyCode && !isControllerKeyCode(editingKeyCode) && (
            <KeyDialogSection
              key={`remap-${editingKeyCode}`}
              defaultOpen={modalSelectedKeyRemaps.length > 0}
              title={t("meKeybindings.keyRemapSetting")}
              summary={t("meKeybindings.sectionCount", { count: modalSelectedKeyRemaps.length })}
              className={cn(!canEditPresetData && "pointer-events-none opacity-50")}
            >
              <p className="text-xs text-muted-foreground">
                {canEditPresetData
                  ? t("meKeybindings.remapsHelp")
                  : t("meKeybindings.presetRequired")}
              </p>
              {modalSelectedKeyRemaps.length > 0 ? (
                <div className="space-y-2">
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
                  {t("meKeybindings.remapsNotConfigured")}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-sm:min-h-11"
                disabled={!canEditPresetData}
                onClick={() => {
                  // 新しいリマップを追加（ベースキーのみ、修飾キーなし）
                  modalAddRemapForKey(editingKeyCode);
                }}
              >
                <Plus className="mr-1 h-3 w-3" />
                {t("meKeybindings.add")}
              </Button>
            </KeyDialogSection>
            )}

            {/* 指割り当て（コントローラーボタン以外のみ表示） */}
            {editingKeyCode && !isControllerKeyCode(editingKeyCode) && (
            <KeyDialogSection
              key={`finger-${editingKeyCode}`}
              defaultOpen={(modalFingerAssignments[editingKeyCode] ?? []).length > 0}
              title={t("meKeybindings.fingerAssignment")}
              summary={t("meKeybindings.sectionCount", { count: (modalFingerAssignments[editingKeyCode] ?? []).length })}
              className={cn(!canEditPresetData && "pointer-events-none opacity-50")}
            >
              <FingerToggleGroup
                value={modalFingerAssignments[editingKeyCode] ?? []}
                disabled={!canEditPresetData}
                onChange={(next) => {
                  modalUpdateFingerAssignment(editingKeyCode, next);
                }}
              />
            </KeyDialogSection>
            )}

            {/* カスタムアクション（コントローラーモード以外） */}
            {editingKeyCode && !isControllerMode && (
            <KeyDialogSection
              key={`custom-${editingKeyCode}`}
              defaultOpen={modalSelectedKeyCustomActions.length > 0}
              title={t("meKeybindings.customActionsTitle")}
              summary={t("meKeybindings.sectionCount", { count: modalSelectedKeyCustomActions.length })}
              className={cn(!canEditPresetData && "pointer-events-none opacity-50")}
            >
              <p className="text-xs text-muted-foreground">
                {canEditPresetData
                  ? t("meKeybindings.customActionsHelp")
                  : t("meKeybindings.presetRequired")}
              </p>
              {modalSelectedKeyCustomActions.length > 0 ? (
                <div className="space-y-2">
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-sm:min-h-11"
                disabled={!canEditPresetData}
                onClick={() => modalAddCustomActionForKey(editingKeyCode)}
              >
                <Plus className="mr-1 h-3 w-3" />
                {t("meKeybindings.add")}
              </Button>
            </KeyDialogSection>
            )}
          </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-background sticky bottom-0 z-10">
            {/* 2段階の確定（ここの「適用」はページへの反映、保存はページ下のバー）をダイアログ内で示す */}
            <p className="text-xs text-muted-foreground sm:mr-auto sm:self-center">{t("meKeybindings.applyNote")}</p>
            <Button variant="outline" onClick={requestCloseKeyModal}>
              <X className="mr-2 h-4 w-4" />
              {t("meKeybindings.cancel")}
            </Button>
            <Button onClick={saveKeyModalChanges} disabled={!canEditPresetData}>
              <Check className="mr-2 h-4 w-4" />
              {t("meKeybindings.applyLabel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* キー編集ダイアログの破棄確認 */}
      <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("meKeybindings.discardDraftTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("meKeybindings.discardDraftDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("meKeybindings.discardDraftKeepEditing")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscardConfirmOpen(false);
                closeKeyModal();
              }}
            >
              {t("meKeybindings.discardDraftConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                  <SelectValue>
                    {t(COPY_TARGET_LABEL_KEYS[copyTarget])}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COPY_TARGET_OPTIONS.map((target) => (
                    <SelectItem key={target} value={target}>{t(COPY_TARGET_LABEL_KEYS[target])}</SelectItem>
                  ))}
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
  return <MeErrorBoundary />;
}
