import { redirect } from "react-router";
import { eq } from "drizzle-orm";
import type { Auth } from "./auth";
import type { Database } from "./db";
import { users } from "./schema";

// セッション取得（認証必須）
export async function getSession(request: Request, auth: Auth) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    throw redirect("/login");
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

// 現在のユーザー取得（認証必須、オンボーディング必須）
export async function getCurrentUser(request: Request, auth: Auth, db: Database) {
  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
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
