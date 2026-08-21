import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useLoaderData, useRevalidator } from "react-router";
import type { Route } from "./+types/import";
import { createDb, type Database } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, keybindings, keyRemaps, playerConfigs, configPresets, customKeys, customActions, itemLayouts, searchCrafts } from "@/lib/schema";
import { eq, desc, sql } from "drizzle-orm";
import { ImportDialog } from "@/components/import-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Keyboard, Settings, Info } from "lucide-react";
import { getKeyLabel, getActionLabel } from "@/lib/keybindings";
import type { ParsedRemap } from "@/lib/import-parser";
import { normalizeKeyRemapType } from "@/lib/remap-utils";
import { createPresetFromImport, syncActivePresetSnapshot } from "@/lib/preset-utils";
import { useT } from "@/hooks/use-locale";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [
    { title: t("meImport.title") },
    { name: "description", content: t("meImport.description") },
  ];
};

export async function loader({ request }: Route.LoaderArgs) {
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

  // 現在のリマップ数とキーバインド数を取得
  const remapCount = await db.query.keyRemaps.findMany({
    where: eq(keyRemaps.userId, user.id),
  });

  const keybindingCount = await db.query.keybindings.findMany({
    where: eq(keybindings.userId, user.id),
  });

  return {
    remapCount: remapCount.length,
    keybindingCount: keybindingCount.length,
  };
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
async function syncPresetAfterImport(db: Database, userId: string, hasPresets: boolean): Promise<boolean> {
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
  const intent = formData.get("intent") as string;

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
      const parsed = JSON.parse((formData.get("remaps") as string) ?? "");
      if (!Array.isArray(parsed)) throw new Error("not an array");
      remaps = (parsed as unknown[]).map((r) => {
        if (!r || typeof r !== "object") throw new Error("invalid element");
        const rec = r as Record<string, unknown>;
        if (typeof rec.sourceKey !== "string" || !rec.sourceKey) {
          throw new Error("missing sourceKey");
        }
        return {
          sourceKey: rec.sourceKey,
          targetKey: typeof rec.targetKey === "string" ? rec.targetKey : null,
          software: typeof rec.software === "string" ? rec.software : null,
          notes: typeof rec.notes === "string" ? rec.notes : null,
          remapType: rec.remapType as string | null | undefined,
        };
      });
    } catch {
      return { success: false, error: t("meImport.invalidData") };
    }
    if (remaps.length > 1000) {
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
    const presetCreated = await syncPresetAfterImport(db, user.id, hasPresets);

    return { success: true, type: "remaps", count: remaps.length, presetCreated };
  }

  if (intent === "import-minecraft") {
    let keybindingsList: Array<{
      action: string;
      keyCode: string;
      category: "movement" | "combat" | "inventory" | "ui";
    }>;
    let gameSettings: {
      toggleSprint?: boolean;
      toggleSneak?: boolean;
      autoJump?: boolean;
      fov?: number;
      guiScale?: number;
      rawInput?: boolean;
      gameLanguage?: string;
    };
    // category は keybindings.category 列の enum を allowlist として検証する
    // （SQLite側にCHECK制約が無いため、ここで弾かないと未知の文字列がそのままDBへ入り、
    // カテゴリ別グルーピング等の表示側が前提とする4値のいずれかという不変条件が崩れる）。
    // action/keyCode/category いずれかが不正な要素があれば、書き込みゼロでインポート全体を拒否する
    // （playground.tsx / search-craft-templates.ts の要素シェイプガードと同じ考え方）。
    const allowedCategories = keybindings.category.enumValues;
    try {
      const kb = JSON.parse((formData.get("keybindings") as string) ?? "");
      const gs = JSON.parse((formData.get("gameSettings") as string) ?? "");
      if (!Array.isArray(kb) || typeof gs !== "object" || gs === null) {
        throw new Error("invalid shape");
      }
      keybindingsList = (kb as unknown[]).map((item) => {
        if (!item || typeof item !== "object") throw new Error("invalid element");
        const rec = item as Record<string, unknown>;
        if (typeof rec.action !== "string" || !rec.action) {
          throw new Error("missing action");
        }
        if (typeof rec.keyCode !== "string" || !rec.keyCode) {
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
      gameSettings = gs;
    } catch {
      return { success: false, error: t("meImport.invalidData") };
    }
    if (keybindingsList.length > 1000) {
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

        if (gameSettings.toggleSprint !== undefined) {
          configData.toggleSprint = gameSettings.toggleSprint;
        }
        if (gameSettings.toggleSneak !== undefined) {
          configData.toggleSneak = gameSettings.toggleSneak;
        }
        if (gameSettings.autoJump !== undefined) {
          configData.autoJump = gameSettings.autoJump;
        }
        if (gameSettings.fov !== undefined) {
          configData.fov = gameSettings.fov;
        }
        if (gameSettings.guiScale !== undefined) {
          configData.guiScale = gameSettings.guiScale;
        }
        if (gameSettings.rawInput !== undefined) {
          configData.rawInput = gameSettings.rawInput;
        }
        if (gameSettings.gameLanguage !== undefined) {
          configData.gameLanguage = gameSettings.gameLanguage;
        }

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
    const presetCreated = await syncPresetAfterImport(db, user.id, hasPresets);

    return {
      success: true,
      type: "minecraft",
      keybindingsCount: keybindingsList.length,
      gameSettingsCount: Object.keys(gameSettings).length,
      presetCreated,
    };
  }

  return { success: false };
}

export default function ImportPage() {
  const t = useT();
  const { remapCount, keybindingCount } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("meImport.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("meImport.pageDescription")}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* リマップインポート */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              {t("meImport.remapTitle")}
            </CardTitle>
            <CardDescription>
              {t("meImport.remapDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              <p className="text-muted-foreground mb-2">{t("meImport.supportedFormat")}</p>
              <div className="bg-muted p-2 rounded font-mono text-xs">
                CapsLock::Ctrl<br />
                a::b<br />
                XButton1::e ; {t("meImport.ahkCommentExample")}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t("meImport.currentCountLabel")} <Badge variant="secondary">{remapCount}{t("meImport.countUnit")}</Badge>
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Minecraft設定インポート */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {t("meImport.minecraftTitle")}
            </CardTitle>
            <CardDescription>
              {t("meImport.minecraftDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              <p className="text-muted-foreground mb-2">{t("meImport.supportedFiles")}</p>
              <ul className="list-disc list-inside text-xs space-y-1">
                <li><code className="bg-muted px-1 rounded">options.txt</code> - {t("meImport.minecraftFolder")}</li>
                <li><code className="bg-muted px-1 rounded">standardsettings.json</code> - StandardSettings Mod</li>
              </ul>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t("meImport.currentCountLabel")} <Badge variant="secondary">{keybindingCount}{t("meImport.countUnit")}</Badge>
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t("meImport.importInfoTitle")}</AlertTitle>
        <AlertDescription>
          {t("meImport.importInfoDescription")}
        </AlertDescription>
      </Alert>

      <div className="flex justify-center">
        <ImportDialog onSuccess={() => revalidator.revalidate()} />
      </div>
    </div>
  );
}
