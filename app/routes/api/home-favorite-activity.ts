// ホームの「お気に入りの動き」API（POST のみ）。
// ログイン済み: サーバーのお気に入りを使う（本文は無視）。未ログイン: ブラウザのお気に入りを本文 { slugs } で受ける
// （URL のクエリに載せない）。ユーザー固有の応答なので共有キャッシュさせない。

import type { Route } from "./+types/home-favorite-activity";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { getApiUser } from "@/lib/api-auth.server";
import { getFavoritesFromDb } from "@/lib/favorites";
import { FAVORITE_SLUGS_MAX, clampFavoriteActivityOptions, getFavoriteActivity } from "@/lib/home-favorite-activity.server";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function action({ request }: Route.ActionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: NO_STORE });
  }
  const db = createDb();
  const auth = createAuth(db, getEnv());
  const user = await getApiUser(db, auth, request);

  // 本文 { slugs?, windowDays?, limit? }。期間・件数はサーバー側でクランプする（ログイン済みでも読む）
  let body: { slugs?: unknown; windowDays?: unknown; limit?: unknown } = {};
  try {
    body = ((await request.json()) as typeof body) ?? {};
  } catch {
    if (!user) return Response.json({ error: "Invalid body" }, { status: 400, headers: NO_STORE });
  }

  let slugs: string[] = [];
  if (user) {
    slugs = await getFavoritesFromDb(db, user.id);
  } else if (Array.isArray(body.slugs)) {
    slugs = body.slugs.filter((s): s is string => typeof s === "string").slice(0, FAVORITE_SLUGS_MAX);
  }
  const result = await getFavoriteActivity(db, slugs, clampFavoriteActivityOptions(body));
  return Response.json(result, { headers: NO_STORE });
}
