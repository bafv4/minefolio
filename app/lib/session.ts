import { redirect } from "react-router";
import { eq } from "drizzle-orm";
import type { Auth } from "./auth";
import type { Database } from "./db";
import { users } from "./schema";
import { sanitizeReturnTo } from "./return-to";

// セッション取得（認証必須）。未ログインなら /login?returnTo=<元のURL> へリダイレクトし、
// ログイン後に元のページへ戻れるようにする（returnTo の検証は sanitizeReturnTo に集約）。
export async function getSession(request: Request, auth: Auth) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    const url = new URL(request.url);
    const returnTo = sanitizeReturnTo(`${url.pathname}${url.search}`);
    throw redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login");
  }

  return session;
}

// セッション取得（認証任意）
export async function getOptionalSession(request: Request, auth: Auth) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  return session;
}

type UserRow = typeof users.$inferSelect;

/**
 * 「登録済み」の述語。users 行があり、かつ初期設定ウィザード（/onboarding）を完了していること。
 * /login・/onboarding の loader と getCurrentUser で共有する（判定をここ1箇所に集約する）。
 * 型述語は `onboardingCompleted: true` まで絞る（単に UserRow とすると、false 側で
 * 「未完了の行」まで undefined に絞り込まれてしまうため）。
 */
export function isRegistered(
  user: UserRow | null | undefined,
): user is UserRow & { onboardingCompleted: true } {
  return !!user && user.onboardingCompleted;
}

// 現在のユーザー取得（認証必須、オンボーディング完了必須）
// 未登録（行が無い、またはウィザード未完了）なら /onboarding へ。ウィザードの各ステップは
// スキップできるため、途中離脱したユーザーも公開範囲を選ぶだけで抜けられる（実質ロックにはならない）
export async function getCurrentUser(request: Request, auth: Auth, db: Database) {
  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!isRegistered(user)) {
    throw redirect("/onboarding");
  }

  return { session, user };
}

// 現在のユーザー取得（認証必須、オンボーディング任意）
export async function getCurrentUserOrOnboarding(request: Request, auth: Auth, db: Database) {
  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  return { session, user };
}

// 認証済みかどうかを確認
export async function isAuthenticated(request: Request, auth: Auth): Promise<boolean> {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  return session !== null;
}
