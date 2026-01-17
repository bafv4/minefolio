import { useState } from "react";
import { redirect, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/onboarding";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { fetchUuidFromMcid, MojangError } from "@/lib/mojang";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { createDefaultsForNewUser } from "@/lib/defaults";
import { importFromLegacy } from "@/lib/legacy-import";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertCircle, Info } from "lucide-react";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "ようこそ - Minefolio" },
    { name: "description", content: "Minefolioプロフィールを設定" },
  ];
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
  const auth = createAuth(db, env);

  // Must be logged in
  const session = await getSession(request, auth);

  // Check if user already completed onboarding
  const existingUser = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (existingUser) {
    // Already onboarded, redirect to profile
    return redirect(`/player/${existingUser.mcid}`);
  }

  return {
    discordUser: {
      id: session.user.id,
      name: session.user.name,
      image: session.user.image,
    },
    legacyApiUrl: env.LEGACY_API_URL ?? "https://mchotkeys.vercel.app",
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const formData = await request.formData();
  const action = formData.get("_action") as string;

  if (action === "verify") {
    // Step 1: Verify MCID
    const mcid = (formData.get("mcid") as string)?.trim();

    if (!mcid) {
      return { error: "Minecraft IDを入力してください" };
    }

    if (mcid.length < 3 || mcid.length > 16) {
      return { error: "Minecraft IDは3〜16文字である必要があります" };
    }

    // Check if MCID is already registered
    const existingUser = await db.query.users.findFirst({
      where: eq(users.mcid, mcid),
    });

    if (existingUser) {
      return { error: "このMinecraft IDは既に登録されています" };
    }

    // Verify with Mojang API
    try {
      const uuid = await fetchUuidFromMcid(mcid);

      // Check for legacy data
      const legacyApiUrl = env.LEGACY_API_URL ?? "https://mchotkeys.vercel.app";
      let hasLegacyData = false;

      try {
        const legacyResponse = await fetch(`${legacyApiUrl}/api/player/${mcid}`);
        hasLegacyData = legacyResponse.ok;
      } catch {
        // Ignore legacy check errors
      }

      return {
        verified: true,
        mcid,
        uuid,
        hasLegacyData,
      };
    } catch (error) {
      if (error instanceof MojangError) {
        if (error.code === "MCID_NOT_FOUND") {
          return { error: "Minecraft IDが見つかりません。確認してもう一度お試しください。" };
        }
      }
      return { error: "Minecraft IDの検証に失敗しました。もう一度お試しください。" };
    }
  }

  if (action === "complete") {
    // Step 2: Complete registration
    const mcid = formData.get("mcid") as string;
    const uuid = formData.get("uuid") as string;
    const importData = formData.get("importData") === "true";

    if (!mcid || !uuid) {
      return { error: "無効なリクエストです。最初からやり直してください。" };
    }

    // Double-check MCID isn't taken
    const existingUser = await db.query.users.findFirst({
      where: eq(users.mcid, mcid),
    });

    if (existingUser) {
      return { error: "このMinecraft IDは既に登録されています" };
    }

    // Create user
    const userId = createId();
    await db.insert(users).values({
      id: userId,
      discordId: session.user.id,
      mcid,
      uuid,
      displayName: session.user.name,
      discordAvatar: session.user.image,
      hasImported: importData,
    });

    // Import from legacy or create defaults
    if (importData) {
      const legacyApiUrl = env.LEGACY_API_URL ?? "https://mchotkeys.vercel.app";
      await importFromLegacy(db, userId, legacyApiUrl, mcid);
    } else {
      await createDefaultsForNewUser(db, userId);
    }

    return redirect(`/player/${mcid}`);
  }

  return { error: "無効な操作です" };
}

export default function OnboardingPage() {
  const { discordUser } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [step, setStep] = useState<1 | 2>(1);

  const isSubmitting = fetcher.state === "submitting";
  const data = fetcher.data;

  // If verified, show step 2
  const isVerified = data && "verified" in data && data.verified;

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">
            Minefolioへようこそ！
          </CardTitle>
          <CardDescription>
            {isVerified
              ? "もう少しです！プロフィールを確認してください。"
              : "プロフィールを設定しましょう"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isVerified ? (
            // Step 1: Enter MCID
            <fetcher.Form method="post" className="space-y-6">
              <input type="hidden" name="_action" value="verify" />

              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-secondary/50 rounded-lg">
                  <img
                    src={discordUser.image ?? undefined}
                    alt={discordUser.name ?? ""}
                    className="w-10 h-10 rounded-full"
                  />
                  <div>
                    <p className="font-medium">{discordUser.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Discord経由で接続済み
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mcid">Minecraft ID (MCID)</Label>
                  <Input
                    id="mcid"
                    name="mcid"
                    placeholder="例: Steve"
                    required
                    minLength={3}
                    maxLength={16}
                    disabled={isSubmitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    <Info className="inline w-3 h-3 mr-1" />
                    MCIDはMojang APIで検証されます
                  </p>
                </div>

                {data && "error" in data && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{data.error}</AlertDescription>
                  </Alert>
                )}
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    検証中...
                  </>
                ) : (
                  "検証して続行"
                )}
              </Button>
            </fetcher.Form>
          ) : (
            // Step 2: Confirm and complete
            <fetcher.Form method="post" className="space-y-6">
              <input type="hidden" name="_action" value="complete" />
              <input type="hidden" name="mcid" value={data.mcid} />
              <input type="hidden" name="uuid" value={data.uuid} />

              <div className="space-y-4">
                <Alert className="border-green-500/50 bg-green-500/10">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-600">
                    Minecraft IDの検証に成功しました！
                  </AlertDescription>
                </Alert>

                <div className="flex items-center gap-4 p-4 bg-secondary/50 rounded-lg">
                  <div className="w-16 h-16 rounded-lg overflow-hidden">
                    <MinecraftAvatar uuid={data.uuid} size={64} />
                  </div>
                  <div>
                    <p className="font-bold text-lg">{data.mcid}</p>
                    <p className="text-sm text-muted-foreground font-mono">
                      {data.uuid}
                    </p>
                  </div>
                </div>

                {data.hasLegacyData && (
                  <div className="space-y-3 p-4 border rounded-lg">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                      <div>
                        <p className="font-medium">
                          MCSRer Hotkeysのデータが見つかりました
                        </p>
                        <p className="text-sm text-muted-foreground">
                          キー配置と設定をインポートできます
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        name="importData"
                        value="true"
                        className="flex-1"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        データをインポート
                      </Button>
                      <Button
                        type="submit"
                        name="importData"
                        value="false"
                        variant="outline"
                        className="flex-1"
                        disabled={isSubmitting}
                      >
                        新規で始める
                      </Button>
                    </div>
                  </div>
                )}

                {!data.hasLegacyData && (
                  <Button
                    type="submit"
                    name="importData"
                    value="false"
                    className="w-full"
                    size="lg"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        プロフィールを作成中...
                      </>
                    ) : (
                      "セットアップを完了"
                    )}
                  </Button>
                )}
              </div>
            </fetcher.Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
