import { createTranslator } from "@/lib/messages";
import { Link, redirect } from "react-router";
import type { Route } from "./+types/login";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv, isDevAuthEnabled } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { authClient } from "@/lib/auth-client";
import { sanitizeReturnTo, encodeReturnToForCallback } from "@/lib/return-to";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useT } from "@/hooks/use-locale";
import { localeFromMatches } from "@/lib/locale";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("login.title");
  const description = t("login.description");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getOptionalSession(request, auth);
  const returnTo = sanitizeReturnTo(new URL(request.url).searchParams.get("returnTo"));

  // If already logged in, redirect appropriately
  if (session) {
    const user = await db.query.users.findFirst({
      where: eq(users.discordId, session.user.id),
    });

    if (user) {
      // User exists, go to returnTo（あれば）／プロフィール（/player/:slug は slug で解決するため
      // slug を使う。MCID 未設定ユーザーは mcid=null で /player/null になり 404 になるのを防ぐ）
      return redirect(returnTo || `/player/${user.slug}`);
    } else {
      // User needs to complete onboarding（returnTo はオンボーディング完了後に引き継ぐ）
      return redirect(returnTo ? `/onboarding?returnTo=${encodeURIComponent(returnTo)}` : "/onboarding");
    }
  }

  return {
    appUrl: env.APP_URL || "https://minefolio.app",
    devAuthEnabled: isDevAuthEnabled(),
    returnTo,
  };
}

export default function LoginPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const [isLoading, setIsLoading] = useState(false);
  const { returnTo } = loaderData;

  const handleDiscordLogin = async () => {
    setIsLoading(true);
    // returnTo は /onboarding のクエリとして引き継ぐ（既存ユーザーはそこで即座に returnTo へ、
    // 新規ユーザーはオンボーディング完了後に returnTo へ遷移する）。better-auth の callbackURL は
    // 独自の許可文字集合で検証されるため、encodeReturnToForCallback で追加エスケープする
    const callbackURL = returnTo
      ? `/onboarding?returnTo=${encodeReturnToForCallback(returnTo)}`
      : "/onboarding";
    await authClient.signIn.social({
      provider: "discord",
      callbackURL,
    });
  };

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Minefolio</CardTitle>
          <CardDescription>
            {t("login.cardDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleDiscordLogin}
            disabled={isLoading}
            className="w-full h-12 text-base"
            size="lg"
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <DiscordIcon className="mr-2 h-5 w-5" />
            )}
            {t("login.signInWithDiscord")}
          </Button>
          {loaderData.devAuthEnabled && (
            <Button asChild variant="outline" className="w-full">
              <Link to={returnTo ? `/dev/login?returnTo=${encodeURIComponent(returnTo)}` : "/dev/login"}>
                {t("devLogin.title")}
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}
