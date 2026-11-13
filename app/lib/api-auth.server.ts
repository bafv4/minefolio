// JSON API ルート（api/likes・api/profile-reactions・api/favorites）用の認証ヘルパー。
//
// これらのルートはフォーム action ではなく fetch から叩かれる JSON リソースルートのため、
// getSession の「未ログインなら throw redirect("/login")」という挙動をそのまま使えない
// （fetch が302を追って「200 + ログインHTML」を返し、呼び出し側の res.json() が壊れる）。
// getOptionalSession + users.discordId 引き直しのこの形が3ルートで同型に重複していたため
// ここへ集約する。

import { eq } from "drizzle-orm";
import type { Auth } from "./auth";
import type { Database } from "./db";
import { getOptionalSession } from "./session";
import { users } from "./schema";

/**
 * セッションから内部ユーザーIDを解決する（JSON API ルート専用）。
 * session.user.id は Discord ID なので users.discordId で引き直す。
 * 未ログイン、またはセッションはあるが users 行が無い（未オンボーディング）場合は
 * null を返す（呼び出し側はどちらも同じ「未認証」として扱う）。
 */
export async function getApiUser(
  db: Database,
  auth: Auth,
  request: Request,
): Promise<{ id: string } | null> {
  const session = await getOptionalSession(request, auth);
  if (!session) return null;
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    columns: { id: true },
  });
  return user ?? null;
}

type UserRow = typeof users.$inferSelect;

/** Content-Type のみを付ける素の JSON レスポンス（Cache-Control を付けない既存 API 用）。 */
export function plainJsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * 認証必須の JSON API ルート用。未ログインは 401（Unauthorized）、users 行が無ければ
 * 404（User not found）の Response を `response` として返す（getApiUser と違い両者を区別する）。
 * `columns` で取得列を絞れる（`id` は常に含む。省略時は全列）。返す Response のヘッダは Content-Type のみ。
 */
export async function requireApiUser<K extends keyof UserRow = keyof UserRow>(
  db: Database,
  auth: Auth,
  request: Request,
  columns?: readonly K[],
): Promise<
  | { user: Pick<UserRow, K | "id">; response?: undefined }
  | { user?: undefined; response: Response }
> {
  const session = await getOptionalSession(request, auth);
  if (!session) {
    return { response: plainJsonResponse({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    ...(columns
      ? { columns: Object.fromEntries([...columns, "id"].map((k) => [k, true])) }
      : {}),
  });
  if (!user) {
    return { response: plainJsonResponse({ error: "User not found" }, { status: 404 }) };
  }
  return { user: user as Pick<UserRow, K | "id"> };
}

/** JSON API ルート用のレスポンス。閲覧者ごとに異なる応答なので、CDN・ブラウザともにキャッシュさせない。 */
export function apiJsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "private, no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}
