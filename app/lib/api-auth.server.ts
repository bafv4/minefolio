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
  const result = await requireApiUser(db, auth, request, []);
  return result.user ? { id: result.user.id } : null;
}

type UserRow = typeof users.$inferSelect;

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * mutation の JSON API に対する Origin 確認（多層防御）。React Router は UI ルートの action と
 * single fetch の mutation にしか Origin 確認（throwIfPotentialCSRFAttack）をかけず、resource route
 * の /api/* は対象外のため、CSRF 対策が Cookie の SameSite=Lax だけに依らないようここで補う。
 *
 * 比較はフレームワーク自身の実装（react-router lib/actions.js）をそのまま写している。APP_URL とは比べない:
 * 本番の /me の action はこの比較（origin ヘッダ vs request.url の origin）を既に通っており、
 * Vercel 上の request.url の origin が実サイトの origin になることの根拠になっている。
 * - origin ヘッダなし: 確認しない（通す）。GET / HEAD などの非 mutation も確認しない。
 * - origin が "null" や URL として不正: 拒否。
 * - allowedActionOrigins（react-router.config.ts）は本リポジトリでは未設定なので許可リストは無い。
 * 拒否のとき 403 の Response を返し、通すとき null を返す。
 */
export function rejectCrossOriginMutation(request: Request): Response | null {
  if (!MUTATION_METHODS.has(request.method.toUpperCase())) return null;
  const originHeader = request.headers.get("origin");
  if (originHeader === null) return null;
  let matches = false;
  try {
    matches =
      originHeader !== "null" && new URL(originHeader).origin === new URL(request.url).origin;
  } catch {
    matches = false;
  }
  if (matches) return null;
  return plainJsonResponse({ error: "Forbidden" }, { status: 403 });
}

/** Content-Type のみを付ける素の JSON レスポンス（Cache-Control を付けない既存 API 用）。 */
export function plainJsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * 認証必須の JSON API ルート用。未ログインは 401（Unauthorized）、users 行が無ければ
 * 404（User not found）の Response を `response` として返す（getApiUser と違い両者を区別する）。
 * mutation メソッドは認証より前に Origin を確認する（rejectCrossOriginMutation。不一致は 403）。
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
  const crossOrigin = rejectCrossOriginMutation(request);
  if (crossOrigin) return { response: crossOrigin };
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
  const response = plainJsonResponse(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
