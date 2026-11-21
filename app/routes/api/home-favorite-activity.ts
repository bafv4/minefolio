// ホームの「お気に入りの動き」API（POST のみ）。
// ログイン済み: サーバーのお気に入りを使う（本文は無視）。未ログイン: ブラウザのお気に入りを本文 { slugs } で受ける
// （URL のクエリに載せない）。ユーザー固有の応答なので共有キャッシュさせない。

import type { Route } from "./+types/home-favorite-activity";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { apiJsonResponse, getApiUser } from "@/lib/api-auth.server";
import { eq } from "drizzle-orm";
import { users } from "@/lib/schema";
import { getFavoritesFromDb } from "@/lib/favorites";
import { clampFavoriteActivityOptions, getFavoriteActivity } from "@/lib/home-favorite-activity.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return apiJsonResponse({ error: "Method not allowed" }, { status: 405 });
  }
  const db = createDb();
  const auth = createAuth(db, getEnv());
  const user = await getApiUser(db, auth, request);

  // 本文 { slugs?, windowDays?, limit? }。期間・件数はサーバー側でクランプする（ログイン済みでも読む）
  let body: { slugs?: unknown; windowDays?: unknown; limit?: unknown } = {};
  try {
    body = ((await request.json()) as typeof body) ?? {};
  } catch {
    if (!user) return apiJsonResponse({ error: "Invalid body" }, { status: 400 });
  }

  // 未ログインの本文 slugs は検証前の値。型・長さ・件数の検証は getFavoriteActivity に任せる
  let slugs: unknown[] = Array.isArray(body.slugs) ? body.slugs : [];
  if (user) {
    // 自分自身の更新は「お気に入りの動き」に出さない（自分の行動のこだまで欄の意味が読めなくなるため）
    const [favorites, me] = await Promise.all([
      getFavoritesFromDb(db, user.id),
      db.query.users.findFirst({ where: eq(users.id, user.id), columns: { slug: true } }),
    ]);
    slugs = me ? favorites.filter((slug) => slug !== me.slug) : favorites;
  }
  const result = await getFavoriteActivity(db, slugs, clampFavoriteActivityOptions(body));
  return apiJsonResponse(result);
}
