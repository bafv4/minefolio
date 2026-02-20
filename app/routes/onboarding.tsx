import { useState } from "react";
import { redirect, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/onboarding";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { fetchUuidFromMcid, MojangError } from "@/lib/mojang";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { createDefaultsForNewUser } from "@/lib/defaults";
import { importFromLegacy } from "@/lib/legacy-import";
import { generateSlug } from "@/lib/slug";
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
import { Loader2, CheckCircle2, AlertCircle, Info, SkipForward } from "lucide-react";
import { t } from "@/lib/messages";

export const meta: Route.MetaFunction = () => {
  return [
    { title: t("onboarding.title") },
    { name: "description", content: t("onboarding.description") },
  ];
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // Must be logged in
  const session = await getSession(request, auth);

  // Check if user already completed onboarding
  const existingUser = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (existingUser) {
    // Already onboarded, redirect to profile
    return redirect(`/player/${existingUser.slug}`);
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
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const formData = await request.formData();
  const action = formData.get("_action") as string;

  if (action === "verify") {
    // Step 1: Verify MCID
    const mcid = (formData.get("mcid") as string)?.trim();

    if (!mcid) {
      return { error: t("onboarding.errorMcidRequired") };
    }

    if (mcid.length < 3 || mcid.length > 16) {
      return { error: t("onboarding.errorMcidLength") };
    }

    // Check if MCID is already registered
    const existingUser = await db.query.users.findFirst({
      where: eq(users.mcid, mcid),
    });

    if (existingUser) {
      return { error: t("onboarding.errorMcidTaken") };
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
          return { error: t("onboarding.errorMcidNotFound") };
        }
      }
      return { error: t("onboarding.errorVerifyFailed") };
    }
  }

  if (action === "complete") {
    // Step 2: Complete registration (with MCID)
    const mcid = formData.get("mcid") as string;
    const uuid = formData.get("uuid") as string;
    const importData = formData.get("importData") === "true";

    if (!mcid || !uuid) {
      return { error: t("onboarding.errorInvalidRequest") };
    }

    // Double-check MCID isn't taken
    const existingUser = await db.query.users.findFirst({
      where: eq(users.mcid, mcid),
    });

    if (existingUser) {
      return { error: t("onboarding.errorMcidTaken") };
    }

    // Create user with MCID
    const userId = createId();
    const slug = generateSlug(mcid, session.user.id);

    await db.insert(users).values({
      id: userId,
      discordId: session.user.id,
      mcid,
      uuid,
      slug,
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

    return redirect(`/player/${slug}`);
  }

  if (action === "skip") {
    // MCIDをスキップして登録
    const userId = createId();
    const slug = generateSlug(null, session.user.id);

    await db.insert(users).values({
      id: userId,
      discordId: session.user.id,
      mcid: null,
      uuid: null,
      slug,
      displayName: session.user.name,
      discordAvatar: session.user.image,
      hasImported: false,
    });

    // Create defaults
    await createDefaultsForNewUser(db, userId);

    return redirect(`/player/${slug}`);
  }

  return { error: t("onboarding.errorInvalidAction") };
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
            {t("onboarding.welcome")}
          </CardTitle>
          <CardDescription>
            {isVerified
              ? t("onboarding.stepConfirm")
              : t("onboarding.stepSetup")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isVerified ? (
            // Step 1: Enter MCID
            <>
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
                      {t("onboarding.connectedViaDiscord")}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mcid">{t("onboarding.mcidLabel")}</Label>
                  <Input
                    id="mcid"
                    name="mcid"
                    placeholder={t("onboarding.mcidPlaceholder")}
                    required
                    minLength={3}
                    maxLength={16}
                    disabled={isSubmitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    <Info className="inline w-3 h-3 mr-1" />
                    {t("onboarding.mcidHint")}
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
                    {t("onboarding.verifyLoading")}
                  </>
                ) : (
                  t("onboarding.verifyAndContinue")
                )}
              </Button>
            </fetcher.Form>

            {/* MCIDスキップオプション */}
            <div className="mt-4 pt-4 border-t">
              <fetcher.Form method="post">
                <input type="hidden" name="_action" value="skip" />
                <Button
                  type="submit"
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  disabled={isSubmitting}
                >
                  <SkipForward className="mr-2 h-4 w-4" />
                  {t("onboarding.skipMcid")}
                </Button>
              </fetcher.Form>
              <p className="text-xs text-muted-foreground text-center mt-2">
                {t("onboarding.skipHint")}
              </p>
            </div>
            </>
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
                    {t("onboarding.verifySuccess")}
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
                          {t("onboarding.legacyFoundTitle")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t("onboarding.legacyFoundHint")}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        type="submit"
                        name="importData"
                        value="true"
                        className="flex-1 h-11 sm:h-10"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        {t("onboarding.importData")}
                      </Button>
                      <Button
                        type="submit"
                        name="importData"
                        value="false"
                        variant="outline"
                        className="flex-1 h-11 sm:h-10"
                        disabled={isSubmitting}
                      >
                        {t("onboarding.startFresh")}
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
                        {t("onboarding.creatingProfile")}
                      </>
                    ) : (
                      t("onboarding.completeSetup")
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
