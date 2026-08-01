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

/** JSON API ルート用のレスポンス。閲覧者ごとに異なる応答なので、CDN・ブラウザともにキャッシュさせない。 */
export function apiJsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "private, no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}
