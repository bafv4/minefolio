import { Link, redirect } from "react-router";
import type { Route } from "./+types/login";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { authClient } from "@/lib/auth-client";
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

export const meta: Route.MetaFunction = () => {
  return [
    { title: "ログイン - Minefolio" },
    { name: "description", content: "DiscordでMinefolioにサインイン" },
  ];
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context;
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getOptionalSession(request, auth);

  // If already logged in, redirect appropriately
  if (session) {
    const user = await db.query.users.findFirst({
      where: eq(users.discordId, session.user.id),
    });

    if (user) {
      // User exists, go to their profile
      return redirect(`/player/${user.mcid}`);
    } else {
      // User needs to complete onboarding
      return redirect("/onboarding");
    }
  }

  return {};
}

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);

  const handleDiscordLogin = async () => {
    setIsLoading(true);
    await authClient.signIn.social({
      provider: "discord",
      callbackURL: "/onboarding",
    });
  };

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Minefolio</CardTitle>
          <CardDescription>
            スピードランナーポートフォリオを管理するにはサインインしてください
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
            Discordでログイン
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            サインインすることで、
            <Link to="/terms" className="underline hover:text-foreground">
              利用規約
            </Link>
            と
            <Link to="/privacy" className="underline hover:text-foreground">
              プライバシーポリシー
            </Link>
            に同意したものとみなされます。
          </p>
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
