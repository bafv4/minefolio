// データエクスポート機能
import { Download, FileJson, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAuth } from "@/lib/auth";
import { redirect } from "react-router";
import { drizzle } from "drizzle-orm/d1";
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

export async function loader({ request, context }: { request: Request; context: any }) {
  const env = context.env ?? getEnv();
  const db = drizzle(env.DB);
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);

  if (!session?.user) {
    return redirect("/login");
  }

  return { user: session.user };
}

export async function action({ request, context }: { request: Request; context: any }) {
  const env = context.env ?? getEnv();
  const db = drizzle(env.DB);
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

  // すべてのユーザーデータを取得
  const [
    userData,
    configData,
    keybindingsData,
    customKeysData,
    keyRemapsData,
    presetsData,
    recordsData,
    socialLinksData,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.id, session.user.id)).get(),
    db.select().from(playerConfigs).where(eq(playerConfigs.userId, session.user.id)).get(),
    db.select().from(keybindings).where(eq(keybindings.userId, session.user.id)).all(),
    db.select().from(customKeys).where(eq(customKeys.userId, session.user.id)).all(),
    db.select().from(keyRemaps).where(eq(keyRemaps.userId, session.user.id)).all(),
    db.select().from(configPresets).where(eq(configPresets.userId, session.user.id)).all(),
    db.select().from(categoryRecords).where(eq(categoryRecords.userId, session.user.id)).all(),
    db.select().from(socialLinks).where(eq(socialLinks.userId, session.user.id)).all(),
  ]);

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
      <h1 className="text-3xl font-bold mb-6">データエクスポート</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5" />
              JSON形式
            </CardTitle>
            <CardDescription>
              すべてのデータを包括的にエクスポート
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="post">
              <input type="hidden" name="format" value="json" />
              <Button type="submit" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                JSONをダウンロード
              </Button>
            </form>
            <p className="text-sm text-muted-foreground mt-4">
              含まれるデータ:
            </p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1">
              <li>• プロフィール情報</li>
              <li>• キーバインド設定</li>
              <li>• デバイス設定</li>
              <li>• プリセット</li>
              <li>• 記録</li>
              <li>• ソーシャルリンク</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              CSV形式
            </CardTitle>
            <CardDescription>
              キーバインド設定のみをスプレッドシート形式で
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="post">
              <input type="hidden" name="format" value="csv" />
              <Button type="submit" variant="outline" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                CSVをダウンロード
              </Button>
            </form>
            <p className="text-sm text-muted-foreground mt-4">
              含まれるデータ:
            </p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1">
              <li>• キーバインド一覧</li>
              <li>• カテゴリー分類</li>
              <li>• キーコード</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>プライバシーとセキュリティ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            • エクスポートされたデータには個人情報（Discord ID、メールアドレスなど）が含まれます
          </p>
          <p>
            • ダウンロードしたファイルは安全に保管してください
          </p>
          <p>
            • データは暗号化されていません。共有する際は注意してください
          </p>
          <p>
            • JSONファイルはインポート機能で再度読み込むことができます
          </p>
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
