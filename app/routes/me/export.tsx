// データエクスポート機能
import { Download, FileJson, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/lib/db";
import { redirect } from "react-router";
import { eq } from "drizzle-orm";
import {
  users,
  playerConfigs,
  keybindings,
  customKeys,
  keyRemaps,
  configPresets,
  categoryRecords,
  socialLinks,
} from "@/lib/schema";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { t } from "@/lib/messages";

export async function loader({ request, context }: { request: Request; context: any }) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);

  if (!session?.user) {
    return redirect("/login");
  }

  return { user: session.user };
}

export async function action({ request, context }: { request: Request; context: any }) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);

  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const format = formData.get("format") as string;

  if (!["json", "csv"].includes(format)) {
    return Response.json({ error: "Invalid format" }, { status: 400 });
  }

  // ユーザーを取得（discordIdで検索）
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // すべてのユーザーデータを取得
  const [
    configData,
    keybindingsData,
    customKeysData,
    keyRemapsData,
    presetsData,
    recordsData,
    socialLinksData,
  ] = await Promise.all([
    db.query.playerConfigs.findFirst({ where: eq(playerConfigs.userId, user.id) }),
    db.query.keybindings.findMany({ where: eq(keybindings.userId, user.id) }),
    db.query.customKeys.findMany({ where: eq(customKeys.userId, user.id) }),
    db.query.keyRemaps.findMany({ where: eq(keyRemaps.userId, user.id) }),
    db.query.configPresets.findMany({ where: eq(configPresets.userId, user.id) }),
    db.query.categoryRecords.findMany({ where: eq(categoryRecords.userId, user.id) }),
    db.query.socialLinks.findMany({ where: eq(socialLinks.userId, user.id) }),
  ]);
  const userData = user;

  const exportData = {
    user: userData,
    config: configData,
    keybindings: keybindingsData,
    customKeys: customKeysData,
    keyRemaps: keyRemapsData,
    presets: presetsData,
    records: recordsData,
    socialLinks: socialLinksData,
    exportedAt: new Date().toISOString(),
  };

  if (format === "json") {
    // JSON形式でエクスポート
    const json = JSON.stringify(exportData, null, 2);
    const filename = `minefolio_export_${new Date().toISOString().split("T")[0]}.json`;

    return new Response(json, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } else if (format === "csv") {
    // CSV形式でエクスポート（キーバインドのみ）
    const csv = convertKeybindingsToCSV(keybindingsData);
    const filename = `minefolio_keybindings_${new Date().toISOString().split("T")[0]}.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return Response.json({ error: "Invalid format" }, { status: 400 });
}

export default function ExportPage() {
  return (
    <div className="container max-w-4xl py-8">
      <h1 className="text-3xl font-bold mb-6">{t("meExport.title")}</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5" />
              {t("meExport.jsonFormat")}
            </CardTitle>
            <CardDescription>
              {t("meExport.jsonDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="post">
              <input type="hidden" name="format" value="json" />
              <Button type="submit" className="w-full h-11">
                <Download className="h-4 w-4 mr-2" />
                {t("meExport.downloadJson")}
              </Button>
            </form>
            <p className="text-sm text-muted-foreground mt-4">
              {t("meExport.includedData")}
            </p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1">
              <li>• {t("meExport.includeProfile")}</li>
              <li>• {t("meExport.includeKeybindings")}</li>
              <li>• {t("meExport.includeDevices")}</li>
              <li>• {t("meExport.includePresets")}</li>
              <li>• {t("meExport.includeRecords")}</li>
              <li>• {t("meExport.includeSocialLinks")}</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("meExport.csvFormat")}
            </CardTitle>
            <CardDescription>
              {t("meExport.csvDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="post">
              <input type="hidden" name="format" value="csv" />
              <Button type="submit" variant="outline" className="w-full h-11">
                <Download className="h-4 w-4 mr-2" />
                {t("meExport.downloadCsv")}
              </Button>
            </form>
            <p className="text-sm text-muted-foreground mt-4">
              {t("meExport.includedData")}
            </p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1">
              <li>• {t("meExport.includeKeybindingList")}</li>
              <li>• {t("meExport.includeCategory")}</li>
              <li>• {t("meExport.includeKeyCode")}</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("meExport.privacyTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• {t("meExport.privacy1")}</p>
          <p>• {t("meExport.privacy2")}</p>
          <p>• {t("meExport.privacy3")}</p>
          <p>• {t("meExport.privacy4")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * キーバインドデータをCSV形式に変換
 */
function convertKeybindingsToCSV(keybindings: any[]): string {
  const headers = ["Action", "Key Code", "Category"];
  const rows = keybindings.map((kb) => [
    kb.action,
    kb.keyCode,
    kb.category,
  ]);

  const csv = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
  ].join("\n");

  return csv;
}
