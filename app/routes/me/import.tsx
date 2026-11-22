import { createTranslator, type Translator } from "@/lib/messages";
import { resolveLocale } from "@/lib/locale";
import { redirect } from "react-router";
import type { Route } from "./+types/import";
import { createDb, type Database } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, keybindings, keyRemaps, playerConfigs, configPresets, customKeys, customActions, itemLayouts, searchCrafts } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import type { ParsedRemap } from "@/lib/import-parser";
import { normalizeKeyRemapType } from "@/lib/remap-utils";
import { createPresetFromImport, syncActivePresetSnapshot, assertPresetIsActive, PresetMismatchError } from "@/lib/preset-utils";
import { SAVE_LIMITS, formString, isValidFov, isValidGuiScale } from "@/lib/save-limits";
import { normalizeGameLanguage } from "@/lib/game-languages";

// 設定のインポートは /me/keybindings のプリセット行の「インポート」ダイアログから行う（ImportDialog）。
// このルートは書き込み先の action（ダイアログが fetcher で POST する）と、旧 URL（ブックマーク・docs・ガイドの
// リンク）をダイアログが開いたキー配置画面へ転送する loader だけを持つリソースルート。ページ本体は持たない。
export function loader() {
  return redirect("/me/keybindings?import=1");
}

/**
 * インポート（import-remaps / import-minecraft 共通）の書き込み後にプリセットへ反映する。
 * - 初回インポート（hasPresets=false）: 最新データ7種を並列取得してプリセットを新規作成する。
 *   syncActivePresetSnapshot と異なり createPresetFromImport は呼び出し側から値を渡す必要があるため、
 *   ここでのみ取得する（hasPresets=true 側は syncActivePresetSnapshot が自力で最新値を読むため不要）。
 * - 2回目以降（hasPresets=true）: アクティブプリセットのスナップショットを同期する
 *   （アクティブ不在はアクション冒頭で弾いているため、ここでは必ず同期される）。
 * 戻り値はレスポンスの presetCreated にそのまま使う。
 */
async function syncPresetAfterImport(t: Translator, db: Database, userId: string, hasPresets: boolean): Promise<boolean> {
  if (!hasPresets) {
    const [
      updatedKeybindings,
      updatedPlayerConfig,
      updatedKeyRemaps,
      updatedItemLayouts,
      updatedSearchCrafts,
      updatedCustomKeys,
      updatedCustomActions,
    ] = await Promise.all([
      db.query.keybindings.findMany({ where: eq(keybindings.userId, userId) }),
      db.query.playerConfigs.findFirst({ where: eq(playerConfigs.userId, userId) }),
      db.query.keyRemaps.findMany({ where: eq(keyRemaps.userId, userId) }),
      db.query.itemLayouts.findMany({ where: eq(itemLayouts.userId, userId) }),
      db.query.searchCrafts.findMany({ where: eq(searchCrafts.userId, userId) }),
      db.query.customKeys.findMany({ where: eq(customKeys.userId, userId) }),
      db.query.customActions.findMany({ where: eq(customActions.userId, userId) }),
    ]);

    await createPresetFromImport(
      t,
      db,
      userId,
      updatedKeybindings,
      updatedPlayerConfig ?? null,
      updatedKeyRemaps,
      updatedItemLayouts,
      updatedSearchCrafts,
      updatedCustomKeys,
      updatedCustomActions,
    );
  } else {
    await syncActivePresetSnapshot(db, userId, [
      "keybindings",
      "playerConfig",
      "remaps",
      "fingers",
      "itemLayouts",
      "searchCrafts",
      "customKeys",
      "customActions",
    ]);
  }

  return !hasPresets;
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
    throw new Response("Not Found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = formString(formData, "intent");

  // 画面に出していた取り込み先が、別タブでの切替で変わっていないか確認する
  // （他のプリセット対象画面と同じ。不一致なら何も書かずに staleSession）
  try {
    await assertPresetIsActive(db, user.id, formString(formData, "presetId") || null);
  } catch (e) {
    if (e instanceof PresetMismatchError) {
      return { success: false, error: t("mePresets.staleSession") };
    }
    throw e;
  }

  // プリセットの状態を書き込み前に確認する。
  // 「プリセットは存在するがアクティブが1件も無い」状態では、インポート後の
  // syncActivePresetSnapshot が無言で no-op になり、インポート内容がどの
  // スナップショットにも属さなくなるため、先にエラーを返す。
  // （プリセット0件時は createPresetFromImport で新規作成するため対象外）
  const existingPresets = await db.query.configPresets.findMany({
    where: eq(configPresets.userId, user.id),
    columns: { id: true, isActive: true },
  });
  const hasPresets = existingPresets.length > 0;
  if (hasPresets && !existingPresets.some((p) => p.isActive)) {
    return { success: false, error: t("mePresets.staleSession") };
  }

  if (intent === "import-remaps") {
    // 旧形式バックアップは remapType フィールド欠落 → unset 扱い
    // targetKey/software/notes はいずれも nullable 列（key_remaps）なので、非文字列値は
    // 書き込みエラーにせず null へ矯正する。一方 sourceKey は一意インデックスの構成要素かつ
    // NOT NULL のため、欠落・非文字列の要素があればインポート全体を invalidData で拒否する
    // （playground.tsx / search-craft-templates.ts の要素シェイプガードと同じ考え方）。
    type ImportRemap = Omit<ParsedRemap, "targetKey" | "software" | "notes"> & {
      targetKey: string | null;
      software: string | null;
      notes: string | null;
      remapType?: string | null;
    };
    let remaps: ImportRemap[];
    try {
      const parsed = JSON.parse(formString(formData, "remaps") ?? "");
      if (!Array.isArray(parsed)) throw new Error("not an array");
      remaps = (parsed as unknown[]).map((r) => {
        if (!r || typeof r !== "object") throw new Error("invalid element");
        const rec = r as Record<string, unknown>;
        if (typeof rec.sourceKey !== "string" || !rec.sourceKey) {
          throw new Error("missing sourceKey");
        }
        const targetKey = typeof rec.targetKey === "string" ? rec.targetKey : null;
        const software = typeof rec.software === "string" ? rec.software : null;
        const notes = typeof rec.notes === "string" ? rec.notes : null;
        // 文字列の長さ上限（画面側のパーサが作る値より十分緩い）
        if (
          rec.sourceKey.length > SAVE_LIMITS.shortText ||
          (targetKey?.length ?? 0) > SAVE_LIMITS.shortText ||
          (software?.length ?? 0) > SAVE_LIMITS.shortText ||
          (notes?.length ?? 0) > SAVE_LIMITS.memo
        ) {
          throw new Error("too long");
        }
        return {
          sourceKey: rec.sourceKey,
          targetKey,
          software,
          notes,
          remapType: rec.remapType as string | null | undefined,
        };
      });
    } catch {
      return { success: false, error: t("meImport.invalidData") };
    }
    if (remaps.length > SAVE_LIMITS.remaps) {
      return { success: false, error: t("meImport.tooManyItems") };
    }

    // 一意インデックス (userId, sourceKey, remapType) に対する upsert なので、
    // ループ内の冗長な findFirst は不要。onConflictDoUpdate に一本化する。
    // 途中失敗で部分適用にならないよう、インポート単位をトランザクションで原子化する。
    // SQLite の multi-row upsert は values 内を行順に処理するため、同一 conflict target が
    // 重複していても後勝ち＝逐次実行と同一結果になる。1000行上限に対し500行チャンクで往復を抑える。
    const remapRows = remaps.map((remap) => ({
      userId: user.id,
      sourceKey: remap.sourceKey,
      targetKey: remap.targetKey,
      software: remap.software,
      notes: remap.notes,
      remapType: normalizeKeyRemapType(remap.remapType),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await db.transaction(async (tx) => {
      for (let i = 0; i < remapRows.length; i += 500) {
        const chunk = remapRows.slice(i, i + 500);
        await tx
          .insert(keyRemaps)
          .values(chunk)
          .onConflictDoUpdate({
            target: [keyRemaps.userId, keyRemaps.sourceKey, keyRemaps.remapType],
            // remapType は conflict target に含まれるため set 不要（衝突行と常に同値）
            set: {
              targetKey: sql`excluded.target_key`,
              software: sql`excluded.software`,
              notes: sql`excluded.notes`,
              updatedAt: new Date(),
            },
          });
      }
    });

    // インポート後にプリセットへ反映（初回はプリセット自動作成、2回目以降はアクティブスナップショットを同期）
    const presetCreated = await syncPresetAfterImport(t, db, user.id, hasPresets);

    return { success: true, type: "remaps", count: remaps.length, presetCreated };
  }

  if (intent === "import-minecraft") {
    let keybindingsList: Array<{
      action: string;
      keyCode: string;
      category: "movement" | "combat" | "inventory" | "ui";
    }>;
    // 検証を通って実際に適用する値だけを持つ（null・欠落は「未指定」）
    const gameSettings: Partial<
      Pick<
        typeof playerConfigs.$inferInsert,
        "toggleSprint" | "toggleSneak" | "autoJump" | "fov" | "guiScale" | "rawInput" | "gameLanguage"
      >
    > = {};
    // category は keybindings.category 列の enum を allowlist として検証する
    // （SQLite側にCHECK制約が無いため、ここで弾かないと未知の文字列がそのままDBへ入り、
    // カテゴリ別グルーピング等の表示側が前提とする4値のいずれかという不変条件が崩れる）。
    // action/keyCode/category いずれかが不正な要素があれば、書き込みゼロでインポート全体を拒否する
    // （playground.tsx / search-craft-templates.ts の要素シェイプガードと同じ考え方）。
    const allowedCategories = keybindings.category.enumValues;
    try {
      const kb = JSON.parse(formString(formData, "keybindings") ?? "");
      const gs = JSON.parse(formString(formData, "gameSettings") ?? "");
      if (!Array.isArray(kb) || typeof gs !== "object" || gs === null || Array.isArray(gs)) {
        throw new Error("invalid shape");
      }
      keybindingsList = (kb as unknown[]).map((item) => {
        if (!item || typeof item !== "object") throw new Error("invalid element");
        const rec = item as Record<string, unknown>;
        if (typeof rec.action !== "string" || !rec.action || rec.action.length > SAVE_LIMITS.shortText) {
          throw new Error("missing action");
        }
        if (typeof rec.keyCode !== "string" || !rec.keyCode || rec.keyCode.length > SAVE_LIMITS.shortText) {
          throw new Error("missing keyCode");
        }
        if (typeof rec.category !== "string" || !(allowedCategories as readonly string[]).includes(rec.category)) {
          throw new Error("invalid category");
        }
        return {
          action: rec.action,
          keyCode: rec.keyCode,
          category: rec.category as (typeof allowedCategories)[number],
        };
      });
      // ゲーム設定。デバイス画面の保存と同じ検証関数（isValidFov / isValidGuiScale）を通す。
      // 型違い（数値でない fov など）は手作りのリクエストなのでインポート全体を拒否する。
      // 数値だが範囲外・非整数の fov / guiScale は、その項目だけ取り込まず既存値を保持する
      // （改造クライアントの値や、想定と違う形式のファイルで、キー配置ごと取り込めなくなるのを避ける）。
      // null・欠落は未指定として既存値を保持する（パーサが数値化に失敗した値は JSON で null になるため）
      const settings = gs as Record<string, unknown>;
      for (const key of ["toggleSprint", "toggleSneak", "autoJump", "rawInput"] as const) {
        const value = settings[key];
        if (value === undefined || value === null) continue;
        if (typeof value !== "boolean") throw new Error(`invalid ${key}`);
        gameSettings[key] = value;
      }
      if (settings.fov !== undefined && settings.fov !== null) {
        if (typeof settings.fov !== "number") throw new Error("invalid fov");
        if (isValidFov(settings.fov)) gameSettings.fov = settings.fov;
      }
      if (settings.guiScale !== undefined && settings.guiScale !== null) {
        if (typeof settings.guiScale !== "number") throw new Error("invalid guiScale");
        if (isValidGuiScale(settings.guiScale)) gameSettings.guiScale = settings.guiScale;
      }
      // ゲーム言語は許可リストで正規化する。許可リスト外（options.txt の独自言語など）は取り込まず既存値を保持する
      if (settings.gameLanguage !== undefined && settings.gameLanguage !== null) {
        if (typeof settings.gameLanguage !== "string") throw new Error("invalid gameLanguage");
        const language = normalizeGameLanguage(settings.gameLanguage);
        if (language !== null) gameSettings.gameLanguage = language;
      }
    } catch {
      return { success: false, error: t("meImport.invalidData") };
    }
    if (keybindingsList.length > SAVE_LIMITS.keybindingUpdates) {
      return { success: false, error: t("meImport.tooManyItems") };
    }

    // キーバインドとゲーム設定のインポートを1トランザクションで原子化する
    // （途中失敗による部分適用を防ぐ）
    // SQLite の multi-row upsert は values 内を行順に処理するため、同一 conflict target が
    // 重複していても後勝ち＝逐次実行と同一結果になる。1000行上限に対し500行チャンクで往復を抑える。
    const keybindingRows = keybindingsList.map((kb) => ({
      userId: user.id,
      action: kb.action,
      keyCode: kb.keyCode,
      category: kb.category,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await db.transaction(async (tx) => {
      // キーバインドをインポート
      for (let i = 0; i < keybindingRows.length; i += 500) {
        const chunk = keybindingRows.slice(i, i + 500);
        await tx
          .insert(keybindings)
          .values(chunk)
          .onConflictDoUpdate({
            target: [keybindings.userId, keybindings.action],
            set: {
              keyCode: sql`excluded.key_code`,
              category: sql`excluded.category`,
              updatedAt: new Date(),
            },
          });
      }

      // ゲーム設定をインポート
      if (Object.keys(gameSettings).length > 0) {
        const existingConfig = await tx.query.playerConfigs.findFirst({
          where: eq(playerConfigs.userId, user.id),
        });

        const configData: Partial<typeof playerConfigs.$inferInsert> = {
          updatedAt: new Date(),
        };

        Object.assign(configData, gameSettings);

        if (existingConfig) {
          await tx
            .update(playerConfigs)
            .set(configData)
            .where(eq(playerConfigs.userId, user.id));
        } else {
          await tx.insert(playerConfigs).values({
            userId: user.id,
            ...configData,
            createdAt: new Date(),
          });
        }
      }
    });

    // インポート後にプリセットへ反映（初回はプリセット自動作成、2回目以降はアクティブスナップショットを同期）
    const presetCreated = await syncPresetAfterImport(t, db, user.id, hasPresets);

    return {
      success: true,
      type: "minecraft",
      keybindingsCount: keybindingsList.length,
      gameSettingsCount: Object.keys(gameSettings).length,
      presetCreated,
    };
  }

  return { success: false, error: t("meImport.unknownIntent") };
}
