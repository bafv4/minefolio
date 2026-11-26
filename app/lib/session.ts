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

type UserRowShared = typeof users.$inferSelect;

// 同一 Request 内の「users 行（discord_id 引き）」の読み取りを共有する。loadSession と同じ方式で、
// 進行中の Promise を Request をキーに保持する（内側は discordId ごと）。
// 設計: 呼び出しごとに必要な列が違うため、全列を1回読んで使い回す（users は1行で、全列読みでも
// 往復は1回のまま。列を絞った別クエリを混ぜると結局2回読むことになる）。`with`（リレーション）を伴う
// 呼び出しは共有できないので対象外（従来どおり db.query.users.findFirst を直接呼ぶ）。
// 返す行は呼び出しごとに浅いコピーなので、呼び出し側が書き換えても他の呼び出しへ波及しない。
// 注意: 同じ Request の中で users を更新した後に読み直す用途には使わない（古い行を返す）。
// action 後の再検証ローダーには新しい Request が作られるので、古い行は残らない。
const userByRequest = new WeakMap<Request, Map<string, Promise<UserRowShared | undefined>>>();

export async function loadUserByDiscordId(
  request: Request,
  db: Database,
  discordId: string,
): Promise<UserRowShared | undefined> {
  let perRequest = userByRequest.get(request);
  if (!perRequest) {
    perRequest = new Map();
    userByRequest.set(request, perRequest);
  }
  let pending = perRequest.get(discordId);
  if (!pending) {
    pending = db.query.users.findFirst({ where: eq(users.discordId, discordId) });
    perRequest.set(discordId, pending);
    // reject したら失敗を共有し続けないようエントリを消す
    const map = perRequest;
    pending.catch(() => map.delete(discordId));
  }
  const row = await pending;
  return row ? { ...row } : undefined;
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
