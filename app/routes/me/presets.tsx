import { useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/presets";
import { createDb, type Database } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, configPresets, configHistory, keybindings, playerConfigs, keyRemaps, itemLayouts, searchCrafts, customKeys, customActions, type Keybinding, type PlayerConfig, type KeyRemap, type ItemLayout, type SearchCraft } from "@/lib/schema";
import { eq, desc, asc, and, ne } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createPreset, setMainPreset, resolveIsMainForNewPreset, serializeKeybindings, serializePlayerConfig, serializeRemaps, serializeItemLayouts, serializeSearchCrafts, serializeCustomKeys, serializeCustomActions, type PresetKeybindingData, type PresetRemapData, type PresetPlayerConfigData, type PresetItemLayoutData, type PresetSearchCraftData, type PresetCustomKeyData, type PresetCustomActionData } from "@/lib/preset-utils";
import { normalizeKeyRemapType } from "@/lib/remap-utils";
import { DEFAULT_KEYBINDINGS } from "@/lib/defaults";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { toast } from "sonner";
import { Save, Trash2, Check, Plus, History, Clock, ArrowRight, Loader2, Copy, Keyboard, Mouse, Package, Search, Star, Pencil } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { t } from "@/lib/messages";

export const meta: Route.MetaFunction = () => {
  return [{ title: t("mePresets.title") }];
};

function sanitizeRemapTargetKey(targetKey: string | null | undefined): string | null {
  if (targetKey == null) return null;
  if (targetKey === "" || /^__.*__$/.test(targetKey)) return null;
  return targetKey;
}

type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * key_remaps の UNIQUE (userId, sourceKey, remapType) に合わせて
 * (sourceKey, normalize後のremapType) で重複を除外（先勝ち。search-craft-apply の dedupeRemaps と同じ規則）。
 * 不正な remapType が normalizeKeyRemapType で "unset" に畳まれて衝突し、
 * トランザクション全体が失敗するのを防ぐ。
 */
function dedupeSnapshotRemaps(remaps: PresetRemapData[]): PresetRemapData[] {
  const seen = new Set<string>();
  const result: PresetRemapData[] = [];
  for (const remap of remaps) {
    if (!remap.sourceKey) continue;
    const key = `${remap.sourceKey}\u0000${normalizeKeyRemapType(remap.remapType)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(remap);
  }
  return result;
}

/** スナップショット（remapsData JSON）からライブテーブルへリマップを復元する（要 dedupe 済み削除後の空テーブル） */
async function restoreRemapsFromSnapshot(
  tx: DbTransaction,
  userId: string,
  remapsData: string | null,
  now: Date,
) {
  if (!remapsData) return;
  const remaps = dedupeSnapshotRemaps(JSON.parse(remapsData) as PresetRemapData[]);
  for (const remap of remaps) {
    await tx.insert(keyRemaps).values({
      id: createId(),
      userId,
      sourceKey: remap.sourceKey,
      targetKey: sanitizeRemapTargetKey(remap.targetKey),
      software: remap.software,
      notes: remap.notes,
      outputMode: remap.outputMode ?? "key",
      outputCharacter: remap.outputCharacter ?? null,
      remapType: normalizeKeyRemapType(remap.remapType),
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * スナップショットからライブテーブルへ走者設定を復元する（削除後の空テーブルに insert）。
 * - playerConfigData が null でも fingerAssignmentsData があれば行を作成する
 *   （指割り当てはデバイス設定と独立して復元する）
 * - スナップショットの null はそのまま null で復元し、?? でデフォルト値を注入しない
 */
async function restorePlayerConfigFromSnapshot(
  tx: DbTransaction,
  userId: string,
  playerConfigData: string | null,
  fingerAssignmentsData: string | null,
  now: Date,
) {
  if (!playerConfigData && !fingerAssignmentsData) return;
  const config = playerConfigData
    ? (JSON.parse(playerConfigData) as PresetPlayerConfigData)
    : null;
  await tx.insert(playerConfigs).values({
    id: createId(),
    userId,
    keyboardLayout: (config?.keyboardLayout ?? null) as "JIS" | "US" | "JIS_TKL" | "US_TKL" | null,
    keyboardModel: config?.keyboardModel ?? null,
    mouseDpi: config?.mouseDpi ?? null,
    gameSensitivity: config?.gameSensitivity ?? null,
    rawInput: config?.rawInput ?? null,
    mouseAcceleration: config?.mouseAcceleration ?? null,
    toggleSprint: config?.toggleSprint ?? null,
    toggleSneak: config?.toggleSneak ?? null,
    autoJump: config?.autoJump ?? null,
    fov: config?.fov ?? null,
    guiScale: config?.guiScale ?? null,
    gameLanguage: config?.gameLanguage ?? null,
    mouseModel: config?.mouseModel ?? null,
    windowsSpeed: config?.windowsSpeed ?? null,
    windowsSpeedMultiplier: config?.windowsSpeedMultiplier ?? null,
    cm360: config?.cm360 ?? null,
    notes: config?.notes ?? null,
    controllerSettings: config?.controllerSettings ?? null,
    fingerAssignments: fingerAssignmentsData,
    createdAt: now,
    updatedAt: now,
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    throw new Response(t("mePresets.userNotFound"), { status: 404 });
  }

  // プリセット一覧を取得（メイン → 編集中 → 更新日時の順で表示）
  const presets = await db.query.configPresets.findMany({
    where: eq(configPresets.userId, user.id),
    orderBy: [
      desc(configPresets.isMain),
      desc(configPresets.isActive),
      desc(configPresets.updatedAt),
    ],
  });

  // 変更履歴を取得（最新20件）
  const history = await db.query.configHistory.findMany({
    where: eq(configHistory.userId, user.id),
    orderBy: [desc(configHistory.createdAt)],
    limit: 20,
    with: {
      preset: {
        columns: {
          name: true,
        },
      },
    },
  });

  return { userId: user.id, presets, history };
}

export async function action({ request }: Route.ActionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      keybindings: true,
      playerConfig: true,
      keyRemaps: true,
      itemLayouts: true,
      searchCrafts: true,
      customKeys: true,
      customActions: true,
    },
  });

  if (!user) {
    return { error: t("mePresets.userNotFound") };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const now = new Date();

  // プリセット作成（現在の設定を保存 or 既存プリセットからコピー）
  if (intent === "create-preset") {
    const name = formData.get("name") as string;
    const description = formData.get("description") as string | null;
    const sourceType = formData.get("sourceType") as string; // "current" or "copy"
    const sourcePresetId = formData.get("sourcePresetId") as string | null;

    if (!name?.trim()) {
      return { error: t("mePresets.presetNameRequired") };
    }

    let sourcePreset: typeof configPresets.$inferSelect | undefined;
    if (sourceType === "copy" && sourcePresetId) {
      sourcePreset = await db.query.configPresets.findFirst({
        where: eq(configPresets.id, sourcePresetId),
      });
      if (!sourcePreset || sourcePreset.userId !== user.id) {
        return { error: t("mePresets.sourcePresetNotFound") };
      }
    }

    const presetId = createId();
    const trimmedName = name.trim();
    const trimmedDescription = description?.trim() || null;

    // ライブテーブル削除＋新データ挿入＋プリセット行作成を単一トランザクションで実行
    await db.transaction(async (tx) => {
      // メイン（公開用）が未設定のユーザーには新規プリセットを自動でメインにする
      const isMain = await resolveIsMainForNewPreset(tx, user.id);

      // 既存プリセット非アクティブ化、ライブテーブル全クリア
      await tx
        .update(configPresets)
        .set({ isActive: false, updatedAt: now })
        .where(eq(configPresets.userId, user.id));
      await tx.delete(keybindings).where(eq(keybindings.userId, user.id));
      await tx.delete(keyRemaps).where(eq(keyRemaps.userId, user.id));
      await tx.delete(playerConfigs).where(eq(playerConfigs.userId, user.id));
      await tx.delete(itemLayouts).where(eq(itemLayouts.userId, user.id));
      await tx.delete(searchCrafts).where(eq(searchCrafts.userId, user.id));
      await tx.delete(customKeys).where(eq(customKeys.userId, user.id));
      await tx.delete(customActions).where(eq(customActions.userId, user.id));

      // 挿入するデータをソース別に決定
      let keybindingsData: string | null = null;
      let playerConfigData: string | null = null;
      let remapsData: string | null = null;
      let fingerAssignmentsData: string | null = null;
      let itemLayoutsData: string | null = null;
      let searchCraftsData: string | null = null;
      let customKeysData: string | null = null;
      let customActionsData: string | null = null;

      if (sourcePreset) {
        // 既存プリセットからコピー
        keybindingsData = sourcePreset.keybindingsData;
        playerConfigData = sourcePreset.playerConfigData;
        remapsData = sourcePreset.remapsData;
        fingerAssignmentsData = sourcePreset.fingerAssignmentsData;
        itemLayoutsData = sourcePreset.itemLayoutsData;
        searchCraftsData = sourcePreset.searchCraftsData;
        customKeysData = sourcePreset.customKeysData;
        customActionsData = sourcePreset.customActionsData;

        // ライブテーブルへの展開
        if (keybindingsData) {
          const kbData = JSON.parse(keybindingsData) as PresetKeybindingData[];
          for (const kb of kbData) {
            await tx.insert(keybindings).values({
              id: createId(),
              userId: user.id,
              action: kb.action,
              keyCode: kb.keyCode,
              category: kb.category as "movement" | "combat" | "inventory" | "ui",
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        await restorePlayerConfigFromSnapshot(tx, user.id, playerConfigData, fingerAssignmentsData, now);
        await restoreRemapsFromSnapshot(tx, user.id, remapsData, now);
        if (itemLayoutsData) {
          const layoutData = JSON.parse(itemLayoutsData) as PresetItemLayoutData[];
          for (const layout of layoutData) {
            await tx.insert(itemLayouts).values({
              id: createId(),
              userId: user.id,
              segment: layout.segment,
              slots: layout.slots,
              offhand: layout.offhand,
              notes: layout.notes,
              displayOrder: layout.displayOrder,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        if (searchCraftsData) {
          const craftData = JSON.parse(searchCraftsData) as PresetSearchCraftData[];
          for (const craft of craftData) {
            await tx.insert(searchCrafts).values({
              id: createId(),
              userId: user.id,
              sequence: craft.sequence,
              items: craft.items,
              keys: craft.keys,
              searchStr: craft.searchStr,
              comment: craft.comment,
              timing: craft.timing ?? null,
              withShift: craft.withShift === true,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        if (customKeysData) {
          const ckData = JSON.parse(customKeysData) as PresetCustomKeyData[];
          for (const ck of ckData) {
            await tx.insert(customKeys).values({
              id: createId(),
              userId: user.id,
              keyCode: ck.keyCode,
              keyName: ck.keyName,
              category: ck.category,
              position: ck.position,
              size: ck.size,
              notes: ck.notes,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        if (customActionsData) {
          const caData = JSON.parse(customActionsData) as PresetCustomActionData[];
          for (const ca of caData) {
            await tx.insert(customActions).values({
              id: createId(),
              userId: user.id,
              actionName: ca.actionName,
              description: ca.description,
              category: ca.category,
              triggerKey: ca.triggerKey,
              displayOrder: ca.displayOrder,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
      } else if (
        user.keybindings.length > 0 ||
        user.playerConfig ||
        user.keyRemaps.length > 0 ||
        user.itemLayouts.length > 0 ||
        user.searchCrafts.length > 0 ||
        user.customKeys.length > 0 ||
        user.customActions.length > 0
      ) {
        // 現在のライブテーブル内容（メモリ上）から作成
        // キーバインド以外のライブデータ（アイテム配置・サーチクラフト等）しか持たない
        // ユーザーもここに入れる（デフォルト分岐に落ちると既存データが消失するため）
        keybindingsData = user.keybindings.length > 0 ? serializeKeybindings(user.keybindings) : null;
        playerConfigData = user.playerConfig ? serializePlayerConfig(user.playerConfig) : null;
        remapsData = user.keyRemaps.length > 0 ? serializeRemaps(user.keyRemaps) : null;
        fingerAssignmentsData = user.playerConfig?.fingerAssignments ?? null;
        itemLayoutsData = user.itemLayouts.length > 0 ? serializeItemLayouts(user.itemLayouts) : null;
        searchCraftsData = user.searchCrafts.length > 0 ? serializeSearchCrafts(user.searchCrafts) : null;
        customKeysData = user.customKeys.length > 0 ? serializeCustomKeys(user.customKeys) : null;
        customActionsData = user.customActions.length > 0 ? serializeCustomActions(user.customActions) : null;

        // 既存設定をライブテーブルに再挿入（削除後の復元）
        for (const kb of user.keybindings) {
          await tx.insert(keybindings).values({
            id: createId(),
            userId: user.id,
            action: kb.action,
            keyCode: kb.keyCode,
            category: kb.category,
            createdAt: now,
            updatedAt: now,
          });
        }
        if (user.playerConfig) {
          await tx.insert(playerConfigs).values({
            id: createId(),
            userId: user.id,
            keyboardLayout: user.playerConfig.keyboardLayout,
            keyboardModel: user.playerConfig.keyboardModel,
            mouseDpi: user.playerConfig.mouseDpi,
            gameSensitivity: user.playerConfig.gameSensitivity,
            rawInput: user.playerConfig.rawInput,
            mouseAcceleration: user.playerConfig.mouseAcceleration,
            toggleSprint: user.playerConfig.toggleSprint,
            toggleSneak: user.playerConfig.toggleSneak,
            autoJump: user.playerConfig.autoJump,
            fov: user.playerConfig.fov,
            guiScale: user.playerConfig.guiScale,
            gameLanguage: user.playerConfig.gameLanguage,
            mouseModel: user.playerConfig.mouseModel,
            windowsSpeed: user.playerConfig.windowsSpeed,
            windowsSpeedMultiplier: user.playerConfig.windowsSpeedMultiplier,
            cm360: user.playerConfig.cm360,
            notes: user.playerConfig.notes,
            controllerSettings: user.playerConfig.controllerSettings,
            fingerAssignments: user.playerConfig.fingerAssignments,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const remap of user.keyRemaps) {
          await tx.insert(keyRemaps).values({
            id: createId(),
            userId: user.id,
            sourceKey: remap.sourceKey,
            targetKey: sanitizeRemapTargetKey(remap.targetKey),
            software: remap.software,
            notes: remap.notes,
            outputMode: remap.outputMode ?? "key",
            outputCharacter: remap.outputCharacter ?? null,
            remapType: remap.remapType,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const layout of user.itemLayouts) {
          await tx.insert(itemLayouts).values({
            id: createId(),
            userId: user.id,
            segment: layout.segment,
            slots: layout.slots,
            offhand: layout.offhand,
            notes: layout.notes,
            displayOrder: layout.displayOrder,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const craft of user.searchCrafts) {
          await tx.insert(searchCrafts).values({
            id: createId(),
            userId: user.id,
            sequence: craft.sequence,
            items: craft.items,
            keys: craft.keys,
            searchStr: craft.searchStr,
            comment: craft.comment,
            timing: craft.timing,
            withShift: craft.withShift,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const ck of user.customKeys) {
          await tx.insert(customKeys).values({
            id: createId(),
            userId: user.id,
            keyCode: ck.keyCode,
            keyName: ck.keyName,
            category: ck.category,
            position: ck.position,
            size: ck.size,
            notes: ck.notes,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const ca of user.customActions) {
          await tx.insert(customActions).values({
            id: createId(),
            userId: user.id,
            actionName: ca.actionName,
            description: ca.description,
            category: ca.category,
            triggerKey: ca.triggerKey,
            displayOrder: ca.displayOrder,
            createdAt: now,
            updatedAt: now,
          });
        }
      } else {
        // デフォルト設定から作成
        const defaultKbs = DEFAULT_KEYBINDINGS.map((kb) => ({
          action: kb.action,
          keyCode: kb.keyCode,
          category: kb.category,
        }));
        keybindingsData = JSON.stringify(defaultKbs);

        for (const kb of DEFAULT_KEYBINDINGS) {
          await tx.insert(keybindings).values({
            id: createId(),
            userId: user.id,
            action: kb.action,
            keyCode: kb.keyCode,
            category: kb.category,
            createdAt: now,
            updatedAt: now,
          });
        }

        await tx.insert(playerConfigs).values({
          id: createId(),
          userId: user.id,
          keyboardLayout: "US",
          mouseAcceleration: false,
          rawInput: true,
          createdAt: now,
          updatedAt: now,
        });

        // serializePlayerConfig と同じ全列構造でスナップショットを保存する
        const defaultConfigData: PresetPlayerConfigData = {
          keyboardLayout: "US",
          keyboardModel: null,
          mouseDpi: null,
          gameSensitivity: null,
          rawInput: true,
          mouseAcceleration: false,
          toggleSprint: null,
          toggleSneak: null,
          autoJump: null,
          fov: null,
          guiScale: null,
          gameLanguage: null,
          mouseModel: null,
          windowsSpeed: null,
          windowsSpeedMultiplier: null,
          cm360: null,
          notes: null,
          controllerSettings: null,
        };
        playerConfigData = JSON.stringify(defaultConfigData);
      }

      // プリセット行を作成（編集対象として。メイン未設定ユーザーのみメインにもなる）
      await tx.insert(configPresets).values({
        id: presetId,
        userId: user.id,
        name: trimmedName,
        description: trimmedDescription,
        isActive: true,
        isMain,
        keybindingsData,
        playerConfigData,
        remapsData,
        fingerAssignmentsData,
        itemLayoutsData,
        searchCraftsData,
        customKeysData,
        customActionsData,
        createdAt: now,
        updatedAt: now,
      });

      // 履歴記録
      const description = sourcePreset
        ? t("mePresets.copiedAndApplied", { source: sourcePreset.name, name: trimmedName })
        : t("mePresets.createdFromCurrentAndApplied", { name: trimmedName });
      await tx.insert(configHistory).values({
        id: createId(),
        userId: user.id,
        changeType: "preset_switch",
        changeDescription: description,
        presetId,
        createdAt: now,
      });
    });

    return { success: true, message: t("mePresets.createdAndApplied", { name: trimmedName }) };
  }

  // プリセット削除
  if (intent === "delete-preset") {
    const presetId = formData.get("presetId") as string;

    const preset = await db.query.configPresets.findFirst({
      where: eq(configPresets.id, presetId),
    });

    if (!preset || preset.userId !== user.id) {
      return { error: t("mePresets.presetNotFound") };
    }

    const others = await db.query.configPresets.findMany({
      where: and(eq(configPresets.userId, user.id), ne(configPresets.id, presetId)),
      columns: { id: true },
    });

    // 他のプリセットが残る場合:
    // - メイン（公開用）は削除を拒否し、先に別のプリセットをメインに設定してもらう
    // - 編集中（アクティブ）は削除を拒否し、先に編集対象を切り替えてもらう
    //   （削除すると「アクティブなし + ライブテーブルにデータ残留」の不整合になるため）
    if (others.length > 0) {
      if (preset.isMain) {
        return { error: t("mePresets.cannotDeleteMain") };
      }
      if (preset.isActive) {
        return { error: t("mePresets.cannotDeleteActive") };
      }
    }

    // 唯一のプリセットの削除は許可し、「アクティブプリセット = ライブテーブル」の
    // 不変条件を保つため、同一トランザクションでライブテーブルも全ワイプする。
    if (others.length === 0) {
      await db.transaction(async (tx) => {
        await tx.delete(keybindings).where(eq(keybindings.userId, user.id));
        await tx.delete(keyRemaps).where(eq(keyRemaps.userId, user.id));
        await tx.delete(playerConfigs).where(eq(playerConfigs.userId, user.id));
        await tx.delete(itemLayouts).where(eq(itemLayouts.userId, user.id));
        await tx.delete(searchCrafts).where(eq(searchCrafts.userId, user.id));
        await tx.delete(customKeys).where(eq(customKeys.userId, user.id));
        await tx.delete(customActions).where(eq(customActions.userId, user.id));
        await tx
          .delete(configPresets)
          .where(and(eq(configPresets.id, presetId), eq(configPresets.userId, user.id)));
        await tx.insert(configHistory).values({
          id: createId(),
          userId: user.id,
          changeType: "preset_switch",
          changeDescription: t("mePresets.deleteHistoryDescription", { name: preset.name }),
          createdAt: now,
        });
      });

      return { success: true, message: t("mePresets.presetDeleted") };
    }

    await db
      .delete(configPresets)
      .where(and(eq(configPresets.id, presetId), eq(configPresets.userId, user.id)));

    // 履歴に記録
    await db.insert(configHistory).values({
      id: createId(),
      userId: user.id,
      changeType: "preset_switch",
      changeDescription: t("mePresets.deleteHistoryDescription", { name: preset.name }),
      createdAt: now,
    });

    return { success: true, message: t("mePresets.presetDeleted") };
  }

  // メイン（公開用）プリセットの設定。
  // is_main フラグを排他的に付け替えるだけで、ライブテーブル・編集対象（isActive）には一切触れない。
  // 公開面はメインプリセットのスナップショットを表示するため、即座に反映される。
  if (intent === "set-main") {
    const presetId = formData.get("presetId") as string;

    const preset = await db.query.configPresets.findFirst({
      where: and(eq(configPresets.id, presetId), eq(configPresets.userId, user.id)),
      columns: { id: true, name: true, isMain: true },
    });
    if (!preset) {
      return { error: t("mePresets.presetNotFound") };
    }
    if (preset.isMain) {
      return { success: true, message: t("mePresets.mainPresetSet") };
    }

    await setMainPreset(db, { id: preset.id, userId: user.id });

    await db.insert(configHistory).values({
      id: createId(),
      userId: user.id,
      changeType: "preset_switch",
      changeDescription: t("mePresets.setMainHistoryDescription", { name: preset.name }),
      presetId,
      createdAt: now,
    });

    return { success: true, message: t("mePresets.mainPresetSet") };
  }

  // プリセット適用
  if (intent === "apply-preset") {
    const presetId = formData.get("presetId") as string;

    const preset = await db.query.configPresets.findFirst({
      where: eq(configPresets.id, presetId),
    });

    if (!preset || preset.userId !== user.id) {
      return { error: t("mePresets.presetNotFound") };
    }

    // 現在の設定をバックアップ（履歴用）
    const previousKeybindings = JSON.stringify(user.keybindings);

    await db.transaction(async (tx) => {
      // ライブテーブル全クリア（フルシンク）
      // playerConfigs も削除対象に含める（残すと playerConfigData=null のプリセット適用時に
      // 前プリセットのデバイス設定が残留し、他種別と非対称になる）
      await tx.delete(keybindings).where(eq(keybindings.userId, user.id));
      await tx.delete(keyRemaps).where(eq(keyRemaps.userId, user.id));
      await tx.delete(playerConfigs).where(eq(playerConfigs.userId, user.id));
      await tx.delete(itemLayouts).where(eq(itemLayouts.userId, user.id));
      await tx.delete(searchCrafts).where(eq(searchCrafts.userId, user.id));
      await tx.delete(customKeys).where(eq(customKeys.userId, user.id));
      await tx.delete(customActions).where(eq(customActions.userId, user.id));

      // キーバインドを復元
      if (preset.keybindingsData) {
        const keybindingsFromPreset = JSON.parse(preset.keybindingsData) as PresetKeybindingData[];
        for (const kbData of keybindingsFromPreset) {
          await tx.insert(keybindings).values({
            id: createId(),
            userId: user.id,
            action: kbData.action,
            keyCode: kbData.keyCode,
            category: kbData.category as "movement" | "combat" | "inventory" | "ui",
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // 走者設定を復元（コピー経路と同じく削除済みテーブルへの insert で統一。
      // 指割り当ては playerConfigData と独立して復元される）
      await restorePlayerConfigFromSnapshot(
        tx,
        user.id,
        preset.playerConfigData,
        preset.fingerAssignmentsData,
        now,
      );

      // リマップを復元
      await restoreRemapsFromSnapshot(tx, user.id, preset.remapsData, now);

      // アイテム配置を復元
      if (preset.itemLayoutsData) {
        const layoutsFromPreset = JSON.parse(preset.itemLayoutsData) as PresetItemLayoutData[];
        for (const layoutData of layoutsFromPreset) {
          await tx.insert(itemLayouts).values({
            id: createId(),
            userId: user.id,
            segment: layoutData.segment,
            slots: layoutData.slots,
            offhand: layoutData.offhand,
            notes: layoutData.notes,
            displayOrder: layoutData.displayOrder,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // サーチクラフトを復元
      if (preset.searchCraftsData) {
        const craftsFromPreset = JSON.parse(preset.searchCraftsData) as PresetSearchCraftData[];
        for (const craftData of craftsFromPreset) {
          await tx.insert(searchCrafts).values({
            id: createId(),
            userId: user.id,
            sequence: craftData.sequence,
            items: craftData.items,
            keys: craftData.keys,
            searchStr: craftData.searchStr,
            comment: craftData.comment,
            timing: craftData.timing ?? null,
            withShift: craftData.withShift === true,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // カスタムキー定義を復元
      if (preset.customKeysData) {
        const ckFromPreset = JSON.parse(preset.customKeysData) as PresetCustomKeyData[];
        for (const ck of ckFromPreset) {
          await tx.insert(customKeys).values({
            id: createId(),
            userId: user.id,
            keyCode: ck.keyCode,
            keyName: ck.keyName,
            category: ck.category,
            position: ck.position,
            size: ck.size,
            notes: ck.notes,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // カスタムアクションを復元
      if (preset.customActionsData) {
        const caFromPreset = JSON.parse(preset.customActionsData) as PresetCustomActionData[];
        for (const ca of caFromPreset) {
          await tx.insert(customActions).values({
            id: createId(),
            userId: user.id,
            actionName: ca.actionName,
            description: ca.description,
            category: ca.category,
            triggerKey: ca.triggerKey,
            displayOrder: ca.displayOrder,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // 全てのプリセットを非アクティブに
      await tx
        .update(configPresets)
        .set({ isActive: false, updatedAt: now })
        .where(eq(configPresets.userId, user.id));

      // このプリセットをアクティブに
      await tx
        .update(configPresets)
        .set({ isActive: true, updatedAt: now })
        .where(eq(configPresets.id, presetId));

      // 履歴に記録
      await tx.insert(configHistory).values({
        id: createId(),
        userId: user.id,
        changeType: "preset_switch",
        changeDescription: t("mePresets.appliedPreset", { name: preset.name }),
        previousData: previousKeybindings,
        newData: preset.keybindingsData,
        presetId,
        createdAt: now,
      });
    });

    return { success: true, message: t("mePresets.appliedPreset", { name: preset.name }) };
  }

  return { error: t("mePresets.unknownAction") };
}

export default function PresetsPage() {
  const { presets, history } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetDescription, setNewPresetDescription] = useState("");
  const [sourceType, setSourceType] = useState<"current" | "copy">("current");
  const [sourcePresetId, setSourcePresetId] = useState<string>("");

  const isSubmitting = fetcher.state === "submitting";

  // トースト通知
  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(data.message);
      setIsCreateDialogOpen(false);
      setNewPresetName("");
      setNewPresetDescription("");
      setSourceType("current");
      setSourcePresetId("");
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  const handleCreatePreset = () => {
    if (!newPresetName.trim()) {
      toast.error(t("mePresets.presetNameRequired"));
      return;
    }

    if (sourceType === "copy" && !sourcePresetId) {
      toast.error(t("mePresets.sourcePresetRequired"));
      return;
    }

    const formData = new FormData();
    formData.set("intent", "create-preset");
    formData.set("name", newPresetName);
    formData.set("description", newPresetDescription);
    formData.set("sourceType", sourceType);
    if (sourceType === "copy" && sourcePresetId) {
      formData.set("sourcePresetId", sourcePresetId);
    }
    fetcher.submit(formData, { method: "post" });
  };

  const changeTypeLabels: Record<string, string> = {
    keybinding: t("mePresets.keybindings"),
    device: t("mePresets.devices"),
    game_setting: t("mePresets.gameSettings"),
    remap: t("mePresets.remap"),
    preset_switch: t("mePresets.preset"),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("mePresets.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("mePresets.pageDescription")}
        </p>
      </div>

      {/* プリセット一覧 */}
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">{t("mePresets.listTitle")}</CardTitle>
            <CardDescription>{t("mePresets.listDescription")}</CardDescription>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
            setIsCreateDialogOpen(open);
            if (!open) {
              setNewPresetName("");
              setNewPresetDescription("");
              setSourceType("current");
              setSourcePresetId("");
            }
          }}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto h-11 sm:h-10">
                <Plus className="h-4 w-4 mr-2" />
                {t("mePresets.newPreset")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("mePresets.createTitle")}</DialogTitle>
                <DialogDescription>
                  {t("mePresets.createDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {/* ソース選択 */}
                <div className="space-y-3">
                  <Label>{t("mePresets.createMethod")}</Label>
                  <RadioGroup
                    value={sourceType}
                    onValueChange={(value) => setSourceType(value as "current" | "copy")}
                    className="space-y-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="current" id="source-current" />
                      <Label htmlFor="source-current" className="cursor-pointer font-normal">
                        {t("mePresets.createFromCurrent")}
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="copy" id="source-copy" disabled={presets.length === 0} />
                      <Label htmlFor="source-copy" className={`cursor-pointer font-normal ${presets.length === 0 ? "text-muted-foreground" : ""}`}>
                        {t("mePresets.copyExistingPreset")}
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* コピー元プリセット選択 */}
                {sourceType === "copy" && presets.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="source-preset">{t("mePresets.sourcePreset")}</Label>
                    <Select value={sourcePresetId} onValueChange={setSourcePresetId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("mePresets.selectPreset")} />
                      </SelectTrigger>
                      <SelectContent>
                        {presets.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            <div className="flex items-center gap-2">
                              <Copy className="h-3 w-3" />
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
                )}

                <div className="space-y-2">
                  <Label htmlFor="preset-name">{t("mePresets.presetName")}</Label>
                  <Input
                    id="preset-name"
                    placeholder={t("mePresets.presetNamePlaceholder")}
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="preset-description">{t("mePresets.descriptionOptional")}</Label>
                  <Textarea
                    id="preset-description"
                    placeholder={t("mePresets.descriptionPlaceholder")}
                    value={newPresetDescription}
                    onChange={(e) => setNewPresetDescription(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreatePreset}
                  disabled={isSubmitting || !newPresetName.trim() || (sourceType === "copy" && !sourcePresetId)}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : sourceType === "copy" ? (
                    <Copy className="h-4 w-4 mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {sourceType === "copy" ? t("mePresets.createByCopy") : t("mePresets.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {presets.length > 0 ? (
            <div className="space-y-3">
              {presets.map((preset) => {
                // プリセットに含まれる内容を計算
                const hasKeybindings = !!preset.keybindingsData;
                const hasPlayerConfig = !!preset.playerConfigData;
                const hasRemaps = !!preset.remapsData;
                const hasItemLayouts = !!preset.itemLayoutsData;
                const hasSearchCrafts = !!preset.searchCraftsData;

                // キーバインド数を計算
                let keybindingsCount = 0;
                if (preset.keybindingsData) {
                  try {
                    keybindingsCount = JSON.parse(preset.keybindingsData).length;
                  } catch {}
                }

                // アイテム配置数を計算
                let itemLayoutsCount = 0;
                if (preset.itemLayoutsData) {
                  try {
                    itemLayoutsCount = JSON.parse(preset.itemLayoutsData).length;
                  } catch {}
                }

                // サーチクラフト数を計算
                let searchCraftsCount = 0;
                if (preset.searchCraftsData) {
                  try {
                    searchCraftsCount = JSON.parse(preset.searchCraftsData).length;
                  } catch {}
                }

                return (
                  <div
                    key={preset.id}
                    className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium truncate">{preset.name}</p>
                          {preset.isMain && (
                            <Badge variant="default" className="shrink-0">
                              <Star className="h-3 w-3 mr-1" />
                              {t("mePresets.mainBadge")}
                            </Badge>
                          )}
                          {preset.isActive && (
                            <Badge variant="secondary" className="shrink-0">
                              <Pencil className="h-3 w-3 mr-1" />
                              {t("mePresets.editingBadge")}
                            </Badge>
                          )}
                        </div>
                        {preset.description && (
                          <p className="text-sm text-muted-foreground truncate mt-1">
                            {preset.description}
                          </p>
                        )}

                        {/* 含まれる内容をアイコンで表示 */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {hasKeybindings && (
                            <Badge variant="secondary" className="text-xs py-0.5">
                              <Keyboard className="h-3 w-3 mr-1" />
                              {t("mePresets.keybindings")} {keybindingsCount > 0 && `(${keybindingsCount})`}
                            </Badge>
                          )}
                          {hasPlayerConfig && (
                            <Badge variant="secondary" className="text-xs py-0.5">
                              <Mouse className="h-3 w-3 mr-1" />
                              {t("mePresets.devices")}
                            </Badge>
                          )}
                          {hasItemLayouts && (
                            <Badge variant="secondary" className="text-xs py-0.5">
                              <Package className="h-3 w-3 mr-1" />
                              {t("meItems.itemLayouts")} {itemLayoutsCount > 0 && `(${itemLayoutsCount})`}
                            </Badge>
                          )}
                          {hasSearchCrafts && (
                            <Badge variant="secondary" className="text-xs py-0.5">
                              <Search className="h-3 w-3 mr-1" />
                              {t("meSearchCraft.pageTitle")} {searchCraftsCount > 0 && `(${searchCraftsCount})`}
                            </Badge>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground mt-2">
                          {t("mePresets.updatedPrefix")} {formatDistanceToNow(new Date(preset.updatedAt), { addSuffix: true, locale: ja })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!preset.isActive && (
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="apply-preset" />
                            <input type="hidden" name="presetId" value={preset.id} />
                            <Button type="submit" variant="outline" size="sm" disabled={isSubmitting} className="touch-manipulation">
                              <Pencil className="h-4 w-4 sm:mr-1" />
                              <span className="hidden sm:inline">{t("mePresets.edit")}</span>
                            </Button>
                          </fetcher.Form>
                        )}
                        {!preset.isMain && (
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="set-main" />
                            <input type="hidden" name="presetId" value={preset.id} />
                            <Button type="submit" variant="outline" size="sm" disabled={isSubmitting} className="touch-manipulation">
                              <Star className="h-4 w-4 sm:mr-1" />
                              <span className="hidden sm:inline">{t("mePresets.setMain")}</span>
                            </Button>
                          </fetcher.Form>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive touch-manipulation">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("mePresets.deletePresetTitle")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("mePresets.deletePresetDescription", { name: preset.name })}
                                {presets.length === 1 && (
                                  <span className="mt-2 block font-medium text-destructive">
                                    {t("mePresets.lastPresetDeleteWarning")}
                                  </span>
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("meSearchCraft.cancel")}</AlertDialogCancel>
                              <fetcher.Form method="post">
                                <input type="hidden" name="intent" value="delete-preset" />
                                <input type="hidden" name="presetId" value={preset.id} />
                                <AlertDialogAction type="submit" className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                  {t("mePresets.delete")}
                                </AlertDialogAction>
                              </fetcher.Form>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Save className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>{t("mePresets.emptyTitle")}</p>
              <p className="text-sm mt-1">
                {t("mePresets.emptyDescription")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 変更履歴 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-5 w-5" />
            {t("mePresets.historyTitle")}
          </CardTitle>
          <CardDescription>{t("mePresets.historyDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length > 0 ? (
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 py-2 border-b last:border-0"
                >
                  <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{entry.changeDescription}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {changeTypeLabels[entry.changeType] ?? entry.changeType}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true, locale: ja })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center py-4 text-muted-foreground text-sm">
              {t("mePresets.noHistory")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
