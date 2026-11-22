import { createContext, redirect } from "react-router";
import { eq } from "drizzle-orm";
import type { Auth } from "./auth";
import type { Database } from "./db";
import { users } from "./schema";
import { sanitizeReturnTo } from "./return-to";

// 同一 Request 内のセッション取得を共有する。React Router は同じドキュメント／.data リクエストの
// 並列ローダー・親子ローダーに同一の Request インスタンスを渡すため、進行中の Promise をキーにして
// better-auth の DB クエリ（Turso の往復）を1回にまとめる。キーは Request のみ（セッションは
// Cookie＝request.headers だけで決まり、auth インスタンスが違っても結果は同じ）。
// action 後の再検証ローダーには新しい Request が作られるため、ログイン/ログアウト後に古い値は残らない。
const sessionByRequest = new WeakMap<Request, ReturnType<Auth["api"]["getSession"]>>();

function loadSession(request: Request, auth: Auth) {
  let pending = sessionByRequest.get(request);
  if (!pending) {
    pending = auth.api.getSession({ headers: request.headers });
    sessionByRequest.set(request, pending);
    // reject したら失敗を共有し続けないようエントリを消す（呼び出し側は pending を await して
    // 同じエラーを受け取るので、この catch は未処理 rejection を作らない）。
    pending.catch(() => sessionByRequest.delete(request));
  }
  return pending;
}

// セッション取得（認証必須）。未ログインなら /login?returnTo=<元のURL> へリダイレクトし、
// ログイン後に元のページへ戻れるようにする（returnTo の検証は sanitizeReturnTo に集約）。
export async function getSession(request: Request, auth: Auth) {
  const session = await loadSession(request, auth);

  if (!session) {
    const url = new URL(request.url);
    const returnTo = sanitizeReturnTo(`${url.pathname}${url.search}`);
    throw redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login");
  }

  return session;
}

// セッション取得（認証任意）
export async function getOptionalSession(request: Request, auth: Auth) {
  const session = await loadSession(request, auth);

  return session;
}

type UserRow = typeof users.$inferSelect;

/**
 * /me/* のレイアウトのミドルウェア（routes/me/_layout.tsx）が解決した「登録済みユーザー行」を、
 * 同じリクエストのレイアウト loader へ渡すための context キー（同じ行を二重に読まないため）。
 * 未設定（ミドルウェアを通っていない）なら null。
 */
export const registeredUserContext = createContext<UserRow | null>(null);

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
    // 元のページ（returnTo）を付け、ウィザード完了後に戻れるようにする（検証は sanitizeReturnTo）
    const url = new URL(request.url);
    const returnTo = sanitizeReturnTo(`${url.pathname}${url.search}`);
    throw redirect(returnTo ? `/onboarding?returnTo=${encodeURIComponent(returnTo)}` : "/onboarding");
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
  const session = await loadSession(request, auth);

  return session !== null;
}
