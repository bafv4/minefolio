import { useLoaderData, useRevalidator } from "react-router";
import type { Route } from "./+types/import";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, keybindings, keyRemaps, playerConfigs, configPresets, customKeys, customActions, itemLayouts, searchCrafts } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { ImportDialog } from "@/components/import-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Upload, Keyboard, Settings, Info } from "lucide-react";
import { getKeyLabel, getActionLabel } from "@/lib/keybindings";
import type { ParsedRemap } from "@/lib/import-parser";
import { createPresetFromImport, syncActivePresetSnapshot } from "@/lib/preset-utils";
import { t } from "@/lib/messages";

export const meta: Route.MetaFunction = () => {
  return [
    { title: t("meImport.title") },
    { name: "description", content: t("meImport.description") },
  ];
};

export async function loader({ context, request }: Route.LoaderArgs) {
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

export async function action({ context, request }: Route.ActionArgs) {
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

  if (intent === "import-remaps") {
    let remaps: ParsedRemap[];
    try {
      const parsed = JSON.parse((formData.get("remaps") as string) ?? "");
      if (!Array.isArray(parsed)) throw new Error("not an array");
      remaps = parsed as ParsedRemap[];
    } catch {
      return { success: false, error: t("meImport.invalidData") };
    }
    if (remaps.length > 1000) {
      return { success: false, error: t("meImport.tooManyItems") };
    }

    // 一意インデックス (userId, sourceKey) に対する upsert なので、
    // ループ内の冗長な findFirst は不要。onConflictDoUpdate に一本化する。
    for (const remap of remaps) {
      await db
        .insert(keyRemaps)
        .values({
          userId: user.id,
          sourceKey: remap.sourceKey,
          targetKey: remap.targetKey,
          software: remap.software,
          notes: remap.notes,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [keyRemaps.userId, keyRemaps.sourceKey],
          set: {
            targetKey: remap.targetKey,
            software: remap.software,
            notes: remap.notes,
            updatedAt: new Date(),
          },
        });
    }

    // インポート後にプリセットを自動作成
    // 更新されたデータを取得
    const updatedKeybindings = await db.query.keybindings.findMany({
      where: eq(keybindings.userId, user.id),
    });
    const updatedPlayerConfig = await db.query.playerConfigs.findFirst({
      where: eq(playerConfigs.userId, user.id),
    });
    const updatedKeyRemaps = await db.query.keyRemaps.findMany({
      where: eq(keyRemaps.userId, user.id),
    });
    const updatedItemLayouts = await db.query.itemLayouts.findMany({
      where: eq(itemLayouts.userId, user.id),
    });
    const updatedSearchCrafts = await db.query.searchCrafts.findMany({
      where: eq(searchCrafts.userId, user.id),
    });
    const updatedCustomKeys = await db.query.customKeys.findMany({
      where: eq(customKeys.userId, user.id),
    });
    const updatedCustomActions = await db.query.customActions.findMany({
      where: eq(customActions.userId, user.id),
    });

    // プリセットが既に存在する場合は作成しない（最初のインポートのみ）
    const existingPresets = await db.query.configPresets.findMany({
      where: eq(configPresets.userId, user.id),
    });

    if (existingPresets.length === 0) {
      await createPresetFromImport(
        db,
        user.id,
        updatedKeybindings,
        updatedPlayerConfig ?? null,
        updatedKeyRemaps,
        updatedItemLayouts,
        updatedSearchCrafts,
        updatedCustomKeys,
        updatedCustomActions,
      );
    } else {
      // 既存プリセットが存在する場合はアクティブプリセットのスナップショットを更新
      await syncActivePresetSnapshot(db, user.id, [
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

    return { success: true, type: "remaps", count: remaps.length, presetCreated: existingPresets.length === 0 };
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
    try {
      const kb = JSON.parse((formData.get("keybindings") as string) ?? "");
      const gs = JSON.parse((formData.get("gameSettings") as string) ?? "");
      if (!Array.isArray(kb) || typeof gs !== "object" || gs === null) {
        throw new Error("invalid shape");
      }
      keybindingsList = kb;
      gameSettings = gs;
    } catch {
      return { success: false, error: t("meImport.invalidData") };
    }
    if (keybindingsList.length > 1000) {
      return { success: false, error: t("meImport.tooManyItems") };
    }

    // キーバインドをインポート
    for (const kb of keybindingsList) {
      await db
        .insert(keybindings)
        .values({
          userId: user.id,
          action: kb.action,
          keyCode: kb.keyCode,
          category: kb.category,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [keybindings.userId, keybindings.action],
          set: {
            keyCode: kb.keyCode,
            category: kb.category,
            updatedAt: new Date(),
          },
        });
    }

    // ゲーム設定をインポート
    if (Object.keys(gameSettings).length > 0) {
      const existingConfig = await db.query.playerConfigs.findFirst({
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
        await db
          .update(playerConfigs)
          .set(configData)
          .where(eq(playerConfigs.userId, user.id));
      } else {
        await db.insert(playerConfigs).values({
          userId: user.id,
          ...configData,
          createdAt: new Date(),
        });
      }
    }

    // インポート後にプリセットを自動作成
    // 更新されたデータを取得
    const updatedKeybindings = await db.query.keybindings.findMany({
      where: eq(keybindings.userId, user.id),
    });
    const updatedPlayerConfig = await db.query.playerConfigs.findFirst({
      where: eq(playerConfigs.userId, user.id),
    });
    const updatedKeyRemaps = await db.query.keyRemaps.findMany({
      where: eq(keyRemaps.userId, user.id),
    });
    const updatedItemLayouts = await db.query.itemLayouts.findMany({
      where: eq(itemLayouts.userId, user.id),
    });
    const updatedSearchCrafts = await db.query.searchCrafts.findMany({
      where: eq(searchCrafts.userId, user.id),
    });
    const updatedCustomKeys = await db.query.customKeys.findMany({
      where: eq(customKeys.userId, user.id),
    });
    const updatedCustomActions = await db.query.customActions.findMany({
      where: eq(customActions.userId, user.id),
    });

    // プリセットが既に存在する場合は作成しない（最初のインポートのみ）
    const existingPresets = await db.query.configPresets.findMany({
      where: eq(configPresets.userId, user.id),
    });

    if (existingPresets.length === 0) {
      await createPresetFromImport(
        db,
        user.id,
        updatedKeybindings,
        updatedPlayerConfig ?? null,
        updatedKeyRemaps,
        updatedItemLayouts,
        updatedSearchCrafts,
        updatedCustomKeys,
        updatedCustomActions,
      );
    } else {
      // 既存プリセットが存在する場合はアクティブプリセットのスナップショットを更新
      await syncActivePresetSnapshot(db, user.id, [
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

    return {
      success: true,
      type: "minecraft",
      keybindingsCount: keybindingsList.length,
      gameSettingsCount: Object.keys(gameSettings).length,
      presetCreated: existingPresets.length === 0,
    };
  }

  return { success: false };
}

export default function ImportPage() {
  const { remapCount, keybindingCount } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Upload className="h-6 w-6" />
          {t("meImport.pageTitle")}
        </h1>
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
                XButton1::e ; コメント
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
