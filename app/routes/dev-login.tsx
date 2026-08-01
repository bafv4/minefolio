import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/dev-login";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv, isDevAuthEnabled } from "@/lib/env.server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, TerminalSquare } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { sanitizeReturnTo } from "@/lib/return-to";

/**
 * ローカル開発専用の簡易ログイン。
 * DEV_AUTH=1 かつ非本番（NODE_ENV !== "production"）のときのみ有効で、
 * それ以外では 404 を返す。better-auth の email/password 認証（ローカル限定で有効化）を使い、
 * ユーザー名から固定の疑似メールアドレスでサインアップ/サインインする。
 * セッション確立後は通常の /login → オンボーディングの流れに合流する。
 */

const DEV_PASSWORD = "minefolio-dev-password";
const USERNAME_PATTERN = /^[a-z0-9-]{1,20}$/;

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("devLogin.title") }];
};

export async function loader({ request }: Route.LoaderArgs) {
  if (!isDevAuthEnabled()) {
    throw new Response("Not Found", { status: 404 });
  }

  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));

  // ログイン済みなら /login の分岐（プロフィール or オンボーディング）に任せる
  // （returnTo は /login 側で再検証されるのでそのまま引き継ぐ）
  if (session) {
    return redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login");
  }

  return { returnTo };
}

export async function action({ request }: Route.ActionArgs) {
  const t = createTranslator(resolveLocale(request));
  if (!isDevAuthEnabled()) {
    throw new Response("Not Found", { status: 404 });
  }

  const formData = await request.formData();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    return { error: t("devLogin.invalidUsername") };
  }
  const returnTo = sanitizeReturnTo(formData.get("returnTo"));

  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const email = `${username}@dev.local`;

  // 既存アカウントならサインイン、未登録ならサインアップ（autoSignIn でセッションが張られる）
  let response = await auth.api.signInEmail({
    body: { email, password: DEV_PASSWORD },
    asResponse: true,
  });
  if (!response.ok) {
    response = await auth.api.signUpEmail({
      body: { email, password: DEV_PASSWORD, name: username },
      asResponse: true,
    });
  }
  if (!response.ok) {
    return { error: t("devLogin.failed") };
  }

  // better-auth が発行したセッション Cookie を引き継いで /login へ
  // （/login の loader がプロフィール or オンボーディングへ振り分ける。returnTo があれば引き継ぐ）
  const headers = new Headers({
    Location: returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login",
  });
  for (const cookie of response.headers.getSetCookie()) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}

export default function DevLoginPage({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const returnTo = loaderData?.returnTo ?? null;

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-2xl font-bold">
            <TerminalSquare className="h-6 w-6" />
            {t("devLogin.title")}
          </CardTitle>
          <CardDescription>{t("devLogin.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-4">
            {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
            <div className="space-y-2">
              <Label htmlFor="username">{t("devLogin.usernameLabel")}</Label>
              <Input
                id="username"
                name="username"
                defaultValue="dev"
                placeholder={t("devLogin.usernamePlaceholder")}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">{t("devLogin.usernameHint")}</p>
            </div>
            {actionData?.error && (
              <p className="text-sm text-destructive">{actionData.error}</p>
            )}
            <Button type="submit" disabled={isSubmitting} className="w-full h-11">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("devLogin.submit")}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
